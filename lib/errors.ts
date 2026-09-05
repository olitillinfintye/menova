/** Discriminated error codes surfaced to API clients. */
export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "file_too_large"
  | "invalid_file_type"
  | "conflict"
  | "misconfigured"
  | "internal_error";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  file_too_large: 413,
  invalid_file_type: 415,
  conflict: 409,
  misconfigured: 500,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const unauthorized = (msg = "Authentication required.") =>
  new ApiError("unauthorized", msg);
export const forbidden = (msg = "You do not have access to this project.") =>
  new ApiError("forbidden", msg);
export const notFound = (msg = "Project not found.") =>
  new ApiError("not_found", msg);
export const invalidRequest = (msg: string, details?: unknown) =>
  new ApiError("invalid_request", msg, details);

/** Normalises anything thrown inside a route handler into an `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  const message = error instanceof Error ? error.message : String(error);

  // `@vercel/blob` and `@vercel/postgres` throw plain Errors; surface the
  // message for operators but never leak connection strings.
  return new ApiError(
    "internal_error",
    message.replace(/postgres:\/\/[^\s"']+/gi, "postgres://[redacted]"),
  );
}

/** Serialisable error body shared by every route. */
export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  details?: unknown;
}

export function errorBody(error: ApiError): ApiErrorBody {
  return {
    error: error.message,
    code: error.code,
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}
