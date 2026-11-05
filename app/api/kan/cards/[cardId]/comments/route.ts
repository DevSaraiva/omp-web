import { addKanCardComment } from "@/lib/kan";
import { invalidKanId, isKanId, kanErrorResponse, kanJson, rejectKanRequest } from "@/lib/kan-route";

export const dynamic = "force-dynamic";

const MAX_COMMENT_LENGTH = 10_000;

// POST /api/kan/cards/[cardId]/comments - { comment }
export async function POST(req: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const rejected = rejectKanRequest(req, { json: true });
  if (rejected) return rejected;
  const { cardId } = await params;
  if (!isKanId(cardId)) return invalidKanId();

  let comment: unknown;
  try {
    comment = ((await req.json()) as { comment?: unknown }).comment;
  } catch {
    return kanJson({ error: "Invalid JSON body" }, 400);
  }
  if (typeof comment !== "string" || !comment.trim() || comment.length > MAX_COMMENT_LENGTH) {
    return kanJson({ error: "comment must be a non-empty string" }, 400);
  }

  try {
    await addKanCardComment(cardId, comment);
    return kanJson({ success: true });
  } catch (error) {
    return kanErrorResponse(error);
  }
}
