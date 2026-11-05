import { NextResponse } from "next/server";
import { KanApiError, KanNotConfiguredError } from "./kan";
import { hasJsonContentType, isApiRequestAllowed } from "./request-security";

const NO_STORE = { "Cache-Control": "no-store" };

/** Kan public ids are short url-safe strings; anything else never reaches the upstream path. */
const KAN_ID = /^[A-Za-z0-9_-]{6,40}$/;

export function isKanId(value: string): boolean {
  return KAN_ID.test(value);
}

export function kanJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Same gate the agent routes use; returns a response to send when the request is refused. */
export function rejectKanRequest(req: Request, options: { json: boolean }): NextResponse | null {
  if (!isApiRequestAllowed(req)) return kanJson({ error: "Untrusted API request" }, 403);
  if (options.json && !hasJsonContentType(req)) {
    return kanJson({ error: "Content-Type must be application/json" }, 415);
  }
  return null;
}

export function kanErrorResponse(error: unknown): NextResponse {
  if (error instanceof KanNotConfiguredError) return kanJson({ error: error.message, code: "kan_not_configured" }, 503);
  if (error instanceof KanApiError) {
    // Pass through the upstream class of failure, but never a 401 of ours: that would read as an omp-web login prompt.
    const status = error.status === 401 || error.status === 403 ? 502 : error.status;
    return kanJson({ error: error.message }, status >= 400 && status < 600 ? status : 502);
  }
  return kanJson({ error: error instanceof Error ? error.message : String(error) }, 500);
}

export function invalidKanId(): NextResponse {
  return kanJson({ error: "Invalid id" }, 400);
}
