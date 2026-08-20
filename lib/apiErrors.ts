import { NextResponse } from "next/server";
import { logger } from "./logger";

export type ApiErrorCode =
  | "invalid_request"
  | "invalid_json"
  | "authentication_required"
  | "invalid_api_key"
  | "model_not_found"
  | "model_not_allowed"
  | "service_unavailable"
  | "provider_unavailable"
  | "rate_limited"
  | "internal_error";

export function requestId(req?: Request): string {
  return req?.headers.get("x-request-id") || "req_unknown";
}

export function apiError(
  req: Request | undefined,
  message: string,
  status: number,
  code: ApiErrorCode = "invalid_request",
  type = "invalid_request_error",
  param: string | null = null,
) {
  const id = requestId(req);
  logger[status >= 500 ? "error" : status >= 400 ? "warn" : "info"]("api.error", {
    request_id: id,
    method: req?.method,
    path: req ? new URL(req.url).pathname : undefined,
    status,
    code,
    error_type: type,
    message,
  });
  return NextResponse.json(
    { error: { message, type, code, param }, request_id: id },
    { status, headers: { "X-Request-ID": id, "Cache-Control": "no-store" } },
  );
}

export function anthropicApiError(req: Request, message: string, status: number, type: string) {
  const id = requestId(req);
  return NextResponse.json(
    { type: "error", error: { type, message }, request_id: id },
    { status, headers: { "X-Request-ID": id, "Cache-Control": "no-store" } },
  );
}
