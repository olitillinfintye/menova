import { ApiError, invalidRequest } from "@/lib/errors";

export const SITE_VIDEO_SLOTS = { home: "Homepage", devices: "Devices" } as const;
export const DEFAULT_SITE_VIDEO_URL = "/media/3D_Interior_animation.mp4";
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const VIDEO_CONTENT_TYPES = ["video/mp4", "video/webm"] as const;

export type SiteVideoSlot = keyof typeof SITE_VIDEO_SLOTS;
export interface SiteVideo {
  url: string;
  filename: string;
  sizeBytes: number | null;
  updatedAt: string | null;
}
export type SiteVideos = Record<SiteVideoSlot, SiteVideo>;

export function isSiteVideoSlot(value: unknown): value is SiteVideoSlot {
  return value === "home" || value === "devices";
}

export function defaultSiteVideos(): SiteVideos {
  const video: SiteVideo = {
    url: DEFAULT_SITE_VIDEO_URL,
    filename: "3D_Interior_animation.mp4",
    sizeBytes: null,
    updatedAt: null,
  };
  return { home: { ...video }, devices: { ...video } };
}

export function validateVideoFile(filename: unknown, sizeBytes: unknown, contentType?: string): typeof VIDEO_CONTENT_TYPES[number] {
  if (typeof filename !== "string" || !filename.trim() || filename.length > 180) {
    throw invalidRequest("Choose a video with a filename of at most 180 characters.");
  }
  const extension = filename.match(/\.(mp4|webm)$/i)?.[1].toLowerCase();
  if (!extension) throw new ApiError("invalid_file_type", "Choose an MP4 or WebM video.");
  const expectedType = extension === "mp4" ? "video/mp4" : "video/webm";
  if (contentType && contentType !== expectedType) {
    throw new ApiError("invalid_file_type", "The video type must match its file extension.");
  }
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw invalidRequest("Choose a non-empty video file.");
  }
  if (sizeBytes > MAX_VIDEO_BYTES) {
    throw new ApiError("file_too_large", "Videos must be 100 MB or smaller.");
  }
  return expectedType;
}

export function parseVideoPathname(pathname: unknown): { slot: SiteVideoSlot; contentType: typeof VIDEO_CONTENT_TYPES[number] } {
  if (typeof pathname !== "string") throw invalidRequest("Choose an uploaded site video.");
  const match = pathname.match(/^site-videos\/(home|devices)\/[a-zA-Z0-9_-]{8,120}\.(mp4|webm)$/);
  if (!match || !isSiteVideoSlot(match[1])) throw invalidRequest("Choose an uploaded site video for this section.");
  return { slot: match[1], contentType: match[2] === "mp4" ? "video/mp4" : "video/webm" };
}