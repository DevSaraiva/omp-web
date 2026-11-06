import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  displayStatus,
  draftFromAutomation,
  draftToDefinition,
  emptyDraft,
  formatDuration,
  formatRelative,
  parseDefinitionBody,
  scheduleText,
  slugifyAutomationId,
  sortAutomations,
  validateDraft,
} = await jiti.import("./automations-model.ts");

function automation(overrides = {}) {
  return {
    id: "a",
    name: "A",
    enabled: true,
    paused: false,
    host: "macbook-air",
    runs_here: true,
    schedule: { daily: "18:00", timezone: "Europe/Lisbon" },
    schedule_text: "daily 18:00 Europe/Lisbon",
    next_run: null,
    repo: "",
    workspace_label: "",
    tab_label: "",
    model: "",
    max_attempts: 2,
    retry_delay_minutes: 15,
    prompt: "go",
    active: null,
    last_run: null,
    last_success: null,
    last_error: null,
    ...overrides,
  };
}

const run = (status) => ({ run_id: "r", status });

test("schedule text reads naturally for minute intervals", () => {
  assert.equal(scheduleText({ every_minutes: 45 }), "every 45 minutes");
  assert.equal(scheduleText({ every_minutes: 60 }), "every hour");
  assert.equal(scheduleText({ every_minutes: 180 }), "every 3 hours");
  assert.equal(scheduleText({ every_minutes: 1440 }), "every day");
  assert.equal(scheduleText({ every_minutes: 2880 }), "every 2 days");
  assert.equal(scheduleText({ daily: "18:00", timezone: "Europe/Lisbon" }), "daily 18:00 Europe/Lisbon");
});

test("the active run's status wins over the last finished run", () => {
  assert.equal(displayStatus(automation({ active: run("running"), last_run: run("failed") })), "running");
  assert.equal(displayStatus(automation({ last_run: run("blocked") })), "blocked");
  assert.equal(displayStatus(automation()), null);
});

test("list ordering puts running and failing first, then soonest next run, paused last", () => {
  const list = sortAutomations([
    automation({ id: "later", name: "later", next_run: "2026-11-07T10:00:00Z" }),
    automation({ id: "paused", name: "paused", paused: true, next_run: "2026-11-06T10:00:00Z" }),
    automation({ id: "soon", name: "soon", next_run: "2026-11-06T18:00:00Z" }),
    automation({ id: "failed", name: "failed", last_run: run("failed") }),
    automation({ id: "running", name: "running", active: run("running") }),
    automation({ id: "blocked", name: "blocked", last_run: run("blocked") }),
  ]);
  assert.deepEqual(list.map((a) => a.id), ["running", "failed", "blocked", "soon", "later", "paused"]);
});

test("durations and relative times", () => {
  const start = "2026-11-06T10:00:00Z";
  assert.equal(formatDuration(start, "2026-11-06T10:00:12Z", 0), "12s");
  assert.equal(formatDuration(start, "2026-11-06T10:04:05Z", 0), "4m 05s");
  assert.equal(formatDuration(start, "2026-11-06T11:02:00Z", 0), "1h 02m");
  assert.equal(formatDuration(start, null, Date.parse("2026-11-06T10:01:30Z")), "1m 30s");
  assert.equal(formatDuration("garbage", null, 0), "");
  const now = Date.parse("2026-11-06T12:00:00Z");
  assert.equal(formatRelative("2026-11-06T12:05:00Z", now), "in 5m");
  assert.equal(formatRelative("2026-11-06T15:00:00Z", now), "in 3h");
  assert.equal(formatRelative("2026-11-04T12:00:00Z", now), "2d ago");
  assert.equal(formatRelative("2026-11-06T12:00:10Z", now), "just now");
});

test("ids are slugged to lowercase dashes", () => {
  assert.equal(slugifyAutomationId("Google Ads: Daily Audit!"), "google-ads-daily-audit");
  assert.equal(slugifyAutomationId("  Análise Diária  "), "analise-diaria");
  assert.equal(slugifyAutomationId("***"), "");
});

test("draft validation covers schedule, counts and required text", () => {
  const ok = { ...emptyDraft({ host: "macbook-air", timezone: "Europe/Lisbon" }), name: "Audit", prompt: "go", repo: "/r", workspaceLabel: "Ws" };
  assert.deepEqual(validateDraft(ok), {});

  const bad = validateDraft({ ...ok, name: " ", prompt: "", dailyTime: "25:00", timezone: "Mars/Base", maxAttempts: "0", retryDelayMinutes: "0", host: "", repo: " ", workspaceLabel: "" });
  assert.deepEqual(Object.keys(bad).sort(), ["dailyTime", "host", "maxAttempts", "name", "prompt", "repo", "retryDelayMinutes", "timezone", "workspaceLabel"]);

  assert.ok(validateDraft({ ...ok, name: "***" }).id);

  const every = { ...ok, scheduleKind: "every" };
  assert.deepEqual(validateDraft({ ...every, everyMinutes: "1440" }), {});
  assert.ok(validateDraft({ ...every, everyMinutes: "4" }).everyMinutes);
  assert.deepEqual(validateDraft({ ...every, everyMinutes: "5" }), {});
  assert.ok(validateDraft({ ...every, everyMinutes: "1.5" }).everyMinutes);
  // A daily-only error must not block an every-N schedule.
  assert.deepEqual(validateDraft({ ...every, dailyTime: "nope", timezone: "" }), {});
});

test("a draft becomes a CLI definition and edits keep the id", () => {
  const draft = {
    ...emptyDraft({ host: "macbook-air", timezone: "Europe/Lisbon" }),
    name: "Daily Audit",
    prompt: "go {date}",
    scheduleKind: "every",
    everyMinutes: "1440",
    repo: " /r ",
    workspaceLabel: "Ws",
    maxAttempts: "3",
    retryDelayMinutes: "30",
    paused: true,
  };
  assert.deepEqual(draftToDefinition(draft), {
    id: "daily-audit",
    name: "Daily Audit",
    enabled: true,
    paused: true,
    host: "macbook-air",
    schedule: { every_minutes: 1440 },
    repo: "/r",
    workspace_label: "Ws",
    tab_label: undefined,
    model: undefined,
    max_attempts: 3,
    retry_delay_minutes: 30,
    prompt: "go {date}",
  });

  const existing = automation({ id: "kept-id", name: "Renamed" });
  const edited = draftFromAutomation(existing);
  assert.equal(draftToDefinition({ ...edited, name: "New name" }).id, "kept-id");
  assert.deepEqual(draftToDefinition(edited).schedule, { daily: "18:00", timezone: "Europe/Lisbon" });
});

test("server body parsing rejects bad input and forces the URL id", () => {
  const body = {
    name: "Audit",
    prompt: "go",
    schedule: { daily: "18:00", timezone: "Europe/Lisbon" },
    host: "macbook-air",
    repo: "/r",
    workspace_label: "Ws",
    max_attempts: 2,
    retry_delay_minutes: 15,
  };
  const parsed = parseDefinitionBody(body);
  assert.equal(parsed.definition.id, "audit");
  assert.equal(parsed.definition.enabled, true);
  assert.equal(parsed.definition.paused, false);

  assert.equal(parseDefinitionBody(body, "from-url").definition.id, "from-url");
  assert.equal(parseDefinitionBody({ ...body, id: "--flag" }).error, "id must be lowercase letters, digits and dashes");
  assert.ok(parseDefinitionBody({ ...body, schedule: { every_minutes: 4 } }).error);
  assert.ok(parseDefinitionBody({ ...body, host: "" }).error);
  assert.ok(parseDefinitionBody({ ...body, retry_delay_minutes: 0 }).error);
  assert.equal(parseDefinitionBody({ ...body, id: "a--b" }).error, "id must be lowercase letters, digits and dashes");
  assert.ok(parseDefinitionBody({ ...body, schedule: { daily: "18:00", timezone: "Nope/Zone" } }).error);
  assert.ok(parseDefinitionBody({ ...body, max_attempts: "2" }).error);
  assert.ok(parseDefinitionBody({ ...body, repo: 5 }).error);
  assert.ok(parseDefinitionBody(null).error);
  assert.ok(parseDefinitionBody([]).error);
});
