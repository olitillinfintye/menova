import { isProjectId } from "@/lib/constants";
import { ApiError, invalidRequest } from "@/lib/errors";

export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
export const THUMBNAIL_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
export const THUMBNAIL_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function validateThumbnailFile(filename: unknown, sizeBytes: unknown, contentType?: string): typeof THUMBNAIL_CONTENT_TYPES[number] {
  if (typeof filename !== "string" || !filename.trim() || filename.length > 180) {
    throw invalidRequest("Choose an image with a filename of at most 180 characters.");
  }
  const extension = filename.match(/\.(jpe?g|png|webp)$/i)?.[1].toLowerCase();
  if (!extension) throw new ApiError("invalid_file_type", "Choose a JPG, PNG, or WebP image.");
  const expectedType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  if (contentType && contentType !== expectedType) {
    throw new ApiError("invalid_file_type", "The image type must match its file extension.");
  }
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw invalidRequest("Choose a non-empty image file.");
  }
  if (sizeBytes > MAX_THUMBNAIL_BYTES) throw new ApiError("file_too_large", "Thumbnails must be 5 MB or smaller.");
  return expectedType;
}

export function parseThumbnailPathname(pathname: unknown): { projectId: string; contentType: typeof THUMBNAIL_CONTENT_TYPES[number] } {
  if (typeof pathname !== "string") throw invalidRequest("Choose an uploaded project thumbnail.");
  const match = pathname.match(/^project-thumbnails\/([^/]+)\/[a-zA-Z0-9_-]{8,120}\.(jpg|jpeg|png|webp)$/);
  if (!match || !isProjectId(match[1])) throw invalidRequest("Choose a thumbnail uploaded for this project.");
  return { projectId: match[1], contentType: validateThumbnailFile(pathname.split("/").at(-1), 1) };
}