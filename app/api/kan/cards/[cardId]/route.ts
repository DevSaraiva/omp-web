import { getKanCard, updateKanCard, type KanCardUpdate } from "@/lib/kan";
import { invalidKanId, isKanId, kanErrorResponse, kanJson, rejectKanRequest } from "@/lib/kan-route";

export const dynamic = "force-dynamic";

// GET /api/kan/cards/[cardId] - full detail with checklists, labels and comments
export async function GET(req: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const rejected = rejectKanRequest(req, { json: false });
  if (rejected) return rejected;
  const { cardId } = await params;
  if (!isKanId(cardId)) return invalidKanId();
  try {
    return kanJson({ card: await getKanCard(cardId) });
  } catch (error) {
    return kanErrorResponse(error);
  }
}

// PUT /api/kan/cards/[cardId] - { title?, description?, listPublicId? }; listPublicId moves the card
export async function PUT(req: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const rejected = rejectKanRequest(req, { json: true });
  if (rejected) return rejected;
  const { cardId } = await params;
  if (!isKanId(cardId)) return invalidKanId();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return kanJson({ error: "Invalid JSON body" }, 400);
  }

  // Whitelist the fields: this is not a passthrough to Kan's card update.
  const update: KanCardUpdate = {};
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title;
  if (typeof body.description === "string") update.description = body.description;
  if (typeof body.listPublicId === "string") {
    if (!isKanId(body.listPublicId)) return invalidKanId();
    update.listPublicId = body.listPublicId;
  }
  if (Object.keys(update).length === 0) return kanJson({ error: "Nothing to update" }, 400);

  try {
    await updateKanCard(cardId, update);
    return kanJson({ success: true });
  } catch (error) {
    return kanErrorResponse(error);
  }
}
