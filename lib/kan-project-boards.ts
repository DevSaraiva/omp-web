import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@/lib/session-reader";

// Which Kan board belongs to which project (a repo's project root), so the board panel opens on
// the current session's board on every device. Kept beside omp's own state, outside any repo.
const REGISTRY_FILE = "omp-web-kan-boards.json";

export interface ProjectBoard {
  workspaceId: string;
  boardId: string;
}

function registryPath(): string {
  return join(getAgentDir(), REGISTRY_FILE);
}

function readAll(): Record<string, ProjectBoard> {
  try {
    const file = registryPath();
    if (!existsSync(file)) return {};
    const data = JSON.parse(readFileSync(file, "utf8")) as { projects?: unknown };
    const projects = data && typeof data.projects === "object" && data.projects ? data.projects as Record<string, unknown> : {};
    const out: Record<string, ProjectBoard> = {};
    for (const [project, value] of Object.entries(projects)) {
      const entry = value as Partial<ProjectBoard> | null;
      if (typeof entry?.workspaceId === "string" && typeof entry.boardId === "string") {
        out[project] = { workspaceId: entry.workspaceId, boardId: entry.boardId };
      }
    }
    return out;
  } catch {
    // A corrupt registry only costs the mapping; the board panel falls back to onboarding.
    return {};
  }
}

function writeAll(projects: Record<string, ProjectBoard>): void {
  const file = registryPath();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ projects }, null, 2));
  renameSync(tmp, file);
}

export function getProjectBoard(project: string): ProjectBoard | null {
  return readAll()[project] ?? null;
}

export function setProjectBoard(project: string, board: ProjectBoard | null): void {
  const projects = readAll();
  if (board) projects[project] = board;
  else delete projects[project];
  writeAll(projects);
}
