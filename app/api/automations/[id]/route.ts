import { NextResponse } from "next/server";
import { automationErrorResponse, deleteAutomation, rejectAutomationRequest, runAutomationAction, saveAutomation } from "@/lib/automations";
import { RUN_ACTIONS, isValidAutomationId, parseDefinitionBody } from "@/lib/automations-model";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// PUT /api/automations/[id] - definition JSON -> { automation }
export async function PUT(req: Request, { params }: Context) {
  const rejected = rejectAutomationRequest(req, { json: true });
  if (rejected) return rejected;
  try {
    const { id } = await params;
    if (!isValidAutomationId(id)) return NextResponse.json({ error: "Invalid automation id" }, { status: 400 });
    const parsed = parseDefinitionBody(await req.json().catch(() => null), id);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return NextResponse.json({ automation: await saveAutomation(parsed.definition) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

// POST /api/automations/[id] - { action: "run" | "pause" | "resume" | "cancel" } -> { automation }
export async function POST(req: Request, { params }: Context) {
  const rejected = rejectAutomationRequest(req, { json: true });
  if (rejected) return rejected;
  try {
    const { id } = await params;
    const body: unknown = await req.json().catch(() => null);
    const action = body && typeof body === "object" && "action" in body ? RUN_ACTIONS.find((a) => a === body.action) : undefined;
    if (!action) return NextResponse.json({ error: `action must be one of ${RUN_ACTIONS.join(", ")}` }, { status: 400 });
    return NextResponse.json({ automation: await runAutomationAction(id, action) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

// DELETE /api/automations/[id] -> { ok: true }
export async function DELETE(req: Request, { params }: Context) {
  const rejected = rejectAutomationRequest(req);
  if (rejected) return rejected;
  try {
    await deleteAutomation((await params).id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return automationErrorResponse(error);
  }
}
