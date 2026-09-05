import { Box3, type Group, Vector3, type WebGLRenderer } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import type { ModelFormat } from "@/lib/constants";

const DEFAULT_DRACO_PATH = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
const DEFAULT_KTX2_PATH = "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/";

export interface LoadProgress {
  /** Bytes transferred so far. */
  loaded: number;
  /** Total bytes, or 0 when the server did not send a content length. */
  total: number;
  /** 0..100, or `null` when the total is unknown. */
  percentage: number | null;
}

export interface LoadModelOptions {
  /** Renderer, required to detect supported KTX2 transcoder formats. */
  renderer: WebGLRenderer;
  onProgress?: (progress: LoadProgress) => void;
  /** Aborts the load; the returned promise rejects with `AbortError`. */
  signal?: AbortSignal;
}

export class ModelLoadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ModelLoadError";
  }
}

interface ThreeLoaderLike<T> {
  load(
    url: string,
    onLoad: (result: T) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void;
}

/** Wraps a three.js loader's callback API in an abortable promise. */
function loadWithLoader<T>(
  loader: ThreeLoaderLike<T>,
  url: string,
  hint: string,
  { onProgress, signal }: Omit<LoadModelOptions, "renderer">,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Model load aborted.", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });

    const settle = <V>(fn: (value: V) => void) => (value: V) => {
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };

    loader.load(
      url,
      settle(resolve),
      (event: ProgressEvent) => {
        if (!onProgress) return;
        const total = event.lengthComputable ? event.total : 0;
        onProgress({
          loaded: event.loaded,
          total,
          percentage: total > 0 ? Math.min(100, (event.loaded / total) * 100) : null,
        });
      },
      settle((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown loader failure";
        reject(new ModelLoadError(`Could not load the model. ${message}. ${hint}`, error));
      }),
    );
  });
}

/**
 * Loads a binary glTF with Draco, Meshopt and KTX2 support enabled.
 *
 * Architectural exports from Revit/Rhino/Blender are almost always Draco
 * compressed, so the decoder is wired up unconditionally; the WASM module is
 * only fetched when a compressed primitive is actually encountered.
 */
async function loadGlb(url: string, options: LoadModelOptions): Promise<Group> {
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(
    process.env.NEXT_PUBLIC_DRACO_DECODER_PATH || DEFAULT_DRACO_PATH,
  );

  const ktx2Loader = new KTX2Loader()
    .setTranscoderPath(process.env.NEXT_PUBLIC_KTX2_TRANSCODER_PATH || DEFAULT_KTX2_PATH)
    .detectSupport(options.renderer);

  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  loader.setKTX2Loader(ktx2Loader);
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setCrossOrigin("anonymous");

  try {
    const gltf = await loadWithLoader(
      loader,
      url,
      "Check that the Blob URL is public and that the file is a valid .glb.",
      options,
    );
    return gltf.scene;
  } finally {
    // Decoder worker pools are per-loader; release them once the parse is done.
    dracoLoader.dispose();
    ktx2Loader.dispose();
  }
}

/**
 * FBX has no fixed unit. Exporters commonly write centimetres (3ds Max, Maya,
 * SketchUp) or millimetres (Revit), while the viewer's 1:1 mode assumes
 * metres. A building larger than these thresholds is far more likely to be a
 * unit mismatch than a genuine mega-structure, so we rescale it.
 */
function normaliseFbxUnits(root: Group): void {
  const size = new Box3().setFromObject(root).getSize(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largest) || largest <= 0) return;

  if (largest > 30_000) {
    root.scale.multiplyScalar(0.001);
  } else if (largest > 400) {
    root.scale.multiplyScalar(0.01);
  }
  root.updateMatrixWorld(true);
}

/** Loads a binary or ASCII FBX, with embedded textures. */
async function loadFbx(url: string, options: LoadModelOptions): Promise<Group> {
  const loader = new FBXLoader();
  loader.setCrossOrigin("anonymous");

  const root = await loadWithLoader(
    loader,
    url,
    "Check that the file is a valid FBX (version 6400 or newer) and that textures are embedded.",
    options,
  );
  normaliseFbxUnits(root);
  return root;
}

/**
 * Loads a model of the given format into a three.js `Group`.
 *
 * SketchUp `.skp` is a proprietary container with no browser-side parser, so
 * it is rejected here; the viewer shows a download/export prompt instead.
 */
export async function loadModel(
  url: string,
  format: ModelFormat,
  options: LoadModelOptions,
): Promise<Group> {
  if (options.signal?.aborted) {
    throw new DOMException("Model load aborted before it started.", "AbortError");
  }

  switch (format) {
    case "glb":
      return loadGlb(url, options);
    case "fbx":
      return loadFbx(url, options);
    case "skp":
      throw new ModelLoadError(
        "SketchUp files cannot be rendered in the browser. Export the model to .glb or .fbx from SketchUp and upload that instead.",
      );
  }
}
