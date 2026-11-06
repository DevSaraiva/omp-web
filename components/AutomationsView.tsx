"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  PROMPT_PLACEHOLDERS,
  displayStatus,
  draftFromAutomation,
  draftToDefinition,
  emptyDraft,
  formatDuration,
  formatRelative,
  scheduleText,
  sortAutomations,
  statusColor,
  validateDraft,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
  type DraftField,
  type RunAction,
  type RunStatus,
} from "@/lib/automations-model";
import { MarkdownBody } from "./MarkdownBody";
import styles from "./AutomationsView.module.css";

const POLL_MS = 10_000;

type Confirm = "cancel" | "delete" | null;
type ReportState = { loading: true } | { loading: false; markdown: string; truncated: boolean } | { loading: false; error: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requestJson<T>(url: string, init?: { method: string; body?: unknown }): Promise<T> {
  const response = await fetch(url, init && {
    method: init.method,
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
  return data as T;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ status }: { status: RunStatus | null }) {
  const { t } = useI18n();
  const color = statusColor(status);
  return (
    <span className={styles.status} style={{ color, borderColor: color }}>
      {status === "running" && <span className={styles.pulse} style={{ background: color }} />}
      {status ? t(`automations.status.${status}`) : t("automations.status.never")}
    </span>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, error, hint, children }: FieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint && !error && <span className={styles.hint}>{hint}</span>}
      {error && <span className={styles.fieldError}>{error}</span>}
    </label>
  );
}

interface AutomationFormProps {
  initial: AutomationDraft;
  saving: boolean;
  error: string | null;
  hosts: string[];
  onSave: (draft: AutomationDraft) => void;
  onCancel: () => void;
}

function AutomationForm({ initial, saving, error, hosts, onSave, onCancel }: AutomationFormProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const errors = useMemo(() => validateDraft(draft), [draft]);
  const shown = (field: DraftField): string | undefined => (submitted ? errors[field] : undefined);

  function set<K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function insertPlaceholder(token: string) {
    const area = promptRef.current;
    const start = area?.selectionStart ?? draft.prompt.length;
    const end = area?.selectionEnd ?? draft.prompt.length;
    set("prompt", draft.prompt.slice(0, start) + token + draft.prompt.slice(end));
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length === 0) onSave(draft);
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <h2 className={styles.formTitle}>{draft.isNew ? t("automations.new") : t("automations.edit")}</h2>
      <Field label={t("automations.name")} error={shown("name")}>
        <input className={styles.input} value={draft.name} onChange={(e) => set("name", e.target.value)} autoFocus={draft.isNew} />
      </Field>
      {draft.isNew && (
        <Field label={t("automations.id")} error={shown("id")} hint={t("automations.idHint")}>
          <input className={styles.input} value={draft.id} onChange={(e) => set("id", e.target.value)} autoCapitalize="none" autoCorrect="off" />
        </Field>
      )}
      <div className={styles.segmented} role="radiogroup" aria-label={t("automations.schedule")}>
        <button type="button" role="radio" aria-checked={draft.scheduleKind === "daily"} className={draft.scheduleKind === "daily" ? styles.segmentOn : styles.segment} onClick={() => set("scheduleKind", "daily")}>
          {t("automations.scheduleDaily")}
        </button>
        <button type="button" role="radio" aria-checked={draft.scheduleKind === "every"} className={draft.scheduleKind === "every" ? styles.segmentOn : styles.segment} onClick={() => set("scheduleKind", "every")}>
          {t("automations.scheduleEvery")}
        </button>
      </div>
      {draft.scheduleKind === "daily" ? (
        <div className={styles.row}>
          <Field label={t("automations.time")} error={shown("dailyTime")}>
            <input className={styles.input} type="time" value={draft.dailyTime} onChange={(e) => set("dailyTime", e.target.value)} />
          </Field>
          <Field label={t("automations.timezone")} error={shown("timezone")}>
            <input className={styles.input} value={draft.timezone} onChange={(e) => set("timezone", e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="Europe/Lisbon" />
          </Field>
        </div>
      ) : (
        <Field label={t("automations.everyMinutes")} error={shown("everyMinutes")}>
          <input className={styles.input} inputMode="numeric" value={draft.everyMinutes} onChange={(e) => set("everyMinutes", e.target.value)} />
        </Field>
      )}
      <Field label={t("automations.host")} error={shown("host")}>
        <input className={styles.input} list="automation-hosts" value={draft.host} onChange={(e) => set("host", e.target.value)} autoCapitalize="none" autoCorrect="off" />
        <datalist id="automation-hosts">
          {hosts.map((host) => <option key={host} value={host} />)}
        </datalist>
      </Field>
      <Field label={t("automations.repo")} error={shown("repo")}>
        <input className={styles.input} value={draft.repo} onChange={(e) => set("repo", e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="/path/to/repo" />
      </Field>
      <div className={styles.row}>
        <Field label={t("automations.workspaceLabel")} error={shown("workspaceLabel")}>
          <input className={styles.input} value={draft.workspaceLabel} onChange={(e) => set("workspaceLabel", e.target.value)} />
        </Field>
        <Field label={t("automations.tabLabel")} hint={t("automations.optionalHint")}>
          <input className={styles.input} value={draft.tabLabel} onChange={(e) => set("tabLabel", e.target.value)} />
        </Field>
      </div>
      <Field label={t("automations.model")} hint={t("automations.optionalHint")}>
        <input className={styles.input} value={draft.model} onChange={(e) => set("model", e.target.value)} autoCapitalize="none" autoCorrect="off" />
      </Field>
      <div className={styles.row}>
        <Field label={t("automations.maxAttempts")} error={shown("maxAttempts")}>
          <input className={styles.input} inputMode="numeric" value={draft.maxAttempts} onChange={(e) => set("maxAttempts", e.target.value)} />
        </Field>
        <Field label={t("automations.retryDelay")} error={shown("retryDelayMinutes")}>
          <input className={styles.input} inputMode="numeric" value={draft.retryDelayMinutes} onChange={(e) => set("retryDelayMinutes", e.target.value)} />
        </Field>
      </div>
      <Field label={t("automations.prompt")} error={shown("prompt")}>
        <textarea ref={promptRef} className={`${styles.input} ${styles.textarea}`} value={draft.prompt} onChange={(e) => set("prompt", e.target.value)} spellCheck={false} />
      </Field>
      <div className={styles.placeholders}>
        <span className={styles.hint}>{t("automations.placeholders")}</span>
        <div className={styles.chips}>
          {PROMPT_PLACEHOLDERS.map((token) => (
            <button key={token} type="button" className={styles.chip} onClick={() => insertPlaceholder(token)}>{token}</button>
          ))}
        </div>
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={draft.paused} onChange={(e) => set("paused", e.target.checked)} />
        {t("automations.pausedOption")}
      </label>
      {error && <div className={styles.errorBox} role="alert">{error}</div>}
      <div className={styles.actions}>
        <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={saving}>
          {saving ? t("automations.saving") : t("automations.save")}
        </button>
        <button type="button" className={styles.button} onClick={onCancel} disabled={saving}>{t("automations.cancelEdit")}</button>
      </div>
    </form>
  );
}

interface RunRowProps {
  automationId: string;
  run: AutomationRun;
  now: number;
  onOpenAgent: (paneId: string) => void;
}

function RunRow({ automationId, run, now, onOpenAgent }: RunRowProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<ReportState | null>(null);
  const runId = run.run_id;
  const reportable = run.report_exists && runId !== null;

  const loadReport = useCallback(async () => {
    setReport((current) => (current && !current.loading && !("error" in current) ? current : { loading: true }));
    try {
      const data = await requestJson<{ markdown: string; truncated: boolean }>(
        `/api/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId ?? "")}/report`,
      );
      setReport({ loading: false, markdown: data.markdown, truncated: data.truncated });
    } catch (error) {
      setReport({ loading: false, error: messageOf(error) });
    }
  }, [automationId, runId]);

  // Reload when the report appears or the run finishes while the panel is open.
  useEffect(() => {
    if (open && reportable) void loadReport();
  }, [open, reportable, run.status, run.report_exists, loadReport]);

  return (
    <li className={styles.run}>
      <div className={styles.runHead}>
        <StatusBadge status={run.status} />
        <span className={styles.runMeta}>
          {t("automations.attempt", { n: run.attempt })} · {formatWhen(run.started_at)} · {formatDuration(run.started_at, run.finished_at, now)}
        </span>
      </div>
      {run.error && <div className={styles.runError}>{run.error}</div>}
      <div className={styles.runActions}>
        {reportable && (
          <button type="button" className={styles.linkButton} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? t("automations.hideReport") : t("automations.showReport")}
          </button>
        )}
        {!reportable && <span className={styles.hint}>{t("automations.noReport")}</span>}
        {run.pane_id && (
          <button type="button" className={styles.linkButton} onClick={() => onOpenAgent(run.pane_id as string)}>
            {t("automations.openAgent")}
          </button>
        )}
      </div>
      {open && reportable && (
        <div className={styles.report}>
          {!report || report.loading ? <div className={styles.hint}>{t("automations.loading")}</div>
            : "error" in report ? <div className={styles.runError}>{report.error}</div>
              : (
                <>
                  <MarkdownBody>{report.markdown}</MarkdownBody>
                  {report.truncated && <div className={styles.hint}>{t("automations.reportTruncated")}</div>}
                </>
              )}
        </div>
      )}
    </li>
  );
}

interface DetailProps {
  automation: Automation;
  runs: AutomationRun[] | null;
  runsError: string | null;
  now: number;
  busy: boolean;
  error: string | null;
  onAction: (action: RunAction) => void;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
  onOpenAgent: (paneId: string) => void;
}

function AutomationDetail({ automation, runs, runsError, now, busy, error, onAction, onEdit, onDelete, onBack, onOpenAgent }: DetailProps) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const active = automation.active?.status === "running";
  const remote = !automation.runs_here;

  useEffect(() => { setConfirm(null); }, [automation.id]);

  return (
    <div className={styles.detailBody}>
      <button type="button" className={`${styles.linkButton} ${styles.back}`} onClick={onBack}>{t("automations.back")}</button>
      <div className={styles.detailHead}>
        <h2 className={styles.detailTitle}>{automation.name}</h2>
        <StatusBadge status={displayStatus(automation)} />
        {automation.paused && <span className={styles.badge}>{t("automations.paused")}</span>}
      </div>
      <dl className={styles.facts}>
        <dt>{t("automations.schedule")}</dt><dd>{automation.schedule_text || scheduleText(automation.schedule)}</dd>
        <dt>{t("automations.nextRun")}</dt>
        <dd>{automation.paused || !automation.next_run ? "-" : `${formatWhen(automation.next_run)} (${formatRelative(automation.next_run, now)})`}</dd>
        <dt>{t("automations.host")}</dt><dd>{automation.runs_here ? t("automations.thisHost", { host: automation.host }) : automation.host}</dd>
        {automation.repo && <><dt>{t("automations.repo")}</dt><dd className={styles.mono}>{automation.repo}</dd></>}
        {automation.model && <><dt>{t("automations.model")}</dt><dd className={styles.mono}>{automation.model}</dd></>}
        <dt>{t("automations.maxAttempts")}</dt><dd>{automation.max_attempts}</dd>
      </dl>
      {automation.last_error && <div className={styles.errorBox}>{automation.last_error}</div>}
      {error && <div className={styles.errorBox} role="alert">{error}</div>}
      {remote && <div className={styles.hint}>{t("automations.remoteHint", { host: automation.host })}</div>}
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy || remote || active} onClick={() => onAction("run")}>
          {t("automations.runNow")}
        </button>
        <button type="button" className={styles.button} disabled={busy} onClick={() => onAction(automation.paused ? "resume" : "pause")}>
          {automation.paused ? t("automations.resume") : t("automations.pause")}
        </button>
        {active && (confirm === "cancel" ? (
          <>
            <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy || remote} onClick={() => { setConfirm(null); onAction("cancel"); }}>
              {t("automations.confirmCancel")}
            </button>
            <button type="button" className={styles.button} onClick={() => setConfirm(null)}>{t("automations.keepRunning")}</button>
          </>
        ) : (
          <button type="button" className={styles.button} disabled={busy || remote} onClick={() => setConfirm("cancel")}>{t("automations.cancelRun")}</button>
        ))}
        <button type="button" className={styles.button} disabled={busy} onClick={onEdit}>{t("automations.edit")}</button>
        {confirm === "delete" ? (
          <>
            <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy} onClick={() => { setConfirm(null); onDelete(); }}>
              {t("automations.confirmDelete")}
            </button>
            <button type="button" className={styles.button} onClick={() => setConfirm(null)}>{t("automations.keep")}</button>
          </>
        ) : (
          <button type="button" className={styles.button} disabled={busy} onClick={() => setConfirm("delete")}>{t("automations.delete")}</button>
        )}
      </div>
      <h3 className={styles.sectionTitle}>{t("automations.runs")}</h3>
      {runsError && <div className={styles.errorBox}>{runsError}</div>}
      {!runs && !runsError && <div className={styles.hint}>{t("automations.loading")}</div>}
      {runs && runs.length === 0 && <div className={styles.hint}>{t("automations.noRuns")}</div>}
      {runs && runs.length > 0 && (
        <ul className={styles.runList}>
          {runs.map((run, index) => <RunRow key={run.run_id ?? `${run.slot}:${index}`} automationId={automation.id} run={run} now={now} onOpenAgent={onOpenAgent} />)}
        </ul>
      )}
    </div>
  );
}

export function AutomationsView({ onOpenAgent }: { onOpenAgent: (paneId: string) => void }) {
  const { t } = useI18n();
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AutomationDraft | null>(null);
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const refresh = useCallback(async () => {
    try {
      const data = await requestJson<{ automations: Automation[] }>("/api/automations");
      setAutomations(data.automations);
      setListError(null);
    } catch (error) {
      setListError(messageOf(error));
    }
    const id = selectedRef.current;
    if (id) {
      try {
        const data = await requestJson<{ runs: AutomationRun[] }>(`/api/automations/${encodeURIComponent(id)}/runs`);
        if (selectedRef.current === id) {
          setRuns(data.runs);
          setRunsError(null);
        }
      } catch (error) {
        if (selectedRef.current === id) setRunsError(messageOf(error));
      }
    }
    setNow(Date.now());
  }, []);

  // Poll while the tab is visible; catch up as soon as it becomes visible again.
  useEffect(() => {
    void refresh();
    let timer: number | undefined;
    const start = () => {
      if (timer === undefined && document.visibilityState === "visible") timer = window.setInterval(() => { void refresh(); }, POLL_MS);
    };
    const stop = () => {
      window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const selected = useMemo(() => automations?.find((a) => a.id === selectedId) ?? null, [automations, selectedId]);
  const sorted = useMemo(() => sortAutomations(automations ?? []), [automations]);
  const hosts = useMemo(() => [...new Set((automations ?? []).map((a) => a.host).filter(Boolean))], [automations]);

  function select(id: string) {
    setSelectedId(id);
    setForm(null);
    setRuns(null);
    setRunsError(null);
    setActionError(null);
    selectedRef.current = id;
    void refresh();
  }

  function back() {
    setSelectedId(null);
    setForm(null);
    setActionError(null);
  }

  function startNew() {
    const local = automations?.find((a) => a.runs_here);
    setSelectedId(null);
    setActionError(null);
    setForm(emptyDraft({ host: local?.host, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  }

  async function runAction(action: RunAction) {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const data = await requestJson<{ automation: Automation }>(`/api/automations/${encodeURIComponent(selected.id)}`, { method: "POST", body: { action } });
      setAutomations((list) => list?.map((a) => (a.id === data.automation.id ? data.automation : a)) ?? list);
      await refresh();
    } catch (error) {
      setActionError(t("automations.actionFailed", { action: t(`automations.action.${action}`), error: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  async function save(draft: AutomationDraft) {
    setBusy(true);
    setActionError(null);
    try {
      const definition = draftToDefinition(draft);
      const url = draft.isNew ? "/api/automations" : `/api/automations/${encodeURIComponent(draft.id)}`;
      const data = await requestJson<{ automation: Automation }>(url, { method: draft.isNew ? "POST" : "PUT", body: definition });
      setForm(null);
      setSelectedId(data.automation.id);
      selectedRef.current = data.automation.id;
      setRuns(null);
      await refresh();
    } catch (error) {
      setActionError(t("automations.saveFailed", { error: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      await requestJson<{ ok: boolean }>(`/api/automations/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      back();
      await refresh();
    } catch (error) {
      setActionError(t("automations.deleteFailed", { error: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  const detailOpen = Boolean(selected || form);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>{t("automations.title")}</h1>
        <button type="button" className={`${styles.button} ${styles.iconButton}`} onClick={() => { void refresh(); }} aria-label={t("automations.refresh")} title={t("automations.refresh")}>
          ↻
        </button>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={startNew}>{t("automations.new")}</button>
      </div>
      <div className={`${styles.body} ${detailOpen ? styles.detailOpen : ""}`}>
        <div className={styles.list}>
          {listError && <div className={styles.errorBox}>{t("automations.loadFailed", { error: listError })}</div>}
          {!automations && !listError && <div className={styles.message}>{t("automations.loading")}</div>}
          {automations && automations.length === 0 && <div className={styles.message}>{t("automations.empty")}</div>}
          {sorted.map((automation) => (
            <button
              key={automation.id}
              type="button"
              className={`${styles.card} ${automation.id === selectedId ? styles.cardSelected : ""}`}
              onClick={() => select(automation.id)}
            >
              <span className={styles.cardTop}>
                <span className={styles.cardName}>{automation.name}</span>
                <StatusBadge status={displayStatus(automation)} />
              </span>
              <span className={styles.cardMeta}>
                {automation.schedule_text || scheduleText(automation.schedule)}
                {automation.paused ? "" : automation.next_run ? ` · ${t("automations.next", { when: formatRelative(automation.next_run, now) })}` : ""}
              </span>
              <span className={styles.cardBadges}>
                {automation.paused && <span className={styles.badge}>{t("automations.paused")}</span>}
                <span className={styles.badge}>{automation.runs_here ? t("automations.thisHost", { host: automation.host }) : automation.host}</span>
              </span>
            </button>
          ))}
        </div>
        <div className={styles.detail}>
          {form ? (
            <AutomationForm key={form.id || "new"} initial={form} saving={busy} error={actionError} hosts={hosts} onSave={(draft) => { void save(draft); }} onCancel={() => setForm(null)} />
          ) : selected ? (
            <AutomationDetail
              automation={selected}
              runs={runs}
              runsError={runsError}
              now={now}
              busy={busy}
              error={actionError}
              onAction={(action) => { void runAction(action); }}
              onEdit={() => { setActionError(null); setForm(draftFromAutomation(selected)); }}
              onDelete={() => { void remove(); }}
              onBack={back}
              onOpenAgent={onOpenAgent}
            />
          ) : (
            <div className={styles.message}>{t("automations.selectHint")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
