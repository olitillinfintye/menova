/** A project row as returned by the API. */
export interface Project {
  id: string;
  title: string;
  /** Public Vercel Blob URL of the `.glb`. */
  blobUrl: string;
  /** Blob store pathname, required by `del()` and for auditing. */
  blobPathname: string;
  sizeBytes: number;
  /** ISO-8601 timestamp. */
  createdAt: string;
  ownerId: string;
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
