import { stat } from "fs/promises";
import { NextResponse } from "next/server";
import { findLivePaneForSessionPath, promptPane, readPaneScreen, sendPaneKeys, type HerdrLiveInfo } from "@/lib/herdr";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

async function livePane(id: string): Promise<HerdrLiveInfo | null> {
  const filePath = await resolveSessionPath(id);
  if (!filePath) return null;
  const pane = await findLivePaneForSessionPath(filePath);
  if (!pane) return null;
  const info = await stat(filePath).catch(() => null);
  return { ...pane, version: info ? `${info.size}:${info.mtimeMs}` : "" };
}

// GET /api/herdr/session/[id] - is this session live in a Herdr pane? (?screen=1 adds the pane's screen text)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const pane = await livePane(id);
    if (!pane) return NextResponse.json({ live: false });
    const screen = new URL(req.url).searchParams.has("screen") ? await readPaneScreen(pane.paneId) : undefined;
    return NextResponse.json({ live: true, pane, ...(screen !== undefined ? { screen } : {}) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

// POST /api/herdr/session/[id] - { type: "prompt", message } | { type: "keys", keys: string[] }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const { id } = await params;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || !("type" in body)) {
      return NextResponse.json({ error: "Missing type" }, { status: 400 });
    }
    const pane = await livePane(id);
    if (!pane) return NextResponse.json({ error: "Session is not live in Herdr", code: "not_live" }, { status: 409 });
    if (body.type === "prompt" && "message" in body && typeof body.message === "string" && body.message.trim()) {
      await promptPane(pane.paneId, body.message);
      return NextResponse.json({ success: true, paneId: pane.paneId });
    }
    if (body.type === "keys" && "keys" in body && Array.isArray(body.keys) && body.keys.every((k) => typeof k === "string")) {
      await sendPaneKeys(pane.paneId, body.keys);
      return NextResponse.json({ success: true, paneId: pane.paneId });
    }
    return NextResponse.json({ error: "Unsupported command" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
