import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { Vector2 } from "three";

export const CAPTURE_WIDTH_4K = 3840;
export const CAPTURE_HEIGHT_4K = 2160;

export interface CaptureOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  width?: number;
  height?: number;
  /** Download filename, without extension. */
  filename?: string;
}

export class CaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureError";
  }
}

/**
 * Largest drawing buffer the GPU will give us, so a 4K request degrades
 * gracefully on mobile instead of returning a blank image.
 */
function maxDrawingBufferSize(renderer: WebGLRenderer): Vector2 {
  const gl = renderer.getContext();
  const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
  const maxRenderbuffer = (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) || 4096;
  const limit = new Vector2(
    Math.min(dims?.[0] ?? maxRenderbuffer, maxRenderbuffer),
    Math.min(dims?.[1] ?? maxRenderbuffer, maxRenderbuffer),
  );
  return limit;
}

/**
 * Renders one off-screen frame at presentation resolution and downloads it.
 *
 * The canvas is temporarily resized (with `updateStyle = false`, so the on-page
 * layout never reflows), rendered once, read back with `toDataURL` and then
 * restored — including the camera aspect ratio, which would otherwise leave the
 * live view stretched.
 *
 * Requires the renderer to be created with `preserveDrawingBuffer: true`;
 * without it the colour buffer is undefined by the time `toDataURL` runs.
 */
export async function captureHighResolutionPng(options: CaptureOptions): Promise<void> {
  const {
    renderer,
    scene,
    camera,
    width = CAPTURE_WIDTH_4K,
    height = CAPTURE_HEIGHT_4K,
    filename = "menova-render",
  } = options;

  if (renderer.xr.isPresenting) {
    throw new CaptureError(
      "Renders cannot be captured while an immersive session is running. Exit XR and try again.",
    );
  }

  if (renderer.getContext().isContextLost()) {
    throw new CaptureError("The WebGL context was lost. Reload the page and try again.");
  }

  const limit = maxDrawingBufferSize(renderer);
  const targetWidth = Math.max(1, Math.min(Math.floor(width), limit.x));
  const targetHeight = Math.max(1, Math.min(Math.floor(height), limit.y));

  // Snapshot everything we are about to mutate.
  const previousSize = renderer.getSize(new Vector2());
  const previousPixelRatio = renderer.getPixelRatio();
  const previousAspect = camera.aspect;
  const wasXrEnabled = renderer.xr.enabled;

  let dataUrl: string;

  try {
    // `xr.enabled` forces the renderer to use the XR framebuffer; it must be
    // off for a plain off-screen render even outside a session.
    renderer.xr.enabled = false;
    renderer.setPixelRatio(1);
    renderer.setSize(targetWidth, targetHeight, false);

    camera.aspect = targetWidth / targetHeight;
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);

    // Must happen in the same task as the render: the browser may clear the
    // drawing buffer at the next paint.
    dataUrl = renderer.domElement.toDataURL("image/png");
  } catch (error) {
    throw new CaptureError(
      error instanceof Error
        ? `Render capture failed: ${error.message}`
        : "Render capture failed for an unknown reason.",
    );
  } finally {
    renderer.setPixelRatio(previousPixelRatio);
    renderer.setSize(previousSize.x, previousSize.y, false);
    camera.aspect = previousAspect;
    camera.updateProjectionMatrix();
    renderer.xr.enabled = wasXrEnabled;
    // Repaint immediately so the user never sees the resized frame.
    if (!renderer.xr.isPresenting) renderer.render(scene, camera);
  }

  if (!dataUrl || dataUrl.length < 128 || dataUrl === "data:,") {
    throw new CaptureError(
      "The captured frame was empty. Ensure the renderer was created with `preserveDrawingBuffer: true`.",
    );
  }

  downloadDataUrl(dataUrl, `${filename}-${targetWidth}x${targetHeight}.png`);
}

/** Triggers a browser download for a data URL. */
function downloadDataUrl(dataUrl: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  // Give Safari a tick to start the download before detaching the node.
  setTimeout(() => anchor.remove(), 0);
}
