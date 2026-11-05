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

/**
 * Default Herdr workspace for a project: the first one whose label contains the
 * repo folder name, case-insensitively. Returns undefined when nothing matches,
 * which means the agent gets a new workspace.
 */
export function pickDefaultHerdrWorkspace(
  machines: readonly HerdrMachineView[],
  repoPath: string,
): string | undefined {
  const folder = lastPathSegment(repoPath).toLowerCase();
  if (!folder) return undefined;
  for (const machine of machines) {
    const match = machine.workspaces.find((workspace) => workspace.label.toLowerCase().includes(folder));
    if (match) return match.id;
  }
  return undefined;
}
