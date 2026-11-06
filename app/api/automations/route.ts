import { NextResponse } from "next/server";
import { automationErrorResponse, listAutomations, rejectAutomationRequest, saveAutomation } from "@/lib/automations";
import { parseDefinitionBody } from "@/lib/automations-model";

export const dynamic = "force-dynamic";

// GET /api/automations -> { automations }
export async function GET(req: Request) {
  const rejected = rejectAutomationRequest(req);
  if (rejected) return rejected;
  try {
    return NextResponse.json({ automations: await listAutomations() });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

// POST /api/automations - definition JSON (id optional, derived from name) -> { automation }
export async function POST(req: Request) {
  const rejected = rejectAutomationRequest(req, { json: true });
  if (rejected) return rejected;
  try {
    const parsed = parseDefinitionBody(await req.json().catch(() => null));
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const existing = (await listAutomations()).some((automation) => automation.id === parsed.definition.id);
    if (existing) {
      return NextResponse.json({ error: `An automation with id "${parsed.definition.id}" already exists` }, { status: 409 });
    }
    return NextResponse.json({ automation: await saveAutomation(parsed.definition) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}
