/**
 * Shapes and pure helpers for scheduled agent workflows, shared by the server wrapper
 * (`lib/automations.ts`), the API routes and `AutomationsView`. Kept free of Node imports
 * so the client bundle can use it.
 */

export type RunStatus = "running" | "complete" | "blocked" | "failed" | "cancelled";
export type RunAction = "run" | "pause" | "resume" | "cancel";

export const RUN_ACTIONS: readonly RunAction[] = ["run", "pause", "resume", "cancel"];
export const PROMPT_PLACEHOLDERS = [
  "{run_id}", "{slot}", "{started_at}", "{previous}", "{report}", "{snapshot}", "{receipt}", "{repo}", "{date}",
] as const;

export type AutomationSchedule =
  | { daily: string; timezone: string }
  | { every_minutes: number };

export interface AutomationRun {
  run_id: string | null;
  slot: string;
  status: RunStatus;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  agent: string | null;
  tab_id: string | null;
  pane_id: string | null;
  report: string | null;
  report_exists: boolean;
  session_path: string | null;
  error: string | null;
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  paused: boolean;
  host: string;
  runs_here: boolean;
  schedule: AutomationSchedule;
  schedule_text: string;
  next_run: string | null;
  repo: string;
  workspace_label: string;
  tab_label: string;
  model: string;
  max_attempts: number;
  retry_delay_minutes: number;
  prompt: string;
  active: AutomationRun | null;
  last_run: AutomationRun | null;
  last_success: AutomationRun | null;
  last_error: string | null;
}

/** What `agent auto save` reads from stdin. */
export interface AutomationDefinition {
  id: string;
  name: string;
  enabled: boolean;
  paused: boolean;
  host: string;
  schedule: AutomationSchedule;
  repo: string;
  workspace_label: string;
  tab_label?: string;
  model?: string;
  max_attempts: number;
  retry_delay_minutes: number;
  prompt: string;
}

// The CLI rejects ids with doubled or edge dashes, and schedules tighter than its 5 minute tick.
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ATTEMPTS_LIMIT = 10;
const MIN_EVERY_MINUTES = 5;
const MAX_MINUTES = 7 * 24 * 60;

export function isValidAutomationId(id: string): boolean {
  return id.length <= 64 && ID_PATTERN.test(id);
}

/** Lowercase-dashes id from a display name; "" when nothing usable remains. */
export function slugifyAutomationId(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export function scheduleText(schedule: AutomationSchedule): string {
  if ("daily" in schedule) return `daily ${schedule.daily} ${schedule.timezone}`.trim();
  const n = schedule.every_minutes;
  if (n % 1440 === 0) return n === 1440 ? "every day" : `every ${n / 1440} days`;
  if (n % 60 === 0) return n === 60 ? "every hour" : `every ${n / 60} hours`;
  return n === 1 ? "every minute" : `every ${n} minutes`;
}

/** Status shown on the list row: the active run wins, then the last finished one. */
export function displayStatus(automation: Pick<Automation, "active" | "last_run">): RunStatus | null {
  return automation.active?.status ?? automation.last_run?.status ?? null;
}

/** CSS variable carrying the colour for a status. */
export function statusColor(status: RunStatus | null): string {
  switch (status) {
    case "running": return "var(--accent)";
    case "complete": return "var(--success)";
    case "blocked": return "var(--warning)";
    case "failed": return "var(--danger)";
    default: return "var(--text-dim)";
  }
}

/** Lower rank sorts first: things that need attention or are in flight lead the list. */
function attentionRank(status: RunStatus | null): number {
  switch (status) {
    case "running": return 0;
    case "failed": return 1;
    case "blocked": return 2;
    default: return 3;
  }
}

export function sortAutomations(automations: readonly Automation[]): Automation[] {
  return [...automations].sort((a, b) => {
    const rank = attentionRank(displayStatus(a)) - attentionRank(displayStatus(b));
    if (rank) return rank;
    const aNext = a.paused || !a.next_run ? Infinity : Date.parse(a.next_run);
    const bNext = b.paused || !b.next_run ? Infinity : Date.parse(b.next_run);
    if (aNext !== bNext) return aNext < bNext ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** "4m 05s", "1h 02m", "12s"; open runs measure against `now`. */
export function formatDuration(startedAt: string | null, finishedAt: string | null, now: number): string {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (Number.isNaN(start)) return "";
  const end = finishedAt ? Date.parse(finishedAt) : now;
  if (Number.isNaN(end)) return "";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

// ---- form draft -------------------------------------------------------------------------

export type ScheduleKind = "daily" | "every";

/** Everything is a string while the user types; `validateDraft` / `draftToDefinition` convert. */
export interface AutomationDraft {
  id: string;
  isNew: boolean;
  name: string;
  scheduleKind: ScheduleKind;
  dailyTime: string;
  timezone: string;
  everyMinutes: string;
  host: string;
  repo: string;
  workspaceLabel: string;
  tabLabel: string;
  model: string;
  maxAttempts: string;
  retryDelayMinutes: string;
  prompt: string;
  enabled: boolean;
  paused: boolean;
}

export type DraftField = "name" | "id" | "host" | "repo" | "workspaceLabel" | "dailyTime" | "timezone" | "everyMinutes" | "maxAttempts" | "retryDelayMinutes" | "prompt";

export function emptyDraft(defaults: { host?: string; timezone?: string } = {}): AutomationDraft {
  return {
    id: "",
    isNew: true,
    name: "",
    scheduleKind: "daily",
    dailyTime: "09:00",
    timezone: defaults.timezone ?? "UTC",
    everyMinutes: "60",
    host: defaults.host ?? "",
    repo: "",
    workspaceLabel: "",
    tabLabel: "",
    model: "",
    maxAttempts: "1",
    retryDelayMinutes: "10",
    prompt: "",
    enabled: true,
    paused: false,
  };
}

export function draftFromAutomation(automation: Automation): AutomationDraft {
  const daily = "daily" in automation.schedule;
  return {
    id: automation.id,
    isNew: false,
    name: automation.name,
    scheduleKind: daily ? "daily" : "every",
    dailyTime: "daily" in automation.schedule ? automation.schedule.daily : "09:00",
    timezone: "daily" in automation.schedule ? automation.schedule.timezone : "UTC",
    everyMinutes: "every_minutes" in automation.schedule ? String(automation.schedule.every_minutes) : "60",
    host: automation.host,
    repo: automation.repo,
    workspaceLabel: automation.workspace_label,
    tabLabel: automation.tab_label,
    model: automation.model,
    maxAttempts: String(automation.max_attempts),
    retryDelayMinutes: String(automation.retry_delay_minutes),
    prompt: automation.prompt,
    enabled: automation.enabled,
    paused: automation.paused,
  };
}

function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function parseWholeNumber(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
}

export function validateDraft(draft: AutomationDraft): Partial<Record<DraftField, string>> {
  const errors: Partial<Record<DraftField, string>> = {};
  if (!draft.name.trim()) errors.name = "Name is required";
  const id = draft.isNew ? slugifyAutomationId(draft.id.trim() || draft.name) : draft.id;
  if ((draft.name.trim() || draft.id.trim()) && !isValidAutomationId(id)) errors.id = "Id must be lowercase letters, digits and dashes";
  if (draft.scheduleKind === "daily") {
    if (!TIME_PATTERN.test(draft.dailyTime)) errors.dailyTime = "Time must be HH:MM";
    if (!draft.timezone.trim() || !isValidTimezone(draft.timezone.trim())) errors.timezone = "Unknown timezone";
  } else {
    const minutes = parseWholeNumber(draft.everyMinutes);
    if (minutes === null || minutes < MIN_EVERY_MINUTES || minutes > MAX_MINUTES) errors.everyMinutes = `Minutes must be ${MIN_EVERY_MINUTES} to ${MAX_MINUTES}`;
  }
  const attempts = parseWholeNumber(draft.maxAttempts);
  if (attempts === null || attempts < 1 || attempts > MAX_ATTEMPTS_LIMIT) errors.maxAttempts = `Attempts must be 1 to ${MAX_ATTEMPTS_LIMIT}`;
  const delay = parseWholeNumber(draft.retryDelayMinutes);
  if (delay === null || delay < 1 || delay > MAX_MINUTES) errors.retryDelayMinutes = "Retry delay must be 1 or more minutes";
  if (!draft.host.trim()) errors.host = "Host is required";
  if (!draft.repo.trim()) errors.repo = "Repo is required";
  if (!draft.workspaceLabel.trim()) errors.workspaceLabel = "Workspace label is required";
  if (!draft.prompt.trim()) errors.prompt = "Prompt is required";
  return errors;
}

/** Call only after `validateDraft` returned no errors. */
export function draftToDefinition(draft: AutomationDraft): AutomationDefinition {
  const schedule: AutomationSchedule = draft.scheduleKind === "daily"
    ? { daily: draft.dailyTime, timezone: draft.timezone.trim() }
    : { every_minutes: Number(draft.everyMinutes.trim()) };
  const optional = (value: string): string | undefined => (value.trim() ? value.trim() : undefined);
  return {
    id: draft.isNew ? slugifyAutomationId(draft.id.trim() || draft.name) : draft.id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    paused: draft.paused,
    host: draft.host.trim(),
    schedule,
    repo: draft.repo.trim(),
    workspace_label: draft.workspaceLabel.trim(),
    tab_label: optional(draft.tabLabel),
    model: optional(draft.model),
    max_attempts: Number(draft.maxAttempts.trim()),
    retry_delay_minutes: Number(draft.retryDelayMinutes.trim()),
    prompt: draft.prompt,
  };
}

// ---- server-side body parsing ----------------------------------------------------------

type ParsedDefinition = { definition: AutomationDefinition } | { error: string };

function optionalText(body: Record<string, unknown>, key: string): string | undefined | null {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" ? value.trim() || undefined : null;
}

/** Validates an untrusted JSON body into the definition the CLI reads on stdin. */
export function parseDefinitionBody(raw: unknown, forcedId?: string): ParsedDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Invalid body" };
  const body: Record<string, unknown> = { ...raw };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "name is required" };
  const id = forcedId ?? (typeof body.id === "string" && body.id.trim() ? body.id.trim() : slugifyAutomationId(name));
  if (!isValidAutomationId(id)) return { error: "id must be lowercase letters, digits and dashes" };
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) return { error: "prompt is required" };

  const rawSchedule = body.schedule;
  if (!rawSchedule || typeof rawSchedule !== "object") return { error: "schedule is required" };
  const sched: Record<string, unknown> = { ...rawSchedule };
  let schedule: AutomationSchedule;
  if (typeof sched.daily === "string") {
    if (!TIME_PATTERN.test(sched.daily)) return { error: "schedule.daily must be HH:MM" };
    if (typeof sched.timezone !== "string" || !isValidTimezone(sched.timezone)) return { error: "schedule.timezone is not a known timezone" };
    schedule = { daily: sched.daily, timezone: sched.timezone };
  } else if (typeof sched.every_minutes === "number") {
    const n = sched.every_minutes;
    if (!Number.isInteger(n) || n < MIN_EVERY_MINUTES || n > MAX_MINUTES) return { error: `schedule.every_minutes must be ${MIN_EVERY_MINUTES} to ${MAX_MINUTES}` };
    schedule = { every_minutes: n };
  } else {
    return { error: "schedule needs daily + timezone or every_minutes" };
  }

  const attempts = body.max_attempts;
  if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS_LIMIT) {
    return { error: `max_attempts must be 1 to ${MAX_ATTEMPTS_LIMIT}` };
  }
  const delay = body.retry_delay_minutes;
  if (typeof delay !== "number" || !Number.isInteger(delay) || delay < 1 || delay > MAX_MINUTES) {
    return { error: "retry_delay_minutes must be 1 or more" };
  }

  const text: Record<"host" | "repo" | "workspace_label" | "tab_label" | "model", string | undefined> = {
    host: undefined, repo: undefined, workspace_label: undefined, tab_label: undefined, model: undefined,
  };
  for (const key of Object.keys(text) as (keyof typeof text)[]) {
    const value = optionalText(body, key);
    if (value === null) return { error: `${key} must be a string` };
    text[key] = value;
  }
  const { host, repo, workspace_label } = text;
  if (!host) return { error: "host is required" };
  if (!repo) return { error: "repo is required" };
  if (!workspace_label) return { error: "workspace_label is required" };
  return {
    definition: {
      id,
      name,
      enabled: body.enabled !== false,
      paused: body.paused === true,
      host,
      repo,
      workspace_label,
      tab_label: text.tab_label,
      model: text.model,
      schedule,
      max_attempts: attempts,
      retry_delay_minutes: delay,
      prompt,
    },
  };
}

/** "in 5m", "in 3h", "2d ago", "just now": coarse distance between an ISO time and `now`. */
export function formatRelative(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  const unit = abs < 3600 ? `${Math.round(abs / 60)}m` : abs < 86400 ? `${Math.round(abs / 3600)}h` : `${Math.round(abs / 86400)}d`;
  return seconds > 0 ? `in ${unit}` : `${unit} ago`;
}
