import { listKanWorkspaces } from "@/lib/kan";
import { kanErrorResponse, kanJson, rejectKanRequest } from "@/lib/kan-route";

export const dynamic = "force-dynamic";

// GET /api/kan/workspaces
export async function GET(req: Request) {
  const rejected = rejectKanRequest(req, { json: false });
  if (rejected) return rejected;
  try {
    return kanJson({ workspaces: await listKanWorkspaces() });
  } catch (error) {
    return kanErrorResponse(error);
  }
}
