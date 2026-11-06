import type { SessionInfo } from "./types";

/**
 * Pure shaping of Herdr's socket-API JSON into the tree omp-web shows. Kept free of
 * process and filesystem access so it can be tested and imported by client code.
 */

export type HerdrStatus = "working" | "blocked" | "done" | "idle" | "unknown";

export interface HerdrPane {
  paneId: string;
  status: HerdrStatus;
  /** Agent kind Herdr detected in the pane (omp, claude, codex, ...), or null for a shell. */
  agent: string | null;
  title: string;
  /** Label given with `herdr pane rename`, e.g. "sub: <task>", or null. */
  label: string | null;
  /** Herdr's terminal id: unlike paneId it survives moving the pane to another tab. */
  terminalId: string;
  /** Pane of the agent that started this one (a subagent), when the Agentic Framework recorded it. */
  parentPaneId?: string;
  cwd: string;
  /** Transcript file the pane's agent writes, when Herdr's integration reports it. */
  sessionPath: string | null;
  /** omp-web session for sessionPath (local machine only), filled in by the API route. */
  sessionId?: string;
  session?: SessionInfo;
  focused: boolean;
}

/** A local pane whose agent writes a given omp session, with where it sits in Herdr. */
export interface LivePane extends HerdrPane {
  workspaceId: string;
  workspaceLabel: string;
  tabLabel: string;
}

/** GET /api/herdr/session/[id] when the session is live in Herdr. */
export interface HerdrLiveInfo extends LivePane {
  /** Changes whenever the transcript file changes (size and mtime). */
  version: string;
}

export interface HerdrTab {
  id: string;
  label: string;
  number: number;
  status: HerdrStatus;
  panes: HerdrPane[];
}

export interface HerdrWorkspace {
  id: string;
  label: string;
  number: number;
  status: HerdrStatus;
  tabs: HerdrTab[];
}

export interface HerdrMachine {
  /** "local" for this server's own Herdr, else the saved machine id for `herdr --machine`. */
  id: string;
  label: string;
  local: boolean;
  reachable: boolean;
  workspaces: HerdrWorkspace[];
}

export interface SavedHerdrMachine {
  id: string;
  label: string;
  target: string;
  enabled: boolean;
}

const STATUSES: Record<string, HerdrStatus> = {
  working: "working", blocked: "blocked", done: "done", idle: "idle", unknown: "unknown",
};

function status(value: unknown): HerdrStatus {
  return typeof value === "string" && value in STATUSES ? STATUSES[value] : "unknown";
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function records(container: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const list = container[key];
  return Array.isArray(list) ? list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}

function sessionPathOf(raw: Record<string, unknown>): string | null {
  const session = raw.agent_session;
  if (!session || typeof session !== "object") return null;
  if (!("kind" in session) || !("value" in session)) return null;
  return session.kind === "path" && typeof session.value === "string" ? session.value : null;
}

/** `herdr machine list` prints tab-separated rows: id, label, ssh target, session, enabled|disabled. */
export function parseHerdrMachineList(text: string): SavedHerdrMachine[] {
  return text.split("\n").map((line) => line.split("\t")).filter((cols) => cols.length >= 3 && cols[0]).map((cols) => ({
    id: cols[0],
    label: cols[1] || cols[0],
    target: cols[2],
    enabled: cols[4] ? cols[4].trim() !== "disabled" : true,
  }));
}

/** Results of `workspace list`, `tab list` and `pane list`, in Herdr's own order (by number). */
export function buildHerdrMachine(
  machine: { id: string; label: string; local: boolean },
  workspaceResult: Record<string, unknown>,
  tabResult: Record<string, unknown>,
  paneResult: Record<string, unknown>,
): HerdrMachine {
  const panesByTab: Record<string, HerdrPane[]> = {};
  for (const raw of records(paneResult, "panes")) {
    const tabId = str(raw.tab_id);
    (panesByTab[tabId] ??= []).push({
      paneId: str(raw.pane_id),
      status: status(raw.agent_status),
      agent: typeof raw.agent === "string" ? raw.agent : null,
      title: str(raw.terminal_title_stripped, str(raw.terminal_title)),
      label: typeof raw.label === "string" && raw.label ? raw.label : null,
      terminalId: str(raw.terminal_id),
      cwd: str(raw.foreground_cwd, str(raw.cwd)),
      sessionPath: sessionPathOf(raw),
      focused: raw.focused === true,
    });
  }
  const tabsByWorkspace: Record<string, HerdrTab[]> = {};
  for (const raw of records(tabResult, "tabs")) {
    const id = str(raw.tab_id);
    (tabsByWorkspace[str(raw.workspace_id)] ??= []).push({
      id,
      label: str(raw.label, id),
      number: num(raw.number),
      status: status(raw.agent_status),
      panes: panesByTab[id] ?? [],
    });
  }
  const workspaces = records(workspaceResult, "workspaces").map((raw) => {
    const id = str(raw.workspace_id);
    return {
      id,
      label: str(raw.label, id),
      number: num(raw.number),
      status: status(raw.agent_status),
      tabs: (tabsByWorkspace[id] ?? []).sort((a, b) => a.number - b.number),
    };
  }).sort((a, b) => a.number - b.number);
  return { ...machine, reachable: true, workspaces };
}

/**
 * Marks subagent panes with the pane of the agent that started them. `parentByTerminal` maps a
 * child's terminal id to its parent's (from the Agentic Framework's agent registry). Links to a
 * parent that is no longer open are dropped, so an orphan shows as a top-level agent.
 */
export function linkHerdrParents(machine: HerdrMachine, parentByTerminal: ReadonlyMap<string, string>): void {
  const panes = machine.workspaces.flatMap((w) => w.tabs).flatMap((t) => t.panes);
  const paneByTerminal = new Map(panes.map((p) => [p.terminalId, p.paneId]));
  for (const pane of panes) {
    const parentTerminal = parentByTerminal.get(pane.terminalId);
    const parentPaneId = parentTerminal ? paneByTerminal.get(parentTerminal) : undefined;
    if (parentPaneId && parentPaneId !== pane.paneId) pane.parentPaneId = parentPaneId;
  }
}

/** A tab's agents as a forest: roots (agents nobody in this tab started) with their subagents. */
export interface HerdrAgentNode {
  pane: HerdrPane;
  children: HerdrAgentNode[];
}

export function herdrAgentForest(tab: HerdrTab): HerdrAgentNode[] {
  const agents = tab.panes.filter((p) => p.agent);
  const inTab = new Set(agents.map((p) => p.paneId));
  const childrenOf = new Map<string, HerdrPane[]>();
  for (const pane of agents) {
    if (pane.parentPaneId && inTab.has(pane.parentPaneId)) {
      const list = childrenOf.get(pane.parentPaneId) ?? [];
      list.push(pane);
      childrenOf.set(pane.parentPaneId, list);
    }
  }
  const build = (pane: HerdrPane, seen: Set<string>): HerdrAgentNode => ({
    pane,
    children: (childrenOf.get(pane.paneId) ?? [])
      .filter((c) => !seen.has(c.paneId))
      .map((c) => build(c, new Set([...seen, c.paneId]))),
  });
  return agents
    .filter((p) => !p.parentPaneId || !inTab.has(p.parentPaneId))
    .map((p) => build(p, new Set([p.paneId])));
}
