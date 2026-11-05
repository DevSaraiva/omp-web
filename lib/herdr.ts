import { execFile } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { promisify } from "util";
import { sessionPathKey } from "./session-path";
import { buildHerdrMachine, parseHerdrMachineList, type HerdrMachine, type LivePane, type SavedHerdrMachine } from "./herdr-tree";

export type { HerdrLiveInfo, HerdrMachine, HerdrPane, HerdrTab, HerdrWorkspace, HerdrStatus, LivePane } from "./herdr-tree";

/**
 * Herdr (https://herdr.dev) owns the user's terminal workspaces, tabs and the omp
 * agents running in its panes. omp-web mirrors that layout and, for a session that
 * is live in a Herdr pane, routes input through Herdr instead of starting a second
 * AgentSession on the same transcript file.
 */

const execFileAsync = promisify(execFile);
const HERDR_BIN = process.env.OMP_WEB_HERDR_BIN || "herdr";
const AGENT_BIN = process.env.OMP_WEB_AGENT_BIN || join(homedir(), ".local", "bin", "agent");
const TREE_TTL_MS = 1500;

export class HerdrLiveSessionError extends Error {
  readonly code = "herdr_live";
  constructor(readonly paneId: string) {
    super(`This session is running in Herdr pane ${paneId}; omp-web sends input through Herdr instead of starting a second agent on it.`);
    this.name = "HerdrLiveSessionError";
  }
}

async function herdr(args: string[], machine?: string, timeout = 6000): Promise<Record<string, unknown>> {
  const argv = machine ? ["--machine", machine, ...args] : args;
  const { stdout } = await execFileAsync(HERDR_BIN, argv, { timeout, maxBuffer: 8 * 1024 * 1024 });
  const parsed: unknown = JSON.parse(stdout);
  if (parsed && typeof parsed === "object" && "result" in parsed && parsed.result && typeof parsed.result === "object") {
    return { ...parsed.result };
  }
  return {};
}

async function loadMachine(id: string, label: string, local: boolean): Promise<HerdrMachine> {
  const machine = local ? undefined : id;
  try {
    const [ws, tabs, panes] = await Promise.all([
      herdr(["workspace", "list"], machine),
      herdr(["tab", "list"], machine),
      herdr(["pane", "list"], machine),
    ]);
    return buildHerdrMachine({ id, label, local }, ws, tabs, panes);
  } catch {
    return { id, label, local, reachable: false, workspaces: [] };
  }
}

interface TreeCache { at: number; promise: Promise<HerdrMachine[]> }
interface RemoteCache { at: number; machine: HerdrMachine; refreshing?: Promise<void> }
const g = globalThis as typeof globalThis & {
  __ompHerdrTree?: TreeCache;
  __ompHerdrRemote?: Map<string, RemoteCache>;
};
const REMOTE_TTL_MS = 15000;

/**
 * A remote machine costs an SSH round trip per call, so it is served from cache and
 * refreshed in the background; only the first request for it waits.
 */
function remoteMachine(id: string, label: string): Promise<HerdrMachine> {
  const cache = (g.__ompHerdrRemote ??= new Map());
  const entry = cache.get(id);
  const refresh = () => loadMachine(id, label, false).then((machine) => {
    cache.set(id, { at: Date.now(), machine });
  });
  if (!entry) return refresh().then(() => cache.get(id)!.machine);
  if (Date.now() - entry.at > REMOTE_TTL_MS && !entry.refreshing) {
    entry.refreshing = refresh().finally(() => { entry.refreshing = undefined; });
  }
  return Promise.resolve(entry.machine);
}

/** Every Herdr machine this server can see: this one first, then saved SSH machines. */
export function getHerdrTree(options: { force?: boolean } = {}): Promise<HerdrMachine[]> {
  const cached = g.__ompHerdrTree;
  if (!options.force && cached && Date.now() - cached.at < TREE_TTL_MS) return cached.promise;
  const promise = (async () => {
    let saved: SavedHerdrMachine[] = [];
    try {
      const { stdout } = await execFileAsync(HERDR_BIN, ["machine", "list"], { timeout: 6000 });
      saved = parseHerdrMachineList(stdout);
    } catch {
      // Herdr not running or no saved machines: the local machine is still listed.
    }
    const local = loadMachine("local", process.env.OMP_WEB_MACHINE_LABEL || "This Mac", true);
    const remote = saved.filter((m) => m.enabled).map((m) => remoteMachine(m.id, m.label));
    return Promise.all([local, ...remote]);
  })();
  g.__ompHerdrTree = { at: Date.now(), promise };
  promise.catch(() => { if (g.__ompHerdrTree?.promise === promise) g.__ompHerdrTree = undefined; });
  return promise;
}

/** The local Herdr pane whose omp agent is writing this transcript file, if any. */
export async function findLivePaneForSessionPath(filePath: string): Promise<LivePane | null> {
  if (!filePath) return null;
  const key = sessionPathKey(filePath);
  const machines = await getHerdrTree();
  const local = machines.find((m) => m.local);
  for (const ws of local?.workspaces ?? []) {
    for (const tab of ws.tabs) {
      for (const pane of tab.panes) {
        if (pane.agent && pane.sessionPath && sessionPathKey(pane.sessionPath) === key) {
          return { ...pane, workspaceId: ws.id, workspaceLabel: ws.label, tabLabel: tab.label };
        }
      }
    }
  }
  return null;
}

/** Throws when a second in-process agent on this file would race the Herdr pane's agent. */
export async function assertNotLiveInHerdr(filePath: string): Promise<void> {
  const pane = await findLivePaneForSessionPath(filePath);
  if (pane) throw new HerdrLiveSessionError(pane.paneId);
}

export async function promptPane(paneId: string, text: string): Promise<void> {
  await herdr(["agent", "prompt", paneId, text], undefined, 15000);
  g.__ompHerdrTree = undefined;
}

const ALLOWED_KEYS: Record<string, true> = {
  esc: true, enter: true, up: true, down: true, left: true, right: true, tab: true,
  "ctrl+c": true, y: true, n: true, "1": true, "2": true, "3": true,
};

export async function sendPaneKeys(paneId: string, keys: string[]): Promise<void> {
  const bad = keys.filter((k) => !ALLOWED_KEYS[k]);
  if (bad.length) throw new Error(`Keys not allowed: ${bad.join(", ")}`);
  await herdr(["agent", "send-keys", paneId, ...keys]);
  g.__ompHerdrTree = undefined;
}

/** Plain text of what the pane's terminal currently shows (approvals, pickers, errors). */
export async function readPaneScreen(paneId: string, lines = 60): Promise<string> {
  const { stdout } = await execFileAsync(HERDR_BIN, ["pane", "read", paneId, "--lines", String(lines)], { timeout: 6000, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

export const PLAYBOOKS = ["software", "planning", "sports", "ads"] as const;
export type Playbook = (typeof PLAYBOOKS)[number];

export interface StartAgentInput {
  playbook: Playbook;
  repo?: string;
  task: string;
  card?: string;
  workspaceId?: string;
  model?: string;
}

export interface StartedAgent {
  name: string;
  paneId: string;
  workspaceId: string | null;
  tabId: string | null;
  worktree: string | null;
  branch: string | null;
}

/** Starts an agent with the Agentic Framework CLI (`agent new`), in a new Herdr tab or workspace. */
export async function startAgent(input: StartAgentInput): Promise<StartedAgent> {
  const args = ["new", input.playbook, input.task, "--json"];
  if (input.repo) args.push("--repo", input.repo);
  else args.push("--no-worktree");
  if (input.card) args.push("--card", input.card);
  if (input.workspaceId) args.push("--workspace", input.workspaceId);
  if (input.model) args.push("--model", input.model);
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(AGENT_BIN, args, { timeout: 180000, maxBuffer: 1024 * 1024 }));
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)));
  }
  const line = stdout.trim().split("\n").pop() ?? "{}";
  const parsed: unknown = JSON.parse(line);
  if (!parsed || typeof parsed !== "object") throw new Error(`agent new returned no agent: ${line}`);
  const started: Record<string, unknown> = { ...parsed };
  const field = (key: string): string | null => (typeof started[key] === "string" ? String(started[key]) : null);
  const name = field("name");
  const paneId = field("pane");
  if (!name || !paneId) throw new Error(`agent new returned no agent: ${line}`);
  g.__ompHerdrTree = undefined;
  return { name, paneId, workspaceId: field("workspace"), tabId: field("tab"), worktree: field("worktree"), branch: field("branch") };
}
