import { listKanBoards } from "@/lib/kan";
import { invalidKanId, isKanId, kanErrorResponse, kanJson, rejectKanRequest } from "@/lib/kan-route";

export const dynamic = "force-dynamic";

// GET /api/kan/workspaces/[workspaceId]/boards
export async function GET(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const rejected = rejectKanRequest(req, { json: false });
  if (rejected) return rejected;
  const { workspaceId } = await params;
  if (!isKanId(workspaceId)) return invalidKanId();
  try {
    return kanJson({ boards: await listKanBoards(workspaceId) });
  } catch (error) {
    return kanErrorResponse(error);
  }
}
