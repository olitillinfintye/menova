/**
 * Platform-wide constants. This module is imported by both server and client
 * code, so it must stay free of any Node-only imports.
 */

/** Hard ceiling for a single model upload: 30MB. */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

/** Model containers the platform accepts. */
export type ModelFormat = "glb" | "fbx" | "skp";

export const ALLOWED_EXTENSIONS = [".glb", ".fbx", ".skp"] as const;

/** Human-facing description of each format and how the viewer treats it. */
export const MODEL_FORMATS: Record<
  ModelFormat,
  { label: string; extension: string; description: string; walkthrough: boolean }
> = {
  glb: {
    label: "glTF Binary",
    extension: ".glb",
    description: "Best quality and fastest load. Draco, Meshopt and KTX2 supported.",
    walkthrough: true,
  },
  fbx: {
    label: "Autodesk FBX",
    extension: ".fbx",
    description: "Binary or ASCII. Embed textures on export so they travel with the file.",
    walkthrough: true,
  },
  skp: {
    label: "SketchUp",
    extension: ".skp",
    description:
      "Stored and shareable for download. Export to .glb or .fbx from SketchUp for the interactive walkthrough.",
    walkthrough: false,
  },
};

/** Value for `<input accept>` covering every supported format. */
export const FILE_INPUT_ACCEPT =
  ".glb,.fbx,.skp,model/gltf-binary,application/octet-stream";

/**
 * Browsers are inconsistent about model MIME types: Chrome reports
 * `model/gltf-binary` for `.glb`, Safari and most file pickers fall back to
 * `application/octet-stream`, and some report an empty string. We accept the
 * common variants and rely on the extension check as the authoritative gate.
 */
export const ALLOWED_CONTENT_TYPES = [
  "model/gltf-binary",
  "application/octet-stream",
  "application/x-binary",
  "application/vnd.sketchup.skp",
  "application/fbx",
  "model/fbx",
] as const;

/** Prefix applied to every generated project identifier. */
export const PROJECT_ID_PREFIX = "proj_";

/** Number of random characters after the prefix (`proj_a7f29c1d`). */
export const PROJECT_ID_LENGTH = 8;

/** Blob store folder that all uploaded models live under. */
export const BLOB_FOLDER = "models";

/** Matches `proj_` followed by exactly 8 lowercase alphanumeric characters. */
export const PROJECT_ID_PATTERN = /^proj_[a-z0-9]{8}$/;

/** Returns the model format for `name`, or `null` when the extension is unsupported. */
export function getModelFormat(name: string): ModelFormat | null {
  const lower = name.trim().toLowerCase();
  // Query strings on Blob URLs must not defeat the extension check.
  const clean = lower.split(/[?#]/)[0];
  if (clean.endsWith(".glb")) return "glb";
  if (clean.endsWith(".fbx")) return "fbx";
  if (clean.endsWith(".skp")) return "skp";
  return null;
}

/** True when `name` ends with a supported model extension (case-insensitive). */
export function isSupportedModelFilename(name: string): boolean {
  return getModelFormat(name) !== null;
}

/** Strips the model extension from a filename, for use as a default title. */
export function stripModelExtension(name: string): string {
  return name.replace(/\.(glb|fbx|skp)$/i, "");
}

/** True when `id` is a syntactically valid project id. */
export function isProjectId(id: string): boolean {
  return PROJECT_ID_PATTERN.test(id);
}

/** Human readable byte size, e.g. `12.4 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/** Absolute, shareable URL for a project's viewer page. */
export function buildViewerUrl(projectId: string, origin?: string): string {
  const base =
    origin ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base.replace(/\/$/, "")}/viewer/${projectId}`;
}
