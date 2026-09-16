export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "CONFIGURATION_ERROR"
  | "DATABASE_ERROR"
  | "INTERNAL_ERROR"
  | "UNKNOWN_ERROR";

export type ApiErrorDetails = Record<string, string | number | boolean>;

export type ApiErrorResponse = {
  error: string;
  code?: ApiErrorCode;
  action?: string;
  stage?: string;
  field?: string;
  requestId?: string;
  retryable?: boolean;
  details?: ApiErrorDetails;
  // Kept for compatibility with the existing booking diagnostics.
  debug?: {
    requestId?: string;
    action?: string;
    stage?: string;
    type?: string;
    serverTime?: string;
    [key: string]: unknown;
  };
};

export type NormalizedApiError = {
  message: string;
  code: ApiErrorCode;
  action?: string;
  stage?: string;
  field?: string;
  requestId?: string;
  retryable: boolean;
  details?: ApiErrorDetails;
  status?: number;
  endpoint?: string;
  cause?: string;
};

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "AUTHENTICATION_REQUIRED",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  502: "UPSTREAM_ERROR",
  503: "UPSTREAM_ERROR",
  504: "TIMEOUT",
};

export function requestIdFromHeaders(headers: Headers): string | undefined {
  return headers.get("x-goko-request-id") || headers.get("x-request-id") || undefined;
}

export function codeForStatus(status?: number): ApiErrorCode {
  if (status && STATUS_CODES[status]) return STATUS_CODES[status];
  if (status && status >= 500) return "INTERNAL_ERROR";
  return "UNKNOWN_ERROR";
}

export function retryableForCode(code: ApiErrorCode, status?: number): boolean {
  return code === "NETWORK_ERROR" || code === "TIMEOUT" || code === "RATE_LIMITED" ||
    code === "UPSTREAM_ERROR" || (status !== undefined && status >= 500);
}

export function normalizeApiError(input: {
  response?: Response;
  data?: unknown;
  action?: string;
  endpoint?: string;
  error?: unknown;
}): NormalizedApiError {
  const data = isApiErrorResponse(input.data) ? input.data : undefined;
  const status = input.response?.status;
  const message = data?.error || errorMessage(input.error) || fallbackMessage(status);
  const code = data?.code || (isNetworkError(input.error) ? "NETWORK_ERROR" : codeForStatus(status));
  const requestId = data?.requestId || data?.debug?.requestId ||
    (input.response ? requestIdFromHeaders(input.response.headers) : undefined);
  const cause = errorMessage(input.error);

  return {
    message,
    code,
    action: data?.action || input.action,
    stage: data?.stage || data?.debug?.stage,
    field: data?.field,
    requestId,
    retryable: data?.retryable ?? retryableForCode(code, status),
    details: data?.details,
    status,
    endpoint: input.endpoint,
    cause: cause && cause !== message ? cause : undefined,
  };
}

export function serializeSafeErrorDetails(error: NormalizedApiError): string {
  return JSON.stringify({
    code: error.code,
    action: error.action,
    stage: error.stage,
    field: error.field,
    requestId: error.requestId,
    retryable: error.retryable,
    status: error.status,
    endpoint: error.endpoint,
    details: error.details,
  });
}

export function apiErrorBody(data: {
  error: string;
  code: ApiErrorCode;
  requestId: string;
  action?: string;
  stage?: string;
  field?: string;
  retryable?: boolean;
  details?: ApiErrorDetails;
}) {
  return {
    error: data.error,
    code: data.code,
    requestId: data.requestId,
    ...(data.action ? { action: data.action } : {}),
    ...(data.stage ? { stage: data.stage } : {}),
    ...(data.field ? { field: data.field } : {}),
    retryable: data.retryable ?? retryableForCode(data.code),
    ...(data.details ? { details: data.details } : {}),
  } satisfies ApiErrorResponse;
}

export function getRequestId(request: Request): string {
  return request.headers.get("x-goko-request-id") || crypto.randomUUID();
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return Boolean(value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string");
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === "string" && error ? error : undefined;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || /network|fetch|offline|timeout/i.test(errorMessage(error) || "");
}

function fallbackMessage(status?: number): string {
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 404) return "The requested item could not be found.";
  if (status === 409) return "This item changed elsewhere. Refresh and try again.";
  if (status && status >= 500) return "The server could not complete this request. Please try again.";
  return "The request could not be completed.";
}
