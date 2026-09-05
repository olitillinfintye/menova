/**
 * A named viewpoint inside a model. `position` is the user's feet in the
 * model's local space (metres), `yaw` the heading in radians.
 */
export interface Hotspot {
  id: string;
  label: string;
  position: { x: number; y: number; z: number };
  yaw: number;
}

/** A project row as returned by the API. */
export interface Project {
  id: string;
  title: string;
  /** Public Vercel Blob URL of the model file. */
  blobUrl: string;
  /** Blob store pathname, required by `del()` and for auditing. */
  blobPathname: string;
  sizeBytes: number;
  /** ISO-8601 timestamp. */
  createdAt: string;
  ownerId: string;
  hotspots: Hotspot[];
}

/** Payload the browser attaches to `upload()` and the server validates. */
export interface UploadClientPayload {
  title: string;
  sizeBytes: number;
  /** Idempotency key shared by the webhook and the client fallback. */
  uploadRef: string;
}

/** Payload embedded in the blob client token and echoed to the webhook. */
export interface UploadTokenPayload extends UploadClientPayload {
  projectId: string;
  ownerId: string;
}

export interface ProjectListResponse {
  projects: Project[];
}

export interface ProjectResponse {
  project: Project;
}
