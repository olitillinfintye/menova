import {
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RingGeometry,
  type Scene,
  SRGBColorSpace,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from "three";

import type { Hotspot } from "@/lib/types";
import type { HotspotLayer } from "@/src/viewer/Hotspots";
import type { Locomotion } from "@/src/viewer/Locomotion";

/**
 * Presentation modes.
 *  - `walkthrough`: 1:1, virtual skybox, teleport/thumbstick locomotion.
 *  - `dollhouse`: 1:50 miniature on a real surface (passthrough).
 *  - `ar`: 1:1 anchored to a real floor via hit-test; the user walks physically.
 */
export type PresentationMode = "walkthrough" | "dollhouse" | "ar";

/** How the user is currently driving the scene. */
export type InputMode = "hands" | "controllers" | "desktop" | "touch";

export interface ArchPresentationOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** Parent of the camera; represents the user's feet in world space. */
  playerRig: Object3D;
  /** Root of the loaded building. Must already be centred with its floor at Y=0. */
  modelRoot: Object3D;
  /** Meshes flagged walkable by `detectTeleportSurfaces`. */
  teleportSurfaces: Mesh[];
  /** Desktop/mobile fallback controller; disabled automatically inside XR. */
  locomotion?: Locomotion | null;
  /** Skybox restored when walkthrough mode is active. */
  environment?: Texture | Color | null;
  /** Clickable hotspot markers, selectable with the controller ray. */
  hotspots?: HotspotLayer | null;
  /** Scale for Mode B, relative to the walkthrough scale. Defaults to 0.02 (1:50). */
  dollhouseScale?: number;
  /** Scale for Mode A. Defaults to the model root's current scale. */
  walkScale?: number;
  /** Duration of the mode tween in seconds. */
  transitionSeconds?: number;
  onModeChange?: (mode: PresentationMode) => void;
  onInputModeChange?: (mode: InputMode) => void;
  /** Fired when a hotspot is picked with an XR controller. */
  onHotspotSelect?: (hotspot: Hotspot) => void;
  /** Fired when the AR model has been (re)placed on a real surface. */
  onPlaced?: () => void;
  /** Surfaced to the UI for non-fatal issues (missing hit-test, etc). */
  onNotice?: (message: string) => void;
}

const PINCH_ENGAGE_METRES = 0.02;
const PINCH_RELEASE_METRES = 0.03;
const PALM_FACING_DOT = 0.7;
const BUTTON_HIT_RADIUS = 0.045;

/** Thumbstick smooth locomotion, metres per second at full deflection. */
const STICK_WALK_SPEED = 2.2;
/** Dead zone below which a stick reads as centred. */
const STICK_DEAD_ZONE = 0.25;
/** Snap turn increment. */
const SNAP_TURN_RADIANS = Math.PI / 4;
/** Right-stick deflection that triggers a snap turn. */
const SNAP_TURN_THRESHOLD = 0.6;

/** Joints used to derive the palm plane. */
const WRIST = "wrist";
const INDEX_METACARPAL = "index-finger-metacarpal";
const PINKY_METACARPAL = "pinky-finger-metacarpal";
const INDEX_TIP = "index-finger-tip";
const THUMB_TIP = "thumb-tip";

/**
 * Derived from the renderer rather than imported by name: three has moved
 * `XRHandSpace` / `XRTargetRaySpace` between entry points across releases, and
 * `ReturnType` stays correct either way.
 */
type XRHandLike = ReturnType<WebGLRenderer["xr"]["getHand"]>;
type XRControllerLike = ReturnType<WebGLRenderer["xr"]["getController"]>;

interface MenuButton {
  root: Group;
  mesh: Mesh;
  material: MeshStandardMaterial;
  mode: PresentationMode;
  label: string;
}

interface HandState {
  object: XRHandLike;
  pinching: boolean;
  /** Button the current pinch started on, so release fires on the same target. */
  pressedButton: MenuButton | null;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Drives the Meta Quest presentation experience on top of plain three.js.
 *
 * Everything here works against `WebGLRenderer.xr`, which is also what Needle
 * Engine renders through — `ArchPresentationController` is a thin Needle
 * `Behaviour` that instantiates this class, so the same logic runs in both the
 * standalone viewer and a Needle scene.
 *
 * Responsibilities:
 *  - Mode A (1:1 walkthrough) and Mode B (dollhouse / MR), with a smooth tween.
 *  - Optical hand tracking with a palm-anchored holographic wrist menu and
 *    pinch-to-click.
 *  - Graceful degradation: controller ray teleport, then desktop WASD, then
 *    mobile touch joysticks.
 */
export class ArchPresentationCore {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly playerRig: Object3D;
  private readonly modelRoot: Object3D;
  private readonly teleportSurfaces: Mesh[];
  private readonly locomotion: Locomotion | null;
  private readonly environment: Texture | Color | null;
  private readonly hotspots: HotspotLayer | null;
  private readonly dollhouseScale: number;
  private readonly walkScale: number;
  private readonly transitionSeconds: number;
  private readonly onModeChange?: (mode: PresentationMode) => void;
  private readonly onInputModeChange?: (mode: InputMode) => void;
  private readonly onHotspotSelect?: (hotspot: Hotspot) => void;
  private readonly onPlaced?: () => void;
  private readonly onNotice?: (message: string) => void;

  private mode: PresentationMode = "walkthrough";
  private inputMode: InputMode = "desktop";
  private disposed = false;

  // ---- transition state
  private transitionProgress = 1;
  private readonly fromPosition = new Vector3();
  private readonly toPosition = new Vector3();
  private fromScale = 1;
  private toScale = 1;

  /** Model transform in walkthrough mode (captured at construction). */
  private readonly walkAnchorPosition = new Vector3();
  /** Where the miniature sits: hit-test result, or a sensible default. */
  private readonly dollhouseAnchorPosition = new Vector3(0, 0.9, -0.6);
  private dollhouseAnchorFromHitTest = false;

  // ---- AR 1:1 placement
  /** Model-local point that lands on the tapped surface (a doorway, say). */
  private readonly entryPoint = new Vector3();
  /** Model position while in AR mode; starts wherever the walkthrough left it. */
  private readonly arAnchorPosition = new Vector3();
  private placementReticle: Mesh | null = null;
  private reticlePoint: Vector3 | null = null;
  private arPlaced = false;

  // ---- thumbsticks
  private snapTurnArmed = true;

  // ---- hands
  private readonly hands: HandState[] = [];
  private menu: Group | null = null;
  private readonly menuButtons: MenuButton[] = [];
  private menuVisible = false;

  // ---- controllers
  private readonly controllers: XRControllerLike[] = [];
  private readonly controllerSelecting = new Set<XRControllerLike>();
  private teleportMarker: Mesh | null = null;
  private teleportPoint: Vector3 | null = null;
  private hoveredHotspot: Hotspot | null = null;
  private readonly raycaster = new Raycaster();

  // ---- XR hit test
  private hitTestSource: XRHitTestSource | null = null;
  private hitTestRequested = false;
  private viewerSpace: XRReferenceSpace | null = null;

  // ---- scratch
  private readonly vecA = new Vector3();
  private readonly vecB = new Vector3();
  private readonly vecC = new Vector3();
  private readonly palmNormal = new Vector3();
  private readonly toCamera = new Vector3();
  private readonly rayOrigin = new Vector3();
  private readonly rayDirection = new Vector3();
  private readonly worldQuaternion = new Quaternion();

  constructor(options: ArchPresentationOptions) {
    this.renderer = options.renderer;
    this.scene = options.scene;
    this.camera = options.camera;
    this.playerRig = options.playerRig;
    this.modelRoot = options.modelRoot;
    this.teleportSurfaces = options.teleportSurfaces;
    this.locomotion = options.locomotion ?? null;
    this.environment = options.environment ?? null;
    this.hotspots = options.hotspots ?? null;
    // FBX exports carry a unit-normalising scale on the root; honour it.
    this.walkScale = options.walkScale ?? options.modelRoot.scale.x;
    this.dollhouseScale = this.walkScale * (options.dollhouseScale ?? 0.02);
    this.transitionSeconds = Math.max(0.05, options.transitionSeconds ?? 0.9);
    this.onModeChange = options.onModeChange;
    this.onInputModeChange = options.onInputModeChange;
    this.onHotspotSelect = options.onHotspotSelect;
    this.onPlaced = options.onPlaced;
    this.onNotice = options.onNotice;

    this.walkAnchorPosition.copy(this.modelRoot.position);
    this.arAnchorPosition.copy(this.modelRoot.position);
    this.toPosition.copy(this.walkAnchorPosition);
    this.fromPosition.copy(this.walkAnchorPosition);
    this.fromScale = this.walkScale;
    this.toScale = this.walkScale;

    this.setupHands();
    this.setupControllers();
    this.buildWristMenu();
    this.buildTeleportMarker();
    this.buildPlacementReticle();

    this.renderer.xr.addEventListener("sessionstart", this.onSessionStart);
    this.renderer.xr.addEventListener("sessionend", this.onSessionEnd);

    this.detectInputMode();
  }

  // =========================================================== public API

  getMode(): PresentationMode {
    return this.mode;
  }

  getInputMode(): InputMode {
    return this.inputMode;
  }

  /** Switches presentation mode, tweening unless `immediate` is set. */
  setMode(mode: PresentationMode, immediate = false): void {
    if (this.disposed || mode === this.mode) return;

    this.mode = mode;

    this.fromPosition.copy(this.modelRoot.position);
    this.fromScale = this.modelRoot.scale.x;

    if (mode === "dollhouse") {
      if (!this.dollhouseAnchorFromHitTest) {
        // No real surface yet: float the miniature a metre ahead, waist height.
        this.camera.getWorldDirection(this.vecA);
        this.vecA.y = 0;
        if (this.vecA.lengthSq() > 1e-6) this.vecA.normalize();
        this.camera.getWorldPosition(this.dollhouseAnchorPosition);
        this.dollhouseAnchorPosition.addScaledVector(this.vecA, 2.2);
        this.dollhouseAnchorPosition.y -= 0.8;
      }
      this.toPosition.copy(this.dollhouseAnchorPosition);
      this.toScale = this.dollhouseScale;
      this.setPassthrough(true);
    } else if (mode === "ar") {
      this.toPosition.copy(this.arAnchorPosition);
      this.toScale = this.walkScale;
      this.arPlaced = false;
      // Nothing to look at until the user picks a floor point.
      this.modelRoot.visible = false;
      this.setPassthrough(true);
    } else {
      this.toPosition.copy(this.walkAnchorPosition);
      this.toScale = this.walkScale;
      this.setPassthrough(false);
    }
    if (mode !== "ar") this.modelRoot.visible = true;

    if (this.placementReticle) this.placementReticle.visible = false;
    this.reticlePoint = null;

    this.transitionProgress = immediate ? 1 : 0;
    if (immediate) this.applyTransform(1);

    this.onModeChange?.(mode);
  }

  toggleMode(): void {
    this.setMode(this.mode === "walkthrough" ? "dollhouse" : "walkthrough");
  }

  /**
   * Model-local point that should sit on the tapped floor in AR mode: the
   * first hotspot is a natural entrance; the origin (footprint centre) is the
   * fallback.
   */
  setEntryPoint(local: Vector3): void {
    this.entryPoint.copy(local);
  }

  /** True once the AR model has been anchored to a detected surface. */
  get isPlaced(): boolean {
    return this.arPlaced;
  }

  /** Anchors the 1:1 model so `entryPoint` lands on `worldPoint`. */
  placeAt(worldPoint: Vector3): void {
    this.vecA.copy(this.entryPoint).multiplyScalar(this.walkScale);
    this.arAnchorPosition.copy(worldPoint).sub(this.vecA);
    this.arPlaced = true;
    this.modelRoot.visible = true;

    if (this.mode === "ar") {
      // Snap rather than tween: the user is standing where the building goes.
      this.modelRoot.position.copy(this.arAnchorPosition);
      this.modelRoot.scale.setScalar(this.walkScale);
      this.toPosition.copy(this.arAnchorPosition);
      this.toScale = this.walkScale;
      this.transitionProgress = 1;
    }
    this.onPlaced?.();
  }

  /** Forgets the AR anchor so the next tap places the model afresh. */
  resetPlacement(): void {
    this.arPlaced = false;
    if (this.mode === "ar") this.modelRoot.visible = false;
    if (this.placementReticle) this.placementReticle.visible = false;
  }

  /** Moves the user to a hotspot, in XR or on the desktop rig. */
  goToHotspot(hotspot: Hotspot): void {
    const world = this.modelRoot.localToWorld(
      this.vecB.set(hotspot.position.x, hotspot.position.y, hotspot.position.z),
    );
    if (this.renderer.xr.isPresenting) {
      this.teleportRigTo(world, hotspot.yaw);
    } else {
      this.locomotion?.travelTo(world, hotspot.yaw);
    }
  }

  /**
   * Per-frame tick.
   *
   * @param deltaSeconds frame delta.
   * @param frame the current `XRFrame`, when one is available.
   */
  update(deltaSeconds: number, frame?: XRFrame | null): void {
    if (this.disposed) return;

    this.updateTransition(deltaSeconds);

    const presenting = this.renderer.xr.isPresenting;
    this.locomotion?.setEnabled(!presenting);

    if (!presenting) {
      this.hideMenu();
      return;
    }

    if (frame) this.updateHitTest(frame);

    const handsTracked = this.updateHands();
    if (!handsTracked) {
      this.hideMenu();
      this.updateControllerRay();
      if (this.mode === "walkthrough") this.updateThumbsticks(deltaSeconds);
    } else if (this.inputMode !== "hands") {
      this.setInputMode("hands");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.renderer.xr.removeEventListener("sessionstart", this.onSessionStart);
    this.renderer.xr.removeEventListener("sessionend", this.onSessionEnd);

    for (const controller of this.controllers) {
      controller.removeEventListener("selectstart", this.onSelectStart);
      controller.removeEventListener("selectend", this.onSelectEnd);
      controller.removeEventListener("connected", this.onControllerConnected);
      controller.removeEventListener("disconnected", this.onControllerDisconnected);
      controller.parent?.remove(controller);
    }
    this.controllers.length = 0;

    for (const hand of this.hands) {
      hand.object.removeEventListener("connected", this.onHandConnected);
      hand.object.parent?.remove(hand.object);
    }
    this.hands.length = 0;

    for (const button of this.menuButtons) {
      button.mesh.geometry.dispose();
      const map = button.material.map;
      map?.dispose();
      button.material.dispose();
    }
    this.menuButtons.length = 0;
    this.menu?.parent?.remove(this.menu);
    this.menu = null;

    if (this.teleportMarker) {
      this.teleportMarker.geometry.dispose();
      (this.teleportMarker.material as MeshBasicMaterial).dispose();
      this.teleportMarker.parent?.remove(this.teleportMarker);
      this.teleportMarker = null;
    }

    if (this.placementReticle) {
      this.placementReticle.geometry.dispose();
      (this.placementReticle.material as MeshBasicMaterial).dispose();
      this.placementReticle.parent?.remove(this.placementReticle);
      this.placementReticle = null;
    }

    this.hitTestSource?.cancel?.();
    this.hitTestSource = null;
  }

  // ====================================================== mode transition

  private updateTransition(deltaSeconds: number): void {
    if (this.transitionProgress >= 1) return;
    this.transitionProgress = Math.min(
      1,
      this.transitionProgress + deltaSeconds / this.transitionSeconds,
    );
    this.applyTransform(easeInOutCubic(this.transitionProgress));
  }

  private applyTransform(t: number): void {
    const scale = this.fromScale + (this.toScale - this.fromScale) * t;
    this.modelRoot.scale.setScalar(scale);
    this.modelRoot.position.lerpVectors(this.fromPosition, this.toPosition, t);
  }

  /**
   * Toggles the virtual skybox off so the headset's passthrough feed shows
   * through, and back on for the fully virtual walkthrough.
   *
   * Real passthrough only happens in an `immersive-ar` session — the blend mode
   * is fixed when the session is created. In an `immersive-vr` session this
   * still clears the background to black, which reads as a void rather than a
   * room, so we tell the caller.
   */
  private setPassthrough(enabled: boolean): void {
    if (enabled) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setClearAlpha(0);

      const session = this.renderer.xr.getSession();
      if (session && session.environmentBlendMode === "opaque") {
        this.onNotice?.(
          "Dollhouse mode is running in a fully virtual session, so there is no passthrough. Re-enter using Mixed Reality to see your room.",
        );
      }
    } else {
      this.scene.background = this.environment ?? new Color(0x0b0d10);
      this.renderer.setClearAlpha(1);
    }
  }

  // ============================================================ hit test

  /**
   * Tracks the first real-world surface under the user's gaze.
   *
   * Dollhouse mode snaps the miniature onto it; AR mode shows a reticle there
   * and waits for a tap before anchoring the 1:1 model.
   */
  private updateHitTest(frame: XRFrame): void {
    if (this.mode === "walkthrough") return;

    const session = this.renderer.xr.getSession();
    const referenceSpace = this.renderer.xr.getReferenceSpace();
    if (!session || !referenceSpace) return;

    if (!this.hitTestRequested) {
      this.hitTestRequested = true;
      if (typeof session.requestHitTestSource !== "function") {
        this.onNotice?.(
          this.mode === "ar"
            ? "Surface detection is unavailable on this device, so the model is placed at your current position."
            : "Surface detection is unavailable, so the dollhouse uses a fixed position in front of you.",
        );
        if (this.mode === "ar" && !this.arPlaced) this.placeAtUserFeet();
        return;
      }
      void (async () => {
        try {
          this.viewerSpace = await session.requestReferenceSpace("viewer");
          const source = await session.requestHitTestSource?.({ space: this.viewerSpace });
          if (this.disposed) {
            source?.cancel?.();
            return;
          }
          this.hitTestSource = source ?? null;
        } catch {
          this.onNotice?.("Surface detection was refused by the device.");
          if (this.mode === "ar" && !this.arPlaced) this.placeAtUserFeet();
        }
      })();
      return;
    }

    if (!this.hitTestSource) return;

    const results = frame.getHitTestResults(this.hitTestSource);
    if (results.length === 0) {
      if (this.placementReticle) this.placementReticle.visible = false;
      this.reticlePoint = null;
      return;
    }

    const pose = results[0].getPose(referenceSpace);
    if (!pose) return;

    // Hit poses are in the XR reference space, i.e. the rig's local frame.
    const { x, y, z } = pose.transform.position;
    const world = this.playerRig.localToWorld(this.vecA.set(x, y, z));

    if (this.mode === "dollhouse") {
      this.dollhouseAnchorPosition.copy(world);
      this.dollhouseAnchorFromHitTest = true;
      // Keep an in-flight or settled dollhouse tween tracking the surface.
      this.toPosition.copy(this.dollhouseAnchorPosition);
      if (this.transitionProgress >= 1) {
        this.modelRoot.position.lerp(this.dollhouseAnchorPosition, 0.15);
      }
      return;
    }

    // AR: show where a tap would put the entrance.
    this.reticlePoint = (this.reticlePoint ?? new Vector3()).copy(world);
    if (this.placementReticle) {
      this.placementReticle.visible = !this.arPlaced;
      this.placementReticle.position.copy(world);
      this.placementReticle.position.y += 0.01;
    }
  }

  /** Fallback anchor: the model's entrance at the user's feet, facing forward. */
  private placeAtUserFeet(): void {
    this.camera.getWorldPosition(this.vecB);
    this.vecB.y = this.playerRig.position.y;
    this.placeAt(this.vecB);
  }

  // =============================================================== hands

  private setupHands(): void {
    for (let index = 0; index < 2; index += 1) {
      const hand = this.renderer.xr.getHand(index);
      hand.addEventListener("connected", this.onHandConnected);
      this.playerRig.add(hand);
      this.hands.push({ object: hand, pinching: false, pressedButton: null });
    }
  }

  private readonly onHandConnected = (event: { target?: unknown; data?: XRInputSource }) => {
    const target = event.target as XRHandLike | undefined;
    if (target && event.data) target.userData.handedness = event.data.handedness;
  };

  /** @returns true when at least one hand is currently tracked. */
  private updateHands(): boolean {
    let tracked = false;
    let left: XRHandLike | null = null;

    for (const state of this.hands) {
      if (!this.getJoint(state.object, WRIST)) continue;
      tracked = true;
      if (state.object.userData.handedness === "left") left = state.object;
    }

    if (!tracked) return false;

    // The wrist menu lives on the left hand, per the presentation spec.
    const menuHand = left ?? this.hands.find((h) => this.getJoint(h.object, WRIST))?.object ?? null;
    if (menuHand) this.updateWristMenu(menuHand);

    for (const state of this.hands) this.updatePinch(state);

    return true;
  }

  private getJoint(hand: XRHandLike, name: string): Object3D | null {
    // `joints` is keyed by the `XRHandJoint` union; widen it so the joint-name
    // constants above can be used directly.
    const joints = hand.joints as Record<string, Object3D | undefined> | undefined;
    const joint = joints?.[name];
    if (!joint) return null;
    // three sets `visible = false` on joints the runtime is not tracking.
    if (joint.visible === false) return null;
    return joint;
  }

  /**
   * Shows the holographic menu when the palm is turned toward the viewer.
   *
   * The palm normal is derived geometrically from three joints rather than from
   * a joint's own axes, because joint-space conventions differ between runtimes
   * whereas the wrist/metacarpal triangle does not.
   */
  private updateWristMenu(hand: XRHandLike): void {
    const wrist = this.getJoint(hand, WRIST);
    const indexMeta = this.getJoint(hand, INDEX_METACARPAL);
    const pinkyMeta = this.getJoint(hand, PINKY_METACARPAL);

    if (!wrist || !indexMeta || !pinkyMeta || !this.menu) {
      this.hideMenu();
      return;
    }

    wrist.getWorldPosition(this.vecA);
    indexMeta.getWorldPosition(this.vecB);
    pinkyMeta.getWorldPosition(this.vecC);

    // (index - wrist) x (pinky - wrist) points out of a LEFT palm;
    // the right hand is the mirror image, so the operands swap.
    const toIndex = this.vecB.sub(this.vecA);
    const toPinky = this.vecC.sub(this.vecA);
    if (hand.userData.handedness === "right") {
      this.palmNormal.copy(toPinky).cross(toIndex);
    } else {
      this.palmNormal.copy(toIndex).cross(toPinky);
    }

    if (this.palmNormal.lengthSq() < 1e-8) {
      this.hideMenu();
      return;
    }
    this.palmNormal.normalize();

    wrist.getWorldPosition(this.vecA);
    this.camera.getWorldPosition(this.toCamera).sub(this.vecA);
    if (this.toCamera.lengthSq() < 1e-8) return;
    this.toCamera.normalize();

    if (this.palmNormal.dot(this.toCamera) < PALM_FACING_DOT) {
      this.hideMenu();
      return;
    }

    // Float the panel just above the palm and billboard it at the viewer.
    this.menu.position.copy(this.vecA).addScaledVector(this.palmNormal, 0.07);
    this.menu.parent?.worldToLocal(this.menu.position);
    this.camera.getWorldPosition(this.vecB);
    this.menu.lookAt(this.vecB);

    if (!this.menuVisible) {
      this.menu.visible = true;
      this.menuVisible = true;
    }

    // Highlight the button matching the active mode.
    for (const button of this.menuButtons) {
      const active = button.mode === this.mode;
      button.material.emissiveIntensity = active ? 0.85 : 0.25;
    }
  }

  private hideMenu(): void {
    if (!this.menu || !this.menuVisible) return;
    this.menu.visible = false;
    this.menuVisible = false;
    for (const state of this.hands) state.pressedButton = null;
  }

  /** Pinch = index tip and thumb tip closer than 2cm, with release hysteresis. */
  private updatePinch(state: HandState): void {
    const indexTip = this.getJoint(state.object, INDEX_TIP);
    const thumbTip = this.getJoint(state.object, THUMB_TIP);

    if (!indexTip || !thumbTip) {
      state.pinching = false;
      state.pressedButton = null;
      return;
    }

    indexTip.getWorldPosition(this.vecA);
    thumbTip.getWorldPosition(this.vecB);
    const distance = this.vecA.distanceTo(this.vecB);

    // Pinch point is the midpoint between the two tips.
    const pinchPoint = this.vecC.copy(this.vecA).add(this.vecB).multiplyScalar(0.5);

    if (!state.pinching && distance < PINCH_ENGAGE_METRES) {
      state.pinching = true;
      state.pressedButton = this.menuVisible ? this.findButtonAt(pinchPoint) : null;
      if (state.pressedButton) {
        state.pressedButton.material.emissive.setHex(0xffffff);
      }
      return;
    }

    if (state.pinching && distance > PINCH_RELEASE_METRES) {
      state.pinching = false;
      const button = state.pressedButton;
      state.pressedButton = null;
      if (!button) return;

      button.material.emissive.setHex(0x5b8cff);
      // Release must land on the same button that was pressed.
      if (this.menuVisible && this.findButtonAt(pinchPoint) === button) {
        this.setMode(button.mode);
      }
    }
  }

  private findButtonAt(worldPoint: Vector3): MenuButton | null {
    let closest: MenuButton | null = null;
    let closestDistance = BUTTON_HIT_RADIUS;

    for (const button of this.menuButtons) {
      const distance = button.root.getWorldPosition(this.vecA).distanceTo(worldPoint);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = button;
      }
    }
    return closest;
  }

  private buildWristMenu(): void {
    const menu = new Group();
    menu.name = "MenovaWristMenu";
    menu.visible = false;
    // Renders after the scene so the panel is never occluded by the building.
    menu.renderOrder = 999;

    const definitions: Array<{ mode: PresentationMode; label: string; x: number }> = [
      { mode: "dollhouse", label: "Dollhouse View", x: -0.045 },
      { mode: "walkthrough", label: "1:1 Scale Walk", x: 0.045 },
    ];

    for (const definition of definitions) {
      const root = new Group();
      root.position.x = definition.x;

      const material = new MeshStandardMaterial({
        map: createLabelTexture(definition.label),
        transparent: true,
        emissive: new Color(0x5b8cff),
        emissiveIntensity: 0.25,
        roughness: 0.4,
        metalness: 0,
        side: DoubleSide,
        depthTest: false,
      });

      const mesh = new Mesh(new PlaneGeometry(0.08, 0.04), material);
      mesh.renderOrder = 1000;
      root.add(mesh);
      menu.add(root);

      this.menuButtons.push({ root, mesh, material, mode: definition.mode, label: definition.label });
    }

    // Parented to the rig so the menu inherits teleports and rig rotation.
    this.playerRig.add(menu);
    this.menu = menu;
  }

  // ========================================================= controllers

  private setupControllers(): void {
    for (let index = 0; index < 2; index += 1) {
      const controller = this.renderer.xr.getController(index);
      controller.addEventListener("selectstart", this.onSelectStart);
      controller.addEventListener("selectend", this.onSelectEnd);
      controller.addEventListener("connected", this.onControllerConnected);
      controller.addEventListener("disconnected", this.onControllerDisconnected);
      this.playerRig.add(controller);
      this.controllers.push(controller);
    }
  }

  private readonly onControllerConnected = (event: { data?: XRInputSource }) => {
    // A hand-tracked input source also produces a controller object; only
    // physical controllers should switch the input mode.
    if (event.data && !event.data.hand) this.setInputMode("controllers");
  };

  private readonly onControllerDisconnected = () => {
    this.detectInputMode();
  };

  private readonly onSelectStart = (event: { target?: unknown }) => {
    const controller = event.target as XRControllerLike | undefined;
    if (controller) this.controllerSelecting.add(controller);
  };

  private readonly onSelectEnd = (event: { target?: unknown }) => {
    const controller = event.target as XRControllerLike | undefined;
    if (controller) this.controllerSelecting.delete(controller);

    // AR: a tap (screen or trigger) anchors the model on the reticle.
    if (this.mode === "ar") {
      if (this.reticlePoint && !this.arPlaced) this.placeAt(this.reticlePoint);
      return;
    }

    if (this.hoveredHotspot) {
      const hotspot = this.hoveredHotspot;
      this.hoveredHotspot = null;
      this.teleportPoint = null;
      if (this.teleportMarker) this.teleportMarker.visible = false;
      this.goToHotspot(hotspot);
      this.onHotspotSelect?.(hotspot);
      return;
    }

    if (this.teleportPoint) {
      this.teleportRigTo(this.teleportPoint);
      this.teleportPoint = null;
    }
    if (this.teleportMarker) this.teleportMarker.visible = false;
  };

  /**
   * Straight-ray pointing from whichever trigger is held: hotspots take
   * priority, then walkable floor for teleporting.
   */
  private updateControllerRay(): void {
    if (this.controllerSelecting.size === 0 || this.mode === "ar") {
      if (this.teleportMarker) this.teleportMarker.visible = false;
      this.teleportPoint = null;
      this.hoveredHotspot = null;
      return;
    }

    const controller = this.controllerSelecting.values().next().value as
      | XRControllerLike
      | undefined;
    if (!controller) return;

    controller.getWorldPosition(this.rayOrigin);
    controller.getWorldQuaternion(this.worldQuaternion);
    this.rayDirection.set(0, 0, -1).applyQuaternion(this.worldQuaternion).normalize();

    this.raycaster.set(this.rayOrigin, this.rayDirection);
    this.raycaster.far = 40;

    this.hoveredHotspot = this.hotspots?.hitTest(this.raycaster) ?? null;
    if (this.hoveredHotspot) {
      this.teleportPoint = null;
      if (this.teleportMarker) this.teleportMarker.visible = false;
      return;
    }

    if (this.teleportSurfaces.length === 0) return;

    const hits = this.raycaster.intersectObjects(this.teleportSurfaces, false);
    const hit = hits.find((candidate) => candidate.face && candidate.face.normal.y !== 0);

    if (!hit) {
      if (this.teleportMarker) this.teleportMarker.visible = false;
      this.teleportPoint = null;
      return;
    }

    this.teleportPoint = hit.point.clone();
    if (this.teleportMarker) {
      this.teleportMarker.visible = true;
      this.teleportMarker.position.copy(hit.point);
      this.teleportMarker.position.y += 0.01; // avoid z-fighting with the slab
    }
  }

  /**
   * Quest-style smooth locomotion: left stick walks relative to where the
   * user is looking, right stick snap-turns in 45° steps around the head.
   */
  private updateThumbsticks(deltaSeconds: number): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    let moveX = 0;
    let moveY = 0;
    let turn = 0;

    for (const source of session.inputSources) {
      const axes = source.gamepad?.axes;
      if (!axes || axes.length < 4 || source.hand) continue;
      // Oculus Touch / most XR gamepads expose the thumbstick on axes 2 & 3.
      const x = axes[2];
      const y = axes[3];
      if (source.handedness === "right") {
        turn = x;
      } else {
        moveX = x;
        moveY = y;
      }
    }

    // ---- snap turn
    if (Math.abs(turn) > SNAP_TURN_THRESHOLD) {
      if (this.snapTurnArmed) {
        this.snapTurnArmed = false;
        this.rotateRigAroundHead(turn > 0 ? -SNAP_TURN_RADIANS : SNAP_TURN_RADIANS);
      }
    } else if (Math.abs(turn) < STICK_DEAD_ZONE) {
      this.snapTurnArmed = true;
    }

    // ---- walk
    const magnitude = Math.hypot(moveX, moveY);
    if (magnitude < STICK_DEAD_ZONE) return;
    const scaled = (magnitude - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);

    // Head yaw only: pitch must not drive the user into the floor.
    this.camera.getWorldDirection(this.vecA);
    this.vecA.y = 0;
    if (this.vecA.lengthSq() < 1e-6) return;
    this.vecA.normalize();
    this.vecB.set(-this.vecA.z, 0, this.vecA.x); // right vector

    this.vecC
      .set(0, 0, 0)
      .addScaledVector(this.vecA, -moveY / magnitude)
      .addScaledVector(this.vecB, moveX / magnitude)
      .multiplyScalar(scaled * STICK_WALK_SPEED * deltaSeconds);

    this.playerRig.position.add(this.vecC);
  }

  /** Yaws the rig about the headset so the user turns in place. */
  private rotateRigAroundHead(radians: number): void {
    this.camera.getWorldPosition(this.vecA);
    this.playerRig.rotation.y += radians;
    this.playerRig.updateMatrixWorld(true);
    this.camera.getWorldPosition(this.vecB);
    this.playerRig.position.add(this.vecA.sub(this.vecB));
  }

  /**
   * Moves the rig so the *camera* ends up over `point`, optionally facing `yaw`.
   *
   * In XR the headset pose is applied on top of the rig, so simply setting
   * `rig.position = point` would land the user wherever their body happens to
   * be offset from the play-space origin.
   */
  private teleportRigTo(point: Vector3, yaw?: number): void {
    if (yaw !== undefined) {
      // Turn first so the head offset below is measured in the new heading.
      this.camera.getWorldDirection(this.vecC);
      const headYaw = Math.atan2(-this.vecC.x, -this.vecC.z);
      this.playerRig.rotation.y += yaw - headYaw;
      this.playerRig.updateMatrixWorld(true);
    }
    this.camera.getWorldPosition(this.vecA);
    const offsetX = this.vecA.x - this.playerRig.position.x;
    const offsetZ = this.vecA.z - this.playerRig.position.z;
    this.playerRig.position.set(point.x - offsetX, point.y, point.z - offsetZ);
  }

  private buildTeleportMarker(): void {
    const marker = new Mesh(
      new RingGeometry(0.18, 0.26, 32).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0xc9962a, transparent: true, opacity: 0.85, side: DoubleSide }),
    );
    marker.name = "MenovaTeleportMarker";
    marker.visible = false;
    marker.renderOrder = 998;
    this.scene.add(marker);
    this.teleportMarker = marker;
  }

  private buildPlacementReticle(): void {
    const reticle = new Mesh(
      new RingGeometry(0.12, 0.16, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: DoubleSide }),
    );
    reticle.name = "MenovaPlacementReticle";
    reticle.visible = false;
    reticle.renderOrder = 998;
    this.scene.add(reticle);
    this.placementReticle = reticle;
  }

  // ============================================================ sessions

  private readonly onSessionStart = () => {
    this.locomotion?.setEnabled(false);
    this.hitTestRequested = false;
    this.hitTestSource = null;
    this.snapTurnArmed = true;
    // Re-apply the background rule for the mode we entered with.
    this.setPassthrough(this.mode !== "walkthrough");
    this.detectInputMode();
  };

  private readonly onSessionEnd = () => {
    this.hitTestSource?.cancel?.();
    this.hitTestSource = null;
    this.hitTestRequested = false;
    this.viewerSpace = null;
    this.hideMenu();
    this.controllerSelecting.clear();
    this.hoveredHotspot = null;
    if (this.teleportMarker) this.teleportMarker.visible = false;
    if (this.placementReticle) this.placementReticle.visible = false;
    this.reticlePoint = null;
    this.arPlaced = false;
    this.modelRoot.visible = true;

    // Leaving XR always returns to the fully virtual 1:1 view.
    this.setMode("walkthrough");
    this.locomotion?.setEnabled(true);
    this.detectInputMode();
  };

  private detectInputMode(): void {
    if (this.renderer.xr.isPresenting) {
      const session = this.renderer.xr.getSession();
      const sources = session ? Array.from(session.inputSources) : [];
      if (sources.some((source) => source.hand)) {
        this.setInputMode("hands");
        return;
      }
      if (sources.length > 0) {
        this.setInputMode("controllers");
        return;
      }
    }

    const coarse =
      typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    this.setInputMode(coarse ? "touch" : "desktop");
  }

  private setInputMode(mode: InputMode): void {
    if (this.inputMode === mode) return;
    this.inputMode = mode;
    this.onInputModeChange?.(mode);
  }

  /** True once a real surface has been found for the miniature. */
  get isAnchoredToRealSurface(): boolean {
    return this.dollhouseAnchorFromHitTest;
  }
}

/** Renders a rounded holographic button label into a texture. */
function createLabelTexture(label: string): CanvasTexture {
  const width = 512;
  const height = 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    // A blank texture still renders a usable (unlabelled) button.
    return new CanvasTexture(canvas);
  }

  const radius = 48;
  context.clearRect(0, 0, width, height);

  context.beginPath();
  context.roundRect(8, 8, width - 16, height - 16, radius);
  context.fillStyle = "rgba(10, 16, 32, 0.82)";
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = "rgba(120, 165, 255, 0.9)";
  context.stroke();

  context.fillStyle = "#eaf0ff";
  context.font = "600 44px system-ui, -apple-system, 'Segoe UI', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";

  // Wrap on spaces so two-word labels stack instead of overflowing.
  const words = label.split(" ");
  const lines = words.length > 2 ? [words.slice(0, -1).join(" "), words.at(-1)!] : [label];
  const lineHeight = 52;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    context.fillText(line, width / 2, startY + index * lineHeight);
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
