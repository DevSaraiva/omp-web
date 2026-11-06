/**
 * Client-safe Kan types and pure helpers. Nothing here touches the server
 * config or the API token, so the browser bundle can import it.
 */

export interface KanLabel {
  publicId: string;
  name: string;
  colourCode: string;
}

export interface KanWorkspace {
  publicId: string;
  name: string;
}

export interface KanBoardSummary {
  publicId: string;
  name: string;
}

export interface KanBoardCard {
  publicId: string;
  title: string;
  cardNumber: number | null;
  labels: KanLabel[];
  checklistDone: number;
  checklistTotal: number;
}

export interface KanBoardList {
  publicId: string;
  name: string;
  cards: KanBoardCard[];
}

export interface KanBoard {
  publicId: string;
  name: string;
  lists: KanBoardList[];
}

export interface KanChecklistItem {
  publicId: string;
  title: string;
  completed: boolean;
}

export interface KanChecklist {
  publicId: string;
  name: string;
  items: KanChecklistItem[];
}

export interface KanComment {
  publicId: string;
  comment: string;
  author: string | null;
  createdAt: string;
}

export interface KanCardDetail {
  publicId: string;
  title: string;
  description: string;
  cardNumber: number | null;
  labels: KanLabel[];
  checklists: KanChecklist[];
  comments: KanComment[];
  list: { publicId: string; name: string };
  /** Every list of the card's board, in board order, for the "Move to" selector. */
  lists: { publicId: string; name: string }[];
}

/** The part of `GET /api/herdr` the board needs to pick a workspace. */
export interface HerdrMachineView {
  id: string;
  label: string;
  reachable?: boolean;
  local?: boolean;
  workspaces: { id: string; label: string }[];
}

export const KAN_AGENT_PLAYBOOKS = ["software", "planning", "sports", "ads"] as const;
export type KanAgentPlaybook = (typeof KAN_AGENT_PLAYBOOKS)[number];

export interface KanTaskSource {
  title: string;
  description?: string | null;
  checklists?: readonly {
    name: string;
    items: readonly { title: string; completed: boolean }[];
  }[];
}

/**
 * Prefill for the Start agent dialog: the card title, its description and every
 * unchecked checklist item. Completed items are dropped because they are not
 * work left to do. A checklist with nothing left open is omitted entirely.
 */
export function buildKanTaskText(source: KanTaskSource): string {
  const parts: string[] = [source.title.trim()];
  const description = source.description?.trim();
  if (description) parts.push(description);

  const open: string[] = [];
  for (const checklist of source.checklists ?? []) {
    const items = checklist.items.filter((item) => !item.completed && item.title.trim());
    if (items.length === 0) continue;
    open.push(`${checklist.name.trim() || "Checklist"}:`);
    for (const item of items) open.push(`- [ ] ${item.title.trim()}`);
  }
  if (open.length > 0) parts.push(["Open checklist items", ...open].join("\n"));

  return parts.join("\n\n");
}

function lastPathSegment(repoPath: string): string {
  const segments = repoPath.trim().split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

/** Words in a Herdr workspace label that mark it as the home of a playbook's work. */
const PLAYBOOK_WORKSPACE_WORDS: Record<KanAgentPlaybook, readonly string[]> = {
  software: ["software", "dev", "code"],
  planning: ["plan"],
  sports: ["sport", "training"],
  ads: ["marketing", "ads"],
};

/**
 * Default Herdr workspace for a project on this machine: among local workspaces whose
 * label contains the repo folder name (case-insensitive), the one whose label also names
 * the playbook's kind of work, else the first. Undefined means the agent gets a new
 * workspace. Remote machines are skipped: agents start on the machine serving omp-web.
 */
export function pickDefaultHerdrWorkspace(
  machines: readonly HerdrMachineView[],
  repoPath: string,
  playbook: KanAgentPlaybook = "software",
): string | undefined {
  const folder = lastPathSegment(repoPath).toLowerCase();
  if (!folder) return undefined;
  const candidates = machines.filter((m) => m.local !== false)
    .flatMap((m) => m.workspaces)
    .filter((w) => w.label.toLowerCase().includes(folder));
  const words = PLAYBOOK_WORKSPACE_WORDS[playbook];
  const preferred = candidates.find((w) => words.some((word) => w.label.toLowerCase().includes(word)));
  return (preferred ?? candidates[0])?.id;
}
