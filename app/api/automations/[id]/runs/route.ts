import { NextResponse } from "next/server";
import { automationErrorResponse, listRuns, rejectAutomationRequest } from "@/lib/automations";

export const dynamic = "force-dynamic";

// GET /api/automations/[id]/runs?limit=N -> { runs } newest first
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = rejectAutomationRequest(req);
  if (rejected) return rejected;
  try {
    const requested = Number(new URL(req.url).searchParams.get("limit"));
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 200) : 30;
    return NextResponse.json({ runs: await listRuns((await params).id, limit) });
  } catch (error) {
    return automationErrorResponse(error);
  }
}
