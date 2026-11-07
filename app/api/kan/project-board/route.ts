import { isAbsolute } from "path";
import { getProjectBoard, setProjectBoard } from "@/lib/kan-project-boards";
import { invalidKanId, isKanId, kanJson, rejectKanRequest } from "@/lib/kan-route";

export const dynamic = "force-dynamic";

function projectOf(value: unknown): string | null {
  return typeof value === "string" && value.length < 4096 && isAbsolute(value) ? value : null;
}

// GET /api/kan/project-board?project=<project root> - { board: { workspaceId, boardId } | null }
export async function GET(req: Request) {
  const rejected = rejectKanRequest(req, { json: false });
  if (rejected) return rejected;
  const project = projectOf(new URL(req.url).searchParams.get("project"));
  if (!project) return kanJson({ error: "project must be an absolute path" }, 400);
  return kanJson({ board: getProjectBoard(project) });
}

// PUT /api/kan/project-board - { project, workspaceId, boardId }; boardId null forgets the project's board
export async function PUT(req: Request) {
  const rejected = rejectKanRequest(req, { json: true });
  if (rejected) return rejected;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return kanJson({ error: "Invalid JSON body" }, 400);
  }
  const project = projectOf(body.project);
  if (!project) return kanJson({ error: "project must be an absolute path" }, 400);
  if (body.boardId === null) {
    setProjectBoard(project, null);
    return kanJson({ board: null });
  }
  if (typeof body.workspaceId !== "string" || !isKanId(body.workspaceId)
    || typeof body.boardId !== "string" || !isKanId(body.boardId)) return invalidKanId();
  const board = { workspaceId: body.workspaceId, boardId: body.boardId };
  setProjectBoard(project, board);
  return kanJson({ board });
}
