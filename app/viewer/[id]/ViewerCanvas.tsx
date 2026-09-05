"use client";

import { useEffect, useRef } from "react";
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  EquirectangularReflectionMapping,
  Group,
  type Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  type Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import {
  ArchPresentationCore,
  type InputMode,
  type PresentationMode,
} from "@/src/needle/ArchPresentationCore";
import { CaptureError, captureHighResolutionPng } from "@/src/viewer/capture";
import { Locomotion } from "@/src/viewer/Locomotion";
import { ModelLoadError, loadModel } from "@/src/viewer/loadModel";
import type { ModelFormat } from "@/lib/constants";
import {
  centerModel,
  createLighting,
  detectTeleportSurfaces,
  disposeHierarchy,
  enableShadows,
} from "@/src/viewer/sceneSetup";

export type XrSessionMode = "immersive-vr" | "immersive-ar";

/** Imperative handle handed to the overlay UI once the scene is live. */
export interface ViewerApi {
  capture4K: () => Promise<void>;
  setMode: (mode: PresentationMode) => void;
  toggleMode: () => void;
  enterXR: (mode: XrSessionMode) => Promise<void>;
  exitXR: () => Promise<void>;
}

export interface ViewerCanvasProps {
  url: string;
  format: ModelFormat;
  title: string;
  /** 0..100 while downloading, or `null` when the size is unknown. */
  onLoadProgress: (percentage: number | null) => void;
  onLoaded: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onModeChange: (mode: PresentationMode) => void;
  onInputModeChange: (mode: InputMode) => void;
  onXrSupport: (support: { vr: boolean; ar: boolean }) => void;
  onXrPresentingChange: (presenting: boolean) => void;
  onReady: (api: ViewerApi) => void;
}

/** Vertical gradient standing in for a sky dome in walkthrough mode. */
function createSkyTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 256;

  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#0e1726");
    gradient.addColorStop(0.48, "#243046");
    gradient.addColorStop(0.52, "#2b2f36");
    gradient.addColorStop(1, "#090b0f");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const texture = new CanvasTexture(canvas);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Owns the entire WebGL lifecycle for one project.
 *
 * Rendering runs on three.js, which is the same layer Needle Engine draws
 * through, so {@link ArchPresentationCore} — the body of the
 * `ArchPresentationController` Needle component — drives XR here unchanged.
 */
export default function ViewerCanvas(props: ViewerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Props are read inside a long-lived effect; a ref keeps the latest
  // callbacks reachable without tearing down the renderer on every render.
  const propsRef = useRef(props);
  propsRef.current = props;

  const { url, format, title } = props;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const abortController = new AbortController();
    let disposed = false;

    // ---------------------------------------------------------- renderer
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        // Required so the 4K capture can read the colour buffer back.
        preserveDrawingBuffer: true,
      });
    } catch (error) {
      propsRef.current.onError(
        error instanceof Error
          ? `WebGL is unavailable: ${error.message}`
          : "This browser could not create a WebGL context.",
      );
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local-floor");

    const canvas = renderer.domElement;
    canvas.dataset.menovaViewer = "true";
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    canvas.tabIndex = 0;
    container.appendChild(canvas);

    // ------------------------------------------------------------- scene
    const scene = new Scene();
    const sky = createSkyTexture();
    scene.background = sky;

    const pmrem = new PMREMGenerator(renderer);
    const environmentRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = environmentRT.texture;

    const camera = new PerspectiveCamera(
      65,
      Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
      0.05,
      2000,
    );

    // The rig is the user's feet; the camera (or headset pose) rides on top.
    const playerRig = new Group();
    playerRig.name = "MenovaPlayerRig";
    playerRig.add(camera);
    scene.add(playerRig);

    const locomotion = new Locomotion(playerRig, camera, canvas);

    let lighting: ReturnType<typeof createLighting> | null = null;
    let presentation: ArchPresentationCore | null = null;
    let modelRoot: Group | null = null;
    let teleportMeshes: Mesh[] = [];

    // --------------------------------------------------------- resizing
    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      propsRef.current.onError(
        "The graphics context was lost, usually because the GPU ran out of memory. Reload the page to continue.",
      );
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    // ------------------------------------------------------ render loop
    let lastFrameTime = performance.now();

    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const delta = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;

      locomotion.update(delta);
      presentation?.update(delta, renderer.xr.getFrame() ?? null);
      renderer.render(scene, camera);
    });

    // ------------------------------------------------------ XR plumbing
    let currentSession: XRSession | null = null;

    const endSession = async () => {
      if (currentSession) await currentSession.end().catch(() => undefined);
    };

    const enterXR = async (mode: XrSessionMode) => {
      if (!navigator.xr) throw new Error("This browser does not support WebXR.");
      if (currentSession) await endSession();

      const optionalFeatures = [
        "local-floor",
        "bounded-floor",
        "hand-tracking",
        "layers",
        ...(mode === "immersive-ar" ? ["hit-test", "plane-detection", "anchors"] : []),
      ];

      const session = await navigator.xr.requestSession(mode, {
        requiredFeatures: ["local-floor"],
        optionalFeatures,
      });

      currentSession = session;
      session.addEventListener("end", () => {
        currentSession = null;
        propsRef.current.onXrPresentingChange(false);
      });

      await renderer.xr.setSession(session);
      propsRef.current.onXrPresentingChange(true);

      // Mixed reality opens straight into the miniature; VR into 1:1.
      presentation?.setMode(mode === "immersive-ar" ? "dollhouse" : "walkthrough");
    };

    void (async () => {
      if (!navigator.xr) {
        propsRef.current.onXrSupport({ vr: false, ar: false });
        return;
      }
      const [vr, ar] = await Promise.all([
        navigator.xr.isSessionSupported("immersive-vr").catch(() => false),
        navigator.xr.isSessionSupported("immersive-ar").catch(() => false),
      ]);
      if (!disposed) propsRef.current.onXrSupport({ vr, ar });
    })();

    // ------------------------------------------------------- model load
    void (async () => {
      try {
        const loaded = await loadModel(url, format, {
          renderer,
          signal: abortController.signal,
          onProgress: ({ percentage }) => propsRef.current.onLoadProgress(percentage),
        });

        if (disposed) {
          disposeHierarchy(loaded);
          return;
        }

        modelRoot = loaded;
        modelRoot.name = title || "Model";

        const bounds = centerModel(modelRoot);
        enableShadows(modelRoot);
        scene.add(modelRoot);

        lighting = createLighting(scene, bounds.radius, renderer);
        teleportMeshes = detectTeleportSurfaces(modelRoot, bounds).map(
          (surface) => surface.mesh,
        );

        if (teleportMeshes.length === 0) {
          propsRef.current.onNotice(
            "No walkable floor was detected, so VR teleporting is disabled for this model.",
          );
        }

        // Start just outside the footprint, facing the building.
        const start = new Vector3(0, 0, Math.max(bounds.radius * 1.15, 2.5));
        locomotion.teleportTo(start, 0);

        presentation = new ArchPresentationCore({
          renderer,
          scene,
          camera,
          playerRig,
          modelRoot,
          teleportSurfaces: teleportMeshes,
          locomotion,
          environment: sky,
          onModeChange: (mode) => propsRef.current.onModeChange(mode),
          onInputModeChange: (mode) => propsRef.current.onInputModeChange(mode),
          onNotice: (message) => propsRef.current.onNotice(message),
        });

        const api: ViewerApi = {
          capture4K: async () => {
            try {
              await captureHighResolutionPng({
                renderer,
                scene,
                camera,
                filename: (title || "menova-render").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase(),
              });
            } catch (error) {
              throw error instanceof CaptureError
                ? error
                : new CaptureError("The render could not be captured.");
            }
          },
          setMode: (mode) => presentation?.setMode(mode),
          toggleMode: () => presentation?.toggleMode(),
          enterXR,
          exitXR: endSession,
        };

        propsRef.current.onReady(api);
        propsRef.current.onLoaded();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        propsRef.current.onError(
          error instanceof ModelLoadError || error instanceof Error
            ? error.message
            : "The model could not be loaded.",
        );
      }
    })();

    // ----------------------------------------------------------- cleanup
    return () => {
      disposed = true;
      abortController.abort();

      renderer.setAnimationLoop(null);
      void endSession();

      resizeObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);

      presentation?.dispose();
      locomotion.dispose();
      lighting?.dispose();

      if (modelRoot) {
        scene.remove(modelRoot);
        disposeHierarchy(modelRoot);
      }

      teleportMeshes = [];
      environmentRT.texture.dispose();
      pmrem.dispose();
      sky.dispose();
      scene.clear();

      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
    // The renderer is intentionally rebuilt only when the model changes.
  }, [url, format, title]);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}
