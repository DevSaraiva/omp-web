"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  KAN_AGENT_PLAYBOOKS,
  buildKanTaskText,
  pickDefaultHerdrWorkspace,
  type HerdrMachineView,
  type KanAgentPlaybook,
  type KanBoard,
  type KanBoardSummary,
  type KanCardDetail,
  type KanLabel,
  type KanWorkspace,
} from "@/lib/kan-types";
import type { SessionInfo } from "@/lib/types";
import { MarkdownBody } from "./MarkdownBody";
import styles from "./KanbanView.module.css";

const WORKSPACE_KEY = "omp-kanban-workspace";
const BOARD_KEY = "omp-kanban-board";
const PROJECT_KEY = "omp-kanban-project";
const PREFERRED_BOARD = "product";
const IN_PROGRESS = "in progress";

function readStored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the choice just is not remembered.
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requestJson<T>(url: string, init?: { method: string; body: unknown }): Promise<T> {
  const response = await fetch(url, init && {
    method: init.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(init.body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
  return data as T;
}

function LabelChips({ labels }: { labels: KanLabel[] }) {
  return (
    <>
      {labels.map((label) => (
        <span key={label.publicId} className={styles.chip} style={{ background: label.colourCode }} title={label.name}>
          {label.name}
        </span>
      ))}
    </>
  );
}

interface AgentStartResponse {
  name: string;
  paneId: string;
  workspaceId?: string;
  worktree?: string;
  branch?: string;
}

interface AgentResult {
  name: string;
  paneId: string;
  branch?: string;
  warning?: string;
}

function StartAgentDialog({
  card,
  onClose,
  onCardChanged,
  onOpenAgent,
}: {
  card: KanCardDetail;
  onClose: () => void;
  onCardChanged: () => void;
  onOpenAgent: (paneId: string) => void;
}) {
  const { t } = useI18n();
  const [playbook, setPlaybook] = useState<KanAgentPlaybook>("software");
  const [repo, setRepo] = useState(() => readStored(PROJECT_KEY));
  const [task, setTask] = useState(() => buildKanTaskText(card));
  const [projects, setProjects] = useState<string[]>([]);
  const [machines, setMachines] = useState<HerdrMachineView[]>([]);
  const [herdrError, setHerdrError] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const workspaceTouched = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AgentResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void requestJson<{ sessions: SessionInfo[] }>("/api/sessions")
      .then(({ sessions }) => {
        if (cancelled) return;
        const roots = [...new Set(sessions.map((session) => session.projectRoot ?? session.cwd).filter(Boolean))];
        setProjects(roots);
        setRepo((current) => current || roots[0] || "");
      })
      .catch(() => {
        // The project field still accepts free text without the suggestions.
      });
    void requestJson<{ machines: HerdrMachineView[] }>("/api/herdr")
      .then(({ machines: found }) => {
        if (!cancelled) setMachines(found);
      })
      .catch((e: unknown) => {
        if (!cancelled) setHerdrError(messageOf(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceTouched.current) setWorkspaceId(pickDefaultHerdrWorkspace(machines, repo, playbook) ?? "");
  }, [machines, repo, playbook]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  // Agents start on the machine serving omp-web, so only its own workspaces are offered.
  const workspaceOptions = machines.filter((machine) => machine.local !== false).flatMap((machine) =>
    machine.workspaces.map((workspace) => ({ id: workspace.id, label: workspace.label })),
  );

  async function start() {
    setSubmitting(true);
    setError("");
    let started: AgentStartResponse;
    try {
      started = await requestJson<AgentStartResponse>("/api/herdr/agents", {
        method: "POST",
        body: {
          playbook,
          repo: repo.trim(),
          task: task.trim(),
          card: card.publicId,
          ...(workspaceId ? { workspaceId } : {}),
        },
      });
    } catch (e) {
      setError(t("kanban.startFailed", { error: messageOf(e) }));
      setSubmitting(false);
      return;
    }

    writeStored(PROJECT_KEY, repo.trim());
    const warnings: string[] = [];
    const inProgress = card.lists.find((list) => list.name.trim().toLowerCase() === IN_PROGRESS);
    try {
      if (inProgress && inProgress.publicId !== card.list.publicId) {
        await requestJson(`/api/kan/cards/${card.publicId}`, {
          method: "PUT",
          body: { listPublicId: inProgress.publicId },
        });
      }
    } catch (e) {
      warnings.push(messageOf(e));
    }
    try {
      await requestJson(`/api/kan/cards/${card.publicId}/comments`, {
        method: "POST",
        body: {
          comment: started.branch
            ? `Agent ${started.name} started on ${started.branch}`
            : `Agent ${started.name} started`,
        },
      });
    } catch (e) {
      warnings.push(messageOf(e));
    }

    onCardChanged();
    setResult({
      name: started.name,
      paneId: started.paneId,
      branch: started.branch,
      warning: warnings.length > 0 ? t("kanban.agentCardNotUpdated", { error: warnings.join("; ") }) : undefined,
    });
    setSubmitting(false);
  }

  return (
    <div className={`${styles.backdrop} ${styles.backdropCentered}`} role="presentation">
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t("kanban.agentDialogTitle")}>
        <div className={styles.dialogHeader}>
          <h2 className={styles.sheetTitle}>{t("kanban.agentDialogTitle")}</h2>
        </div>
        {result ? (
          <>
            <div className={styles.dialogBody}>
              <div className={styles.result}>
                <div className={styles.resultName}>{t("kanban.agentStarted", { name: result.name })}</div>
                {result.branch && <div>{t("kanban.agentBranch", { branch: result.branch })}</div>}
                {result.warning && <div className={styles.notice}>{result.warning}</div>}
              </div>
            </div>
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.button} onClick={onClose}>{t("kanban.close")}</button>
              <button
                type="button"
                className={`${styles.button} ${styles.primary}`}
                onClick={() => onOpenAgent(result.paneId)}
              >
                {t("kanban.openAgent")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.dialogBody}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t("kanban.playbook")}</span>
                <select
                  className={styles.select}
                  value={playbook}
                  onChange={(event) => setPlaybook(event.target.value as KanAgentPlaybook)}
                >
                  {KAN_AGENT_PLAYBOOKS.map((name) => (
                    <option key={name} value={name}>{t(`kanban.playbook.${name}`)}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t("kanban.project")}</span>
                <input
                  className={styles.textInput}
                  list="kanban-projects"
                  value={repo}
                  placeholder={t("kanban.projectPlaceholder")}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => setRepo(event.target.value)}
                />
                <datalist id="kanban-projects">
                  {projects.map((project) => <option key={project} value={project} />)}
                </datalist>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t("kanban.herdrWorkspace")}</span>
                <select
                  className={styles.select}
                  value={workspaceId}
                  onChange={(event) => {
                    workspaceTouched.current = true;
                    setWorkspaceId(event.target.value);
                  }}
                >
                  <option value="">{t("kanban.herdrNewWorkspace")}</option>
                  {workspaceOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                {herdrError && <span className={styles.notice}>{t("kanban.herdrUnavailable", { error: herdrError })}</span>}
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t("kanban.task")}</span>
                <textarea
                  className={styles.textArea}
                  value={task}
                  onChange={(event) => setTask(event.target.value)}
                />
              </label>
              {error && <div className={styles.error}>{error}</div>}
            </div>
            <div className={styles.dialogFooter}>
              <button type="button" className={styles.button} onClick={onClose} disabled={submitting}>
                {t("kanban.cancel")}
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.primary}`}
                onClick={() => void start()}
                disabled={submitting || !repo.trim() || !task.trim()}
              >
                {submitting ? t("kanban.starting") : t("kanban.start")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CardSheet({
  cardId,
  onClose,
  onChanged,
  onOpenAgent,
}: {
  cardId: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenAgent: (paneId: string) => void;
}) {
  const { t } = useI18n();
  const [card, setCard] = useState<KanCardDetail | null>(null);
  const [error, setError] = useState("");
  const [moveError, setMoveError] = useState("");
  const [moving, setMoving] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    requestJson<{ card: KanCardDetail }>(`/api/kan/cards/${cardId}`)
      .then((data) => {
        if (cancelled) return;
        setCard(data.card);
        setError("");
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(t("kanban.cardFailed", { error: messageOf(e) }));
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, reload, t]);

  useEffect(() => {
    if (agentOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [agentOpen, onClose]);

  const cardChanged = useCallback(() => {
    setReload((n) => n + 1);
    onChanged();
  }, [onChanged]);

  async function move(listPublicId: string) {
    if (!card || listPublicId === card.list.publicId) return;
    setMoving(true);
    setMoveError("");
    try {
      await requestJson(`/api/kan/cards/${card.publicId}`, { method: "PUT", body: { listPublicId } });
      cardChanged();
    } catch (e) {
      setMoveError(t("kanban.moveFailed", { error: messageOf(e) }));
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className={styles.backdrop} role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={card?.title ?? t("kanban.title")}>
        <div className={styles.sheetHeader}>
          <h2 className={styles.sheetTitle}>{card?.title ?? t("kanban.cardLoading")}</h2>
          <button type="button" className={`${styles.button} ${styles.iconButton}`} onClick={onClose} aria-label={t("kanban.close")}>
            ×
          </button>
        </div>
        <div className={styles.sheetBody}>
          {error && <div className={styles.error}>{error}</div>}
          {!card && !error && <div className={styles.message}>{t("kanban.cardLoading")}</div>}
          {card && (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t("kanban.moveTo")}</span>
                <select
                  className={styles.select}
                  value={card.list.publicId}
                  disabled={moving}
                  onChange={(event) => void move(event.target.value)}
                >
                  {card.lists.map((list) => (
                    <option key={list.publicId} value={list.publicId}>{list.name}</option>
                  ))}
                </select>
                {moveError && <span className={styles.error}>{moveError}</span>}
              </label>
              {card.labels.length > 0 && (
                <div className={styles.section}>
                  <h3 className={styles.sectionTitle}>{t("kanban.labels")}</h3>
                  <div className={styles.cardMeta}><LabelChips labels={card.labels} /></div>
                </div>
              )}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>{t("kanban.description")}</h3>
                {card.description.trim()
                  ? <MarkdownBody>{card.description}</MarkdownBody>
                  : <div className={styles.empty}>{t("kanban.noDescription")}</div>}
              </div>
              {card.checklists.length > 0 && (
                <div className={styles.section}>
                  <h3 className={styles.sectionTitle}>{t("kanban.checklists")}</h3>
                  {card.checklists.map((checklist) => (
                    <div key={checklist.publicId} className={styles.section}>
                      <strong>
                        {checklist.name}{" "}
                        <span className={styles.count}>
                          {t("kanban.checklistProgress", {
                            done: checklist.items.filter((item) => item.completed).length,
                            total: checklist.items.length,
                          })}
                        </span>
                      </strong>
                      {checklist.items.map((item) => (
                        <div key={item.publicId} className={styles.checklistItem}>
                          <span className={styles.checkbox} aria-hidden="true">{item.completed ? "☑" : "☐"}</span>
                          <span className={item.completed ? styles.checklistDone : undefined}>{item.title}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>{t("kanban.comments")}</h3>
                {card.comments.length === 0 && <div className={styles.empty}>{t("kanban.noComments")}</div>}
                {card.comments.map((comment) => (
                  <div key={comment.publicId} className={styles.comment}>
                    <div className={styles.commentMeta}>
                      {comment.author ? `${comment.author} · ` : ""}{new Date(comment.createdAt).toLocaleString()}
                    </div>
                    <MarkdownBody>{comment.comment}</MarkdownBody>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className={styles.sheetFooter}>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            disabled={!card}
            onClick={() => setAgentOpen(true)}
          >
            {t("kanban.startAgent")}
          </button>
        </div>
      </div>
      {agentOpen && card && (
        <StartAgentDialog
          card={card}
          onClose={() => setAgentOpen(false)}
          onCardChanged={cardChanged}
          onOpenAgent={(paneId) => {
            setAgentOpen(false);
            onOpenAgent(paneId);
          }}
        />
      )}
    </div>
  );
}

export function KanbanView(props: { onOpenAgent: (paneId: string) => void }) {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<KanWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [boards, setBoards] = useState<KanBoardSummary[]>([]);
  const [boardId, setBoardId] = useState("");
  const [board, setBoard] = useState<KanBoard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeListId, setActiveListId] = useState("");
  const [openCardId, setOpenCardId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [boardTick, setBoardTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    requestJson<{ workspaces: KanWorkspace[] }>("/api/kan/workspaces")
      .then(({ workspaces: found }) => {
        if (cancelled) return;
        setWorkspaces(found);
        const stored = readStored(WORKSPACE_KEY);
        setWorkspaceId((found.find((workspace) => workspace.publicId === stored) ?? found[0])?.publicId ?? "");
        if (found.length === 0) setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(t("kanban.loadFailed", { error: messageOf(e) }));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, t]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    requestJson<{ boards: KanBoardSummary[] }>(`/api/kan/workspaces/${workspaceId}/boards`)
      .then(({ boards: found }) => {
        if (cancelled) return;
        setBoards(found);
        const stored = readStored(BOARD_KEY);
        const pick = found.find((entry) => entry.publicId === stored)
          ?? found.find((entry) => entry.name.trim().toLowerCase() === PREFERRED_BOARD)
          ?? found[0];
        setBoardId(pick?.publicId ?? "");
        if (!pick) setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(t("kanban.loadFailed", { error: messageOf(e) }));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, reloadKey, t]);

  useEffect(() => {
    if (!boardId) return;
    let cancelled = false;
    requestJson<{ board: KanBoard }>(`/api/kan/boards/${boardId}`)
      .then((data) => {
        if (cancelled) return;
        setBoard(data.board);
        setError("");
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(t("kanban.loadFailed", { error: messageOf(e) }));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, reloadKey, boardTick, t]);

  const activeList = useMemo(
    () => board?.lists.find((list) => list.publicId === activeListId) ?? board?.lists[0],
    [board, activeListId],
  );

  const refreshBoard = useCallback(() => setBoardTick((n) => n + 1), []);
  const closeCard = useCallback(() => setOpenCardId(""), []);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <select
          className={styles.select}
          aria-label={t("kanban.workspace")}
          value={workspaceId}
          onChange={(event) => {
            writeStored(WORKSPACE_KEY, event.target.value);
            setBoard(null);
            setBoardId("");
            setLoading(true);
            setWorkspaceId(event.target.value);
          }}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.publicId} value={workspace.publicId}>{workspace.name}</option>
          ))}
        </select>
        <select
          className={styles.select}
          aria-label={t("kanban.board")}
          value={boardId}
          onChange={(event) => {
            writeStored(BOARD_KEY, event.target.value);
            setBoard(null);
            setLoading(true);
            setBoardId(event.target.value);
          }}
        >
          {boards.map((entry) => (
            <option key={entry.publicId} value={entry.publicId}>{entry.name}</option>
          ))}
        </select>
        <button
          type="button"
          className={`${styles.button} ${styles.iconButton}`}
          onClick={refreshBoard}
          title={t("kanban.refresh")}
          aria-label={t("kanban.refresh")}
        >
          ↻
        </button>
      </div>

      {error && (
        <div className={`${styles.message} ${styles.error}`}>
          {error}{" "}
          <button type="button" className={styles.button} onClick={() => setReloadKey((n) => n + 1)}>
            {t("kanban.retry")}
          </button>
        </div>
      )}
      {!error && loading && !board && <div className={styles.message}>{t("kanban.loading")}</div>}
      {!error && !loading && !board && boards.length === 0 && <div className={styles.message}>{t("kanban.noBoards")}</div>}

      {board && (
        <>
          <div className={styles.switcher} role="tablist" aria-label={t("kanban.lists")}>
            {board.lists.map((list) => (
              <button
                key={list.publicId}
                type="button"
                role="tab"
                aria-selected={list.publicId === activeList?.publicId}
                className={`${styles.switcherTab} ${list.publicId === activeList?.publicId ? styles.switcherTabActive : ""}`}
                onClick={() => setActiveListId(list.publicId)}
              >
                {list.name} · {list.cards.length}
              </button>
            ))}
          </div>
          <div className={styles.columns}>
            {board.lists.map((list) => (
              <section
                key={list.publicId}
                className={`${styles.column} ${list.publicId === activeList?.publicId ? styles.columnActive : ""}`}
              >
                <header className={styles.columnHeader}>
                  <span>{list.name}</span>
                  <span className={styles.count}>{list.cards.length}</span>
                </header>
                <div className={styles.cards}>
                  {list.cards.length === 0 && <div className={styles.empty}>{t("kanban.emptyList")}</div>}
                  {list.cards.map((card) => (
                    <button key={card.publicId} type="button" className={styles.card} onClick={() => setOpenCardId(card.publicId)}>
                      <span className={styles.cardTitle}>{card.title}</span>
                      {(card.labels.length > 0 || card.checklistTotal > 0) && (
                        <span className={styles.cardMeta}>
                          <LabelChips labels={card.labels} />
                          {card.checklistTotal > 0 && (
                            <span className={styles.progress}>
                              ☑ {t("kanban.checklistProgress", { done: card.checklistDone, total: card.checklistTotal })}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {openCardId && (
        <CardSheet cardId={openCardId} onClose={closeCard} onChanged={refreshBoard} onOpenAgent={props.onOpenAgent} />
      )}
    </div>
  );
}
