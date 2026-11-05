import { NextResponse } from "next/server";
import { PLAYBOOKS, startAgent, type Playbook } from "@/lib/herdr";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// POST /api/herdr/agents - { playbook, repo?, task, card?, workspaceId?, model? } -> started agent
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const raw: unknown = await req.json();
    if (!raw || typeof raw !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const body: Record<string, unknown> = { ...raw };
    const playbook = PLAYBOOKS.find((p) => p === body.playbook);
    const task = optionalString(body, "task");
    if (!playbook) return NextResponse.json({ error: `playbook must be one of ${PLAYBOOKS.join(", ")}` }, { status: 400 });
    if (!task) return NextResponse.json({ error: "task is required" }, { status: 400 });
    const started = await startAgent({
      playbook: playbook satisfies Playbook,
      task,
      repo: optionalString(body, "repo"),
      card: optionalString(body, "card"),
      workspaceId: optionalString(body, "workspaceId"),
      model: optionalString(body, "model"),
    });
    return NextResponse.json(started);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
