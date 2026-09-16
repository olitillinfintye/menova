import {
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  Matrix3,
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
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";
import { disposeHierarchy } from "@/src/viewer/sceneSetup";

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
  getXrSessionMode?: () => XRSessionMode | null;
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
  onPlacementChange?: (placed: boolean) => void;
  onScaleChange?: (scale: number) => void;
  onFloorDetected?: (detected: boolean) => void;
  /** Surfaced to the UI for non-fatal issues (missing hit-test, etc). */
  onNotice?: (message: string) => void;
}

const PALM_FACING_DOT = 0.7;

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

/**
 * Derived from the renderer rather than imported by name: three has moved
 * `XRHandSpace` / `XRTargetRaySpace` between entry points across releases, and
 * `ReturnType` stays correct either way.
 */
type XRHandLike = ReturnType<WebGLRenderer["xr"]["getHand"]>;
type XRControllerLike = ReturnType<WebGLRenderer["xr"]["getController"]>;

type MenuAction = "ar" | "walkthrough" | "smaller" | "larger" | "actual" | "place" | "exit"
  | "rooms" | "controls" | "hotspot" | "previous" | "next" | "empty";

interface MenuButton {
  root: Group;
  mesh: Mesh;
  material: MeshStandardMaterial;
  action: MenuAction;
  label: string;
  hotspot?: Hotspot;
}

interface HandState {
  object: XRHandLike;
  touchedButton: MenuButton | null;
  releasePoint: Vector3 | null;
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
  private readonly getXrSessionMode: () => XRSessionMode | null;
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
  private readonly onPlacementChange?: (placed: boolean) => void;
  private readonly onScaleChange?: (scale: number) => void;
  private readonly onFloorDetected?: (detected: boolean) => void;
  private floorDetected = false;
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
  private mixedScale = 1;
  private readonly placementAnchor = new Vector3();

  // ---- thumbsticks
  private snapTurnArmed = true;

  // ---- hands
  private readonly hands: HandState[] = [];
  private menu: Group | null = null;
  private readonly menuButtons: MenuButton[] = [];
  private roomHotspots: Hotspot[] = [];
  private roomPage = 0;
  private menuView: "controls" | "rooms" = "controls";
  private menuVisible = false;
  private menuHand: XRHandLike | null = null;
  private touchBlockedUntil = 0;
  private readonly buttonPoint = new Vector3();
  private hoveredButton: MenuButton | null = null;
  private activePointer: XRControllerLike | null = null;
  private readonly normalMatrix = new Matrix3();
  private readonly savedRigPosition = new Vector3();
  private readonly savedRigQuaternion = new Quaternion();

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
    this.getXrSessionMode = options.getXrSessionMode ?? (() => null);
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
    this.onPlacementChange = options.onPlacementChange;
    this.onScaleChange = options.onScaleChange;
    this.onFloorDetected = options.onFloorDetected;
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

    const session = this.renderer.xr.getSession();
    if (session && mode !== "walkthrough") {
      if (session.environmentBlendMode === "opaque") {
        this.onNotice?.("Exit VR and enter Mixed Reality to detect your room floor.");
        return;
      }
      mode = "ar";
      if (mode === this.mode) return;
    }

    this.mode = mode;
    this.clearTeleportTarget();

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
      this.toScale = this.walkScale * this.mixedScale;
      this.resetPlacement();
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
    this.setFloorDetected(false);

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
    this.placementAnchor.copy(worldPoint);
    this.vecA.copy(this.entryPoint).multiplyScalar(this.walkScale * this.mixedScale)
      .applyQuaternion(this.modelRoot.quaternion);
    this.arAnchorPosition.copy(this.placementAnchor).sub(this.vecA);
    this.arPlaced = true;
    this.modelRoot.visible = true;

    if (this.mode === "ar") {
      // Snap rather than tween: the user is standing where the building goes.
      this.modelRoot.position.copy(this.arAnchorPosition);
      this.modelRoot.scale.setScalar(this.walkScale * this.mixedScale);
      this.toPosition.copy(this.arAnchorPosition);
      this.toScale = this.walkScale * this.mixedScale;
      this.transitionProgress = 1;
    }
    if (this.placementReticle) this.placementReticle.visible = false;
    this.reticlePoint = null;
    this.modelRoot.updateMatrixWorld(true);
    this.setFloorDetected(false);
    this.onPlacementChange?.(true);
    this.onPlaced?.();
  }

  getScale(): number {
    return this.mixedScale;
  }

  setHotspots(hotspots: Hotspot[]): void {
    this.roomHotspots = hotspots.slice(0, 40).map((hotspot) => ({
      ...hotspot, position: { ...hotspot.position },
    }));
    this.roomPage = Math.min(this.roomPage, Math.max(0, Math.ceil(this.roomHotspots.length / 4) - 1));
    if (this.menuView === "rooms") this.rebuildWristMenu();
  }

  placeOnDetectedFloor(): void {
    if (this.mode === "ar" && !this.arPlaced && this.reticlePoint) {
      this.placeAt(this.reticlePoint);
    }
  }

  setScale(scale: number): void {
    if (this.mode !== "ar" || !Number.isFinite(scale)) return;
    this.mixedScale = Math.min(2, Math.max(0.02, scale));
    this.toScale = this.walkScale * this.mixedScale;
    if (this.arPlaced) this.placeAt(this.placementAnchor);
    this.onScaleChange?.(this.mixedScale);
  }

  /** Forgets the AR anchor so the next tap places the model afresh. */
  resetPlacement(): void {
    this.arPlaced = false;
    this.reticlePoint = null;
    this.setFloorDetected(false);
    this.clearTeleportTarget();
    if (this.mode === "ar") this.modelRoot.visible = false;
    if (this.placementReticle) this.placementReticle.visible = false;
    this.onPlacementChange?.(false);
  }

  /** Moves the user to a hotspot, in XR or on the desktop rig. */
  goToHotspot(hotspot: Hotspot): void {
    if (this.mode === "ar" && !this.arPlaced) return;
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

    if (this.isVrSession()) {
      const handsTracked = this.updateHands();
      if (!handsTracked) {
        this.showControllerMenu();
        if (this.mode === "walkthrough") this.updateThumbsticks(deltaSeconds);
      } else if (this.inputMode !== "hands") {
        this.setInputMode("hands");
      }
    } else {
      this.hideMenu();
    }
    this.updateControllerRay();
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
      disposeHierarchy(hand.object);
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
    if (this.mode === "walkthrough" || (this.mode === "ar" && this.arPlaced)) return;

    const session = this.renderer.xr.getSession();
    const referenceSpace = this.renderer.xr.getReferenceSpace();
    if (!session || !referenceSpace) return;

    if (!this.hitTestRequested) {
      this.hitTestRequested = true;
      if (typeof session.requestHitTestSource !== "function") {
        this.onNotice?.("Floor detection is unavailable. Open this space in a browser with WebXR hit-test support.");
        return;
      }
      void (async () => {
        try {
          this.viewerSpace = await session.requestReferenceSpace("viewer");
          const source = await session.requestHitTestSource?.({ space: this.viewerSpace });
          if (this.disposed || this.renderer.xr.getSession() !== session) {
            source?.cancel?.();
            return;
          }
          this.hitTestSource = source ?? null;
        } catch {
          if (this.renderer.xr.getSession() === session) {
            this.onNotice?.("Floor detection was refused. Exit and allow spatial tracking before trying again.");
          }
        }
      })();
      return;
    }

    if (!this.hitTestSource) return;

    const results = frame.getHitTestResults(this.hitTestSource);
    if (results.length === 0) {
      if (this.placementReticle) this.placementReticle.visible = false;
      this.reticlePoint = null;
      this.setFloorDetected(false);
      return;
    }

    const pose = results.map((result) => result.getPose(referenceSpace)).find((candidate) => {
      if (!candidate) return false;
      if (this.mode !== "ar") return true;
      this.worldQuaternion.set(
        candidate.transform.orientation.x, candidate.transform.orientation.y,
        candidate.transform.orientation.z, candidate.transform.orientation.w,
      );
      return this.vecC.set(0, 1, 0).applyQuaternion(this.worldQuaternion).y > 0.9
        && Math.abs(candidate.transform.position.y) <= 0.3;
    });
    if (!pose) {
      this.reticlePoint = null;
      this.setFloorDetected(false);
      if (this.placementReticle) this.placementReticle.visible = false;
      return;
    }

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
    this.setFloorDetected(true);
    if (this.placementReticle) {
      this.placementReticle.visible = !this.arPlaced;
      this.placementReticle.position.copy(world);
      this.placementReticle.position.y += 0.01;
    }
  }

  private clearTeleportTarget(): void {
    this.hoveredButton = null;
    this.activePointer = null;
    this.teleportPoint = null;
    this.hoveredHotspot = null;
    if (this.teleportMarker) this.teleportMarker.visible = false;
  }

  private setFloorDetected(detected: boolean): void {
    if (detected === this.floorDetected) return;
    this.floorDetected = detected;
    this.onFloorDetected?.(detected);
  }

  // =============================================================== hands

  private isVrSession(): boolean {
    return this.renderer.xr.isPresenting && this.getXrSessionMode() === "immersive-vr";
  }

  private setupHands(): void {
    const factory = new XRHandModelFactory();
    for (let index = 0; index < 2; index += 1) {
      const hand = this.renderer.xr.getHand(index);
      hand.addEventListener("connected", this.onHandConnected);
      hand.add(factory.createHandModel(hand, "spheres"));
      this.playerRig.add(hand);
      this.hands.push({ object: hand, touchedButton: null, releasePoint: null });
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
    this.menuHand = menuHand;
    if (menuHand) this.updateWristMenu(menuHand);

    for (const state of this.hands) this.updateHandTouch(state);

    return true;
  }

  private getJoint(hand: XRHandLike, name: string): Object3D | null {
    if (!hand.visible) return null;
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
    if (!this.isVrSession()) {
      this.hideMenu();
      return;
    }
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
      const active = button.action === this.mode;
      button.material.emissiveIntensity = active ? 0.85 : 0.25;
    }
  }

  private hideMenu(): void {
    if (this.menu) this.menu.visible = false;
    this.menuVisible = false;
    this.menuHand = null;
    this.hoveredButton = null;
    this.touchBlockedUntil = 0;
    for (const state of this.hands) {
      state.touchedButton = null;
      state.releasePoint = null;
    }
  }

  private updateHandTouch(state: HandState): void {
    if (!this.isVrSession()) {
      this.hideMenu();
      return;
    }
    const indexTip = this.getJoint(state.object, INDEX_TIP);
    if (!indexTip || !this.menuVisible || state.object === this.menuHand) {
      state.touchedButton = null;
      state.releasePoint = null;
      return;
    }
    indexTip.getWorldPosition(this.vecA);
    if (state.releasePoint) {
      if (state.releasePoint.distanceTo(this.vecA) < 0.065) return;
      state.touchedButton = null;
      state.releasePoint = null;
      this.touchBlockedUntil = performance.now() + 250;
      return;
    }
    const button = this.findButtonAt(this.vecA);
    if (button && performance.now() >= this.touchBlockedUntil) {
      state.touchedButton = button;
      state.releasePoint = this.vecA.clone();
      this.touchBlockedUntil = performance.now() + 350;
      this.controllerSelecting.clear();
      this.clearTeleportTarget();
      this.activateButton(button);
    }
  }

  private findButtonAt(worldPoint: Vector3): MenuButton | null {
    for (const button of this.menuButtons) {
      this.buttonPoint.copy(worldPoint);
      button.root.worldToLocal(this.buttonPoint);
      if (Math.abs(this.buttonPoint.x) <= 0.05 && Math.abs(this.buttonPoint.y) <= 0.0225
        && Math.abs(this.buttonPoint.z) <= 0.018) return button;
    }
    return null;
  }

  private activateButton(button: MenuButton): void {
    if (!this.isVrSession()) return;
    switch (button.action) {
      case "rooms":
        this.menuView = "rooms";
        this.roomPage = 0;
        this.rebuildWristMenu();
        break;
      case "controls":
        this.menuView = "controls";
        this.rebuildWristMenu();
        break;
      case "previous":
        this.roomPage = Math.max(0, this.roomPage - 1);
        this.rebuildWristMenu();
        break;
      case "next":
        this.roomPage = Math.min(Math.max(0, Math.ceil(this.roomHotspots.length / 4) - 1), this.roomPage + 1);
        this.rebuildWristMenu();
        break;
      case "hotspot":
        if (button.hotspot && (this.mode === "walkthrough" || (this.mode === "ar" && this.arPlaced))) {
          this.goToHotspot(button.hotspot);
          this.onHotspotSelect?.(button.hotspot);
        }
        break;
      case "empty": break;
      case "ar": this.setMode("ar"); break;
      case "walkthrough": this.setMode("walkthrough"); break;
      case "smaller": this.setScale(this.mixedScale / 1.25); break;
      case "larger": this.setScale(this.mixedScale * 1.25); break;
      case "actual": this.setScale(1); break;
      case "place": if (this.mode === "ar") this.resetPlacement(); break;
      case "exit": void this.renderer.xr.getSession()?.end().catch(() => {
        this.onNotice?.("Could not exit the session. Use your headset's system menu.");
      }); break;
    }
  }

  private showControllerMenu(): void {
    if (!this.menu || !this.isVrSession()) {
      this.hideMenu();
      return;
    }
    const sources = this.renderer.xr.getSession()?.inputSources;
    if (!sources || !Array.from(sources).some((source) => source.targetRayMode === "tracked-pointer" && source.gamepad && !source.hand)) {
      this.hideMenu();
      return;
    }
    this.menuHand = null;
    this.camera.getWorldPosition(this.vecA);
    this.camera.getWorldDirection(this.vecB);
    this.menu.position.copy(this.vecA).addScaledVector(this.vecB, 0.65);
    this.menu.position.y -= 0.22;
    this.menu.parent?.worldToLocal(this.menu.position);
    this.menu.lookAt(this.vecA);
    this.menu.visible = true;
    this.menuVisible = true;
  }

  private buildWristMenu(): void {
    const menu = new Group();
    menu.name = "MenovaWristMenu";
    menu.visible = false;
    // Renders after the scene so the panel is never occluded by the building.
    menu.renderOrder = 999;

    const definitions: Array<{ action: MenuAction; label: string; hotspot?: Hotspot }> = this.menuView === "rooms" ? [
      { action: "controls", label: "Controls" },
      { action: "empty", label: `Rooms ${this.roomPage + 1}/${Math.max(1, Math.ceil(this.roomHotspots.length / 4))}` },
      ...Array.from({ length: 4 }, (_, index) => {
        const hotspot = this.roomHotspots[this.roomPage * 4 + index];
        return hotspot ? { action: "hotspot" as const, label: hotspot.label, hotspot }
          : { action: "empty" as const, label: index === 0 && this.roomHotspots.length === 0 ? "No hotspots" : "" };
      }),
      { action: "previous", label: "<" },
      { action: "next", label: ">" },
    ] : [
      { action: "ar", label: "Mixed Reality" },
      { action: "walkthrough", label: "VR Walk" },
      { action: "smaller", label: "-" },
      { action: "larger", label: "+" },
      { action: "actual", label: "1:1" },
      { action: "place", label: "Re-place" },
      { action: "exit", label: "Exit XR" },
      { action: "rooms", label: "Rooms" },
    ];

    for (const [index, definition] of definitions.entries()) {
      const root = new Group();
      root.position.set((index % 2 === 0 ? -1 : 1) * 0.06, 0.19 - Math.floor(index / 2) * 0.055, 0);

      const material = new MeshStandardMaterial({
        map: createLabelTexture(definition.label),
        transparent: true,
        emissive: new Color(0x36bfa6),
        emissiveIntensity: 0.25,
        roughness: 0.4,
        metalness: 0,
        side: DoubleSide,
        depthTest: false,
      });

      const mesh = new Mesh(new PlaneGeometry(0.1, 0.045), material);
      mesh.renderOrder = 1000;
      root.add(mesh);
      menu.add(root);

      this.menuButtons.push({ root, mesh, material, action: definition.action, label: definition.label, hotspot: definition.hotspot });
    }

    // Parented to the rig so the menu inherits teleports and rig rotation.
    this.playerRig.add(menu);
    this.menu = menu;
  }

  private rebuildWristMenu(): void {
    const previous = this.menu;
    for (const button of this.menuButtons) {
      button.mesh.geometry.dispose();
      button.material.map?.dispose();
      button.material.dispose();
    }
    this.menuButtons.length = 0;
    this.clearTeleportTarget();
    this.controllerSelecting.clear();
    for (const hand of this.hands) hand.touchedButton = null;
    this.touchBlockedUntil = performance.now() + 500;
    this.buildWristMenu();
    if (previous && this.menu) {
      this.menu.position.copy(previous.position);
      this.menu.quaternion.copy(previous.quaternion);
      this.menu.visible = previous.visible;
      previous.parent?.remove(previous);
    }
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

  private readonly onControllerConnected = (event: { target?: unknown; data?: XRInputSource }) => {
    const controller = event.target as XRControllerLike | undefined;
    if (controller) controller.userData.source = event.data;
    this.detectInputMode();
  };

  private readonly onControllerDisconnected = (event: { target?: unknown }) => {
    const controller = event.target as XRControllerLike | undefined;
    if (controller) {
      this.controllerSelecting.delete(controller);
      delete controller.userData.source;
    }
    this.clearTeleportTarget();
    this.detectInputMode();
  };

  private readonly onSelectStart = (event: { target?: unknown }) => {
    if (!this.isVrSession()) this.hideMenu();
    if (performance.now() < this.touchBlockedUntil
      || this.hands.some((hand) => hand.touchedButton)) return;
    const controller = event.target as XRControllerLike | undefined;
    if (controller) this.controllerSelecting.add(controller);
  };

  private readonly onSelectEnd = (event: { target?: unknown }) => {
    const controller = event.target as XRControllerLike | undefined;
    if (!controller || !this.controllerSelecting.has(controller)) return;
    this.updateControllerRay();
    const ownsTarget = this.activePointer === controller;
    this.controllerSelecting.delete(controller);
    if (!ownsTarget) return;
    if (performance.now() < this.touchBlockedUntil
      || this.hands.some((hand) => hand.touchedButton)) {
      this.clearTeleportTarget();
      return;
    }
    if (this.hoveredButton) {
      const button = this.hoveredButton;
      this.clearTeleportTarget();
      this.activateButton(button);
      return;
    }

    // AR: a tap (screen or trigger) anchors the model on the reticle.
    if (this.mode === "ar" && !this.arPlaced) {
      this.placeOnDetectedFloor();
      return;
    }

    if (this.hoveredHotspot) {
      const hotspot = this.hoveredHotspot;
      this.clearTeleportTarget();
      this.goToHotspot(hotspot);
      this.onHotspotSelect?.(hotspot);
      return;
    }

    if (this.teleportPoint) {
      this.teleportRigTo(this.teleportPoint);
    }
    this.clearTeleportTarget();
  };

  /**
   * Straight-ray pointing from whichever trigger is held: hotspots take
   * priority, then walkable floor for teleporting.
   */
  private updateControllerRay(): void {
    if (!this.isVrSession()) this.hideMenu();
    this.clearTeleportTarget();
    if (this.controllerSelecting.size === 0) {
      return;
    }

    const controller = this.controllerSelecting.values().next().value as
      | XRControllerLike
      | undefined;
    if (!controller || !controller.visible) return;
    this.activePointer = controller;

    controller.getWorldPosition(this.rayOrigin);
    controller.getWorldQuaternion(this.worldQuaternion);
    this.rayDirection.set(0, 0, -1).applyQuaternion(this.worldQuaternion).normalize();

    this.raycaster.set(this.rayOrigin, this.rayDirection);
    this.raycaster.far = 40;

    if (this.isVrSession() && this.menuVisible && this.menu) {
      this.menu.updateWorldMatrix(true, true);
      const menuHit = this.raycaster.intersectObjects(this.menuButtons.map((button) => button.mesh), false)[0];
      this.hoveredButton = this.menuButtons.find((button) => button.mesh === menuHit?.object) ?? null;
      if (this.hoveredButton) {
        this.hoveredButton.material.emissiveIntensity = 1.3;
        return;
      }
    }
    if (this.mode === "dollhouse" || (this.mode === "ar" && !this.arPlaced)) return;

    this.hoveredHotspot = this.hotspots?.hitTest(this.raycaster) ?? null;
    if (this.hoveredHotspot) {
      this.teleportPoint = null;
      if (this.teleportMarker) this.teleportMarker.visible = false;
      return;
    }

    if (this.teleportSurfaces.length === 0) return;

    this.modelRoot.updateWorldMatrix(true, true);
    const hit = this.raycaster.intersectObject(this.modelRoot, true)
      .find((candidate) => (candidate.object as Mesh).isMesh);

    if (!hit?.face || !this.teleportSurfaces.includes(hit.object as Mesh)
      || Math.abs(this.vecC.copy(hit.face.normal)
        .applyMatrix3(this.normalMatrix.getNormalMatrix(hit.object.matrixWorld)).normalize().y) < 0.966) {
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
    if (this.mode === "ar") {
      if (!this.arPlaced) return;
      this.camera.getWorldPosition(this.vecA);
      this.vecA.y = this.playerRig.position.y;
      this.vecA.sub(point);
      this.modelRoot.position.add(this.vecA);
      this.placementAnchor.add(this.vecA);
      this.arAnchorPosition.copy(this.modelRoot.position);
      this.toPosition.copy(this.modelRoot.position);
      this.modelRoot.updateMatrixWorld(true);
      return;
    }
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
    this.savedRigPosition.copy(this.playerRig.position);
    this.savedRigQuaternion.copy(this.playerRig.quaternion);
    this.mixedScale = 1;
    this.onScaleChange?.(1);
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
    this.clearTeleportTarget();
    this.dollhouseAnchorFromHitTest = false;
    this.playerRig.position.copy(this.savedRigPosition);
    this.playerRig.quaternion.copy(this.savedRigQuaternion);
    this.hoveredHotspot = null;
    if (this.teleportMarker) this.teleportMarker.visible = false;
    if (this.placementReticle) this.placementReticle.visible = false;
    this.reticlePoint = null;
    this.arPlaced = false;
    this.setFloorDetected(false);
    this.onPlacementChange?.(false);
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
      if (this.isVrSession() && sources.some((source) => source.hand)) {
        this.setInputMode("hands");
        return;
      }
      if (this.isVrSession() && sources.some((source) => source.targetRayMode === "tracked-pointer" && source.gamepad)) {
        this.setInputMode("controllers");
        return;
      }
      if (sources.some((source) => source.targetRayMode === "screen")) {
        this.setInputMode("touch");
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
  context.fillStyle = "rgba(16, 20, 21, 0.94)";
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = "rgba(54, 191, 166, 0.9)";
  context.stroke();

  context.fillStyle = "#f3f7f5";
  context.font = "600 44px system-ui, -apple-system, 'Segoe UI', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";

  // Wrap on spaces so two-word labels stack instead of overflowing.
  const words = label.split(" ");
  const lines = words.length > 2 ? [words.slice(0, -1).join(" "), words.at(-1)!] : [label];
  const lineHeight = 52;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    context.fillText(line, width / 2, startY + index * lineHeight, width - 48);
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
