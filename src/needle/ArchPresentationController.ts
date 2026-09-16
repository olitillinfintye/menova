import { Behaviour, GameObject, serializable } from "@needle-tools/engine";
// Types only. Needle ships its own three build (`@needle-tools/three`) and a
// Needle project aliases `three` to it, so importing a three *value* here would
// risk two class identities in the same graph.
import type { Mesh, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from "three";

import {
  ArchPresentationCore,
  type InputMode,
  type PresentationMode,
} from "@/src/needle/ArchPresentationCore";
import type { Locomotion } from "@/src/viewer/Locomotion";
import {
  centerModel,
  detectTeleportSurfaces,
  enableShadows,
  type ModelBounds,
} from "@/src/viewer/sceneSetup";

/**
 * Needle Engine component that turns any loaded building into a Quest-ready
 * architectural presentation.
 *
 * Attach it to the root object of the imported `.glb`:
 *
 * ```ts
 * const controller = GameObject.addComponent(modelRoot, ArchPresentationController);
 * controller.dollhouseScale = 0.02;
 * ```
 *
 * All of the runtime behaviour lives in {@link ArchPresentationCore}, which
 * talks to `WebGLRenderer.xr` directly. Needle renders through the same
 * renderer, so this class only has to bind the engine context to the core and
 * forward the frame loop — and the identical logic powers the standalone
 * three.js viewer, where Needle is not loaded at all.
 *
 * Modes:
 *  - **A — 1:1 walkthrough**: scale 1.0, virtual skybox, floor at Y=0.
 *  - **B — dollhouse / MR**: scale 0.02, passthrough background, miniature
 *    snapped to a detected physical surface.
 */
export class ArchPresentationController extends Behaviour {
  /** Scale applied in dollhouse mode (1:50 by default). */
  @serializable()
  dollhouseScale = 0.02;

  /** Scale applied in 1:1 walkthrough mode. */
  @serializable()
  walkScale = 1.0;

  /** Seconds spent tweening between the two modes. */
  @serializable()
  transitionSeconds = 0.9;

  /** Centre the model, enable shadows and detect floors on start. */
  @serializable()
  autoSetupScene = true;

  /** Attach Needle's `TeleportTarget` to every detected walkable surface. */
  @serializable()
  attachTeleportTargets = true;

  /** Mode the experience opens in. */
  @serializable()
  startMode: PresentationMode = "walkthrough";

  /** Optional explicit rig. Defaults to the main camera's parent. */
  @serializable()
  playerRig?: Object3D;

  private core: ArchPresentationCore | null = null;
  private bounds: ModelBounds | null = null;
  private teleportMeshes: Mesh[] = [];
  private locomotion: Locomotion | null = null;

  // ------------------------------------------------------------- lifecycle

  start(): void {
    const renderer = this.context.renderer as WebGLRenderer | undefined;
    const scene = this.context.scene as Scene | undefined;
    const camera = this.context.mainCamera as PerspectiveCamera | undefined;

    if (!renderer || !scene || !camera) {
      console.error(
        "[ArchPresentationController] Needle context is missing a renderer, scene or main camera; the component will stay inactive.",
      );
      return;
    }

    const modelRoot = this.gameObject;

    try {
      if (this.autoSetupScene) {
        this.bounds = centerModel(modelRoot);
        enableShadows(modelRoot);
      }

      if (this.bounds) {
        const surfaces = detectTeleportSurfaces(modelRoot, this.bounds);
        this.teleportMeshes = surfaces.map((surface) => surface.mesh);
        if (this.attachTeleportTargets) this.applyTeleportTargets();
      }
    } catch (error) {
      console.error("[ArchPresentationController] Scene preparation failed:", error);
    }

    this.core = new ArchPresentationCore({
      renderer,
      getXrSessionMode: () => this.context.xrSessionMode ?? null,
      scene,
      camera,
      playerRig: this.resolvePlayerRig(camera, scene),
      modelRoot,
      teleportSurfaces: this.teleportMeshes,
      locomotion: this.locomotion,
      environment: scene.background ?? null,
      dollhouseScale: this.dollhouseScale,
      walkScale: this.walkScale,
      transitionSeconds: this.transitionSeconds,
      onModeChange: (mode) => this.emitDomEvent("modechange", { mode }),
      onInputModeChange: (mode) => this.emitDomEvent("inputmodechange", { mode }),
      onNotice: (message) => console.info("[ArchPresentationController]", message),
    });

    if (this.startMode === "dollhouse") this.core.setMode("dollhouse", true);
  }

  update(): void {
    if (!this.core) return;
    const renderer = this.context.renderer as WebGLRenderer | undefined;
    // `getFrame()` returns the XRFrame for the frame currently being rendered,
    // or null outside an immersive session.
    const frame = renderer?.xr.getFrame() ?? null;
    this.core.update(this.context.time.deltaTime, frame);
  }

  onDestroy(): void {
    this.core?.dispose();
    this.core = null;
  }

  // ---------------------------------------------------------- public API

  /** Switches to the miniature mixed-reality view. */
  enterDollhouse(): void {
    this.core?.setMode("dollhouse");
  }

  /** Switches to the full-size virtual walkthrough. */
  enterWalkthrough(): void {
    this.core?.setMode("walkthrough");
  }

  toggleMode(): void {
    this.core?.toggleMode();
  }

  get mode(): PresentationMode {
    return this.core?.getMode() ?? this.startMode;
  }

  get inputMode(): InputMode | null {
    return this.core?.getInputMode() ?? null;
  }

  /** Detected walkable meshes, populated during `start()`. */
  get walkableSurfaces(): readonly Mesh[] {
    return this.teleportMeshes;
  }

  /**
   * Supplies the desktop/mobile fallback controller.
   *
   * Call before the component starts (or immediately after adding it) so the
   * core can enable and disable it around XR sessions.
   */
  setLocomotion(locomotion: Locomotion | null): void {
    this.locomotion = locomotion;
  }

  // ------------------------------------------------------------ internals

  /**
   * The rig is the object the headset pose is applied *inside*, so teleporting
   * means moving the rig, never the camera. Needle nests the main camera under
   * its XR rig, which is exactly what we want; falling back to the scene keeps
   * the component usable in a flat hierarchy.
   */
  private resolvePlayerRig(camera: PerspectiveCamera, scene: Scene): Object3D {
    if (this.playerRig) return this.playerRig;
    if (camera.parent && camera.parent !== scene) return camera.parent;
    return camera.parent ?? scene;
  }

  /**
   * Adds Needle's `TeleportTarget` to each detected floor.
   *
   * Resolved dynamically because the symbol has moved between Needle releases;
   * when it is unavailable the core still provides controller-ray teleporting
   * against the same mesh list, so locomotion degrades rather than breaking.
   */
  private applyTeleportTargets(): void {
    const engine = globalThis as unknown as {
      NeedleEngine?: Record<string, unknown>;
    };

    const teleportTargetType =
      (engine.NeedleEngine?.TeleportTarget as (new () => object) | undefined) ??
      (needleExports()?.TeleportTarget as (new () => object) | undefined);

    if (!teleportTargetType) {
      console.info(
        "[ArchPresentationController] TeleportTarget is unavailable in this Needle build; falling back to raycast teleporting.",
      );
      return;
    }

    for (const mesh of this.teleportMeshes) {
      try {
        GameObject.addComponent(mesh, teleportTargetType as never);
      } catch (error) {
        console.warn(
          `[ArchPresentationController] Could not add TeleportTarget to "${mesh.name}":`,
          error,
        );
      }
    }
  }

  /**
   * Emits a DOM event on the engine's container so app UI can react.
   *
   * Deliberately not named `dispatchEvent`: Needle's `Component` already
   * inherits the DOM `dispatchEvent(evt: Event): boolean` signature.
   */
  private emitDomEvent(type: string, detail: Record<string, unknown>): void {
    try {
      const target = this.context.domElement as EventTarget | undefined;
      target?.dispatchEvent(new CustomEvent(`menova:${type}`, { detail, bubbles: true }));
    } catch {
      /* the engine may not expose a DOM element in headless tests */
    }
  }
}

/**
 * Late-bound handle on the engine module.
 *
 * Populated by `registerNeedleExports` so this file never has to statically
 * import a symbol that may not exist in the installed Needle version.
 */
let needleModule: Record<string, unknown> | null = null;

function needleExports(): Record<string, unknown> | null {
  return needleModule;
}

/**
 * Optional wiring for `TeleportTarget` and other engine symbols.
 *
 * ```ts
 * import * as Needle from "@needle-tools/engine";
 * registerNeedleExports(Needle);
 * ```
 */
export function registerNeedleExports(module: Record<string, unknown>): void {
  needleModule = module;
}
