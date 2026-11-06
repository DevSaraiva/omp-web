import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { hasJsonContentType, isApiRequestAllowed } from "./request-security";
import { isValidAutomationId, type Automation, type AutomationDefinition, type AutomationRun, type RunAction } from "./automations-model";

/**
 * Scheduled agent workflows are owned by the Agentic Framework CLI (`agent auto ...`).
 * This is a thin, argv-only wrapper around it: every call is `execFile` (no shell), JSON on
 * stdout, and a non-zero exit surfaces its stderr as the error message.
 */

const AGENT_BIN = process.env.OMP_WEB_AGENT_BIN || join(homedir(), ".local", "bin", "agent");
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const RUN_TIMEOUT_MS = 90_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export class AutomationNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationNotFoundError";
  }
}

function runCli(args: string[], options: { stdin?: string; timeout?: number } = {}): Promise<unknown> {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const child = execFile(
    AGENT_BIN,
    ["auto", ...args, "--json"],
    { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`agent auto ${args[0]} returned invalid JSON: ${stdout.trim().slice(0, 200)}`));
      }
    },
  );
  if (options.stdin !== undefined) child.stdin?.end(options.stdin);
  return promise;
}

function assertId(id: string): void {
  // Also rules out a leading dash, which the CLI would read as an option.
  if (!isValidAutomationId(id)) throw new Error("Invalid automation id");
}

function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" && key in payload ? Reflect.get(payload, key) : undefined;
}

function expectList<T>(payload: unknown, key: string): T[] {
  const value = field(payload, key);
  if (!Array.isArray(value)) throw new Error(`agent auto returned no "${key}" list`);
  return value as T[];
}

function expectAutomation(payload: unknown): Automation {
  const value = field(payload, "automation");
  if (!value || typeof value !== "object") throw new Error('agent auto returned no "automation"');
  return value as Automation;
}

export async function listAutomations(): Promise<Automation[]> {
  return expectList<Automation>(await runCli(["list"]), "automations");
}

export async function listRuns(id: string, limit = 30): Promise<AutomationRun[]> {
  assertId(id);
  return expectList<AutomationRun>(await runCli(["runs", id, "--limit", String(limit)]), "runs");
}

export async function runAutomationAction(id: string, action: RunAction): Promise<Automation> {
  assertId(id);
  return expectAutomation(await runCli([action, id], { timeout: action === "run" ? RUN_TIMEOUT_MS : DEFAULT_TIMEOUT_MS }));
}

/**
 * Creates or updates; the CLI treats an existing id as an update and applies `paused` (run
 * state) before publishing, so a new automation saved paused is never briefly due. The save
 * also commits and pushes the definition, hence the longer timeout.
 */
export async function saveAutomation(definition: AutomationDefinition): Promise<Automation> {
  assertId(definition.id);
  return expectAutomation(await runCli(["save"], { stdin: JSON.stringify(definition), timeout: RUN_TIMEOUT_MS }));
}

export async function deleteAutomation(id: string): Promise<void> {
  assertId(id);
  await runCli(["delete", id], { timeout: RUN_TIMEOUT_MS });
}

/**
 * Report markdown of one run. The file read is the `report` path the CLI listed for that
 * run, never a path taken from the request.
 */
export async function readRunReport(id: string, runId: string): Promise<{ markdown: string; truncated: boolean }> {
  const runs = await listRuns(id, 200);
  const run = runs.find((candidate) => candidate.run_id === runId);
  if (!run) throw new AutomationNotFoundError("Run not found");
  if (!run.report) throw new AutomationNotFoundError("This run has no report");
  let buffer: Buffer;
  try {
    buffer = await readFile(run.report);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new AutomationNotFoundError("The report file does not exist on this machine");
    }
    throw error;
  }
  const truncated = buffer.length > MAX_REPORT_BYTES;
  return { markdown: buffer.subarray(0, MAX_REPORT_BYTES).toString("utf8"), truncated };
}

/** Rejects untrusted or non-JSON requests; null means the request may proceed. */
export function rejectAutomationRequest(req: Request, options: { json?: boolean } = {}): Response | null {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  if (options.json && !hasJsonContentType(req)) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

export function automationErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof AutomationNotFoundError ? 404 : message === "Invalid automation id" ? 400 : 500;
  return Response.json({ error: message }, { status });
}
