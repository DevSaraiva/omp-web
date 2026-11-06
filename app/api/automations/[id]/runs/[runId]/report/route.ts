import { NextResponse } from "next/server";
import { automationErrorResponse, readRunReport, rejectAutomationRequest } from "@/lib/automations";

export const dynamic = "force-dynamic";

// GET /api/automations/[id]/runs/[runId]/report -> { markdown, truncated }
export async function GET(req: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const rejected = rejectAutomationRequest(req);
  if (rejected) return rejected;
  try {
    const { id, runId } = await params;
    return NextResponse.json(await readRunReport(id, runId));
  } catch (error) {
    return automationErrorResponse(error);
  }
}
