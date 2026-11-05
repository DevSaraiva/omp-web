import { getKanBoard } from "@/lib/kan";
import { invalidKanId, isKanId, kanErrorResponse, kanJson, rejectKanRequest } from "@/lib/kan-route";

export const dynamic = "force-dynamic";

// GET /api/kan/boards/[boardId] - lists with their cards
export async function GET(req: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const rejected = rejectKanRequest(req, { json: false });
  if (rejected) return rejected;
  const { boardId } = await params;
  if (!isKanId(boardId)) return invalidKanId();
  try {
    return kanJson({ board: await getKanBoard(boardId) });
  } catch (error) {
    return kanErrorResponse(error);
  }
}
