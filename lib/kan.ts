import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  KanBoard,
  KanBoardSummary,
  KanCardDetail,
  KanChecklist,
  KanComment,
  KanLabel,
  KanWorkspace,
} from "./kan-types";

/**
 * Server-side Kan client. The token never leaves this module: routes return
 * the lean shapes from `kan-types.ts`, never raw Kan payloads.
 */

export interface KanConfig {
  baseUrl: string;
  apiToken: string;
}

type Env = Record<string, string | undefined>;

export class KanNotConfiguredError extends Error {
  constructor() {
    super(
      "Kan is not configured. Set KAN_BASE_URL and KAN_API_TOKEN, or add a \"kan\" server with those env vars to the MCP servers in ~/.claude.json.",
    );
    this.name = "KanNotConfiguredError";
  }
}

export class KanApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "KanApiError";
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function configFromPair(url: unknown, token: unknown): KanConfig | undefined {
  const baseUrl = nonEmpty(url);
  const apiToken = nonEmpty(token);
  return baseUrl && apiToken ? { baseUrl: baseUrl.replace(/\/+$/, ""), apiToken } : undefined;
}

/**
 * Environment first, then the Kan MCP server the user's agents already use.
 * The two sources are never mixed field by field: a URL from one with a token
 * from the other would send a credential to a host it was not issued for.
 */
export function resolveKanConfig(env: Env, readClaudeConfig: () => unknown): KanConfig {
  const fromEnv = configFromPair(env.KAN_BASE_URL, env.KAN_API_TOKEN);
  if (fromEnv) return fromEnv;

  let claudeConfig: unknown;
  try {
    claudeConfig = readClaudeConfig();
  } catch {
    claudeConfig = undefined;
  }
  const servers = (claudeConfig as { mcpServers?: Record<string, { env?: Env }> } | undefined)?.mcpServers;
  const kanEnv = servers?.kan?.env;
  const fromFile = configFromPair(kanEnv?.KAN_BASE_URL, kanEnv?.KAN_API_TOKEN);
  if (fromFile) return fromFile;

  throw new KanNotConfiguredError();
}

function readClaudeJson(): unknown {
  return JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
}

async function kanRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const config = resolveKanConfig(process.env, readClaudeJson);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new KanApiError(502, `Could not reach Kan: ${error instanceof Error ? error.message : String(error)}`);
  }

  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const data: unknown = isJson ? await response.json().catch(() => undefined) : await response.text();
  if (!response.ok) {
    const message = (data as { message?: unknown } | undefined)?.message;
    throw new KanApiError(
      response.status,
      typeof message === "string" && message ? message : `Kan answered ${response.status}`,
    );
  }
  return data as T;
}

interface RawLabel {
  publicId: string;
  name: string;
  colourCode?: string | null;
}

interface RawChecklist {
  publicId: string;
  name: string;
  items?: { publicId: string; title: string; completed: boolean }[];
}

function toLabels(labels: RawLabel[] | undefined): KanLabel[] {
  return (labels ?? []).map((label) => ({
    publicId: label.publicId,
    name: label.name,
    colourCode: label.colourCode || "#64748b",
  }));
}

function toChecklists(checklists: RawChecklist[] | undefined): KanChecklist[] {
  return (checklists ?? []).map((checklist) => ({
    publicId: checklist.publicId,
    name: checklist.name,
    items: (checklist.items ?? []).map((item) => ({
      publicId: item.publicId,
      title: item.title,
      completed: Boolean(item.completed),
    })),
  }));
}

export async function listKanWorkspaces(): Promise<KanWorkspace[]> {
  const memberships = await kanRequest<{ workspace: KanWorkspace }[]>("GET", "/workspaces");
  return memberships.map(({ workspace }) => ({ publicId: workspace.publicId, name: workspace.name }));
}

export async function listKanBoards(workspaceId: string): Promise<KanBoardSummary[]> {
  const boards = await kanRequest<KanBoardSummary[]>("GET", `/workspaces/${workspaceId}/boards`);
  return boards.map((board) => ({ publicId: board.publicId, name: board.name }));
}

interface RawBoard {
  publicId: string;
  name: string;
  lists: {
    publicId: string;
    name: string;
    index: number;
    cards?: {
      publicId: string;
      title: string;
      cardNumber?: number | null;
      index: number;
      labels?: RawLabel[];
      checklists?: RawChecklist[];
    }[];
  }[];
}

export async function getKanBoard(boardId: string): Promise<KanBoard> {
  const board = await kanRequest<RawBoard>("GET", `/boards/${boardId}`);
  return {
    publicId: board.publicId,
    name: board.name,
    lists: [...board.lists]
      .sort((a, b) => a.index - b.index)
      .map((list) => ({
        publicId: list.publicId,
        name: list.name,
        cards: [...(list.cards ?? [])]
          .sort((a, b) => a.index - b.index)
          .map((card) => {
            const items = (card.checklists ?? []).flatMap((checklist) => checklist.items ?? []);
            return {
              publicId: card.publicId,
              title: card.title,
              cardNumber: card.cardNumber ?? null,
              labels: toLabels(card.labels),
              checklistDone: items.filter((item) => item.completed).length,
              checklistTotal: items.length,
            };
          }),
      })),
  };
}

interface RawActivity {
  createdAt: string;
  user?: { name?: string | null; email?: string | null } | null;
  comment?: {
    publicId: string;
    comment: string;
    deletedAt?: string | null;
  } | null;
}

interface RawCard {
  publicId: string;
  title: string;
  description?: string | null;
  cardNumber?: number | null;
  labels?: RawLabel[];
  checklists?: RawChecklist[];
  list: { publicId: string; name: string; board?: { lists?: { publicId: string; name: string }[] } };
  activities?: RawActivity[];
}

/** Kan exposes comments only through the activity log; keep the live ones, oldest first. */
function commentsFromActivities(activities: RawActivity[] | undefined): KanComment[] {
  const byId = new Map<string, KanComment>();
  for (const activity of activities ?? []) {
    const comment = activity.comment;
    if (!comment || comment.deletedAt) continue;
    byId.set(comment.publicId, {
      publicId: comment.publicId,
      comment: comment.comment,
      author: activity.user?.name || activity.user?.email || null,
      createdAt: activity.createdAt,
    });
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function toCardDetail(card: RawCard): KanCardDetail {
  return {
    publicId: card.publicId,
    title: card.title,
    description: card.description ?? "",
    cardNumber: card.cardNumber ?? null,
    labels: toLabels(card.labels),
    checklists: toChecklists(card.checklists),
    comments: commentsFromActivities(card.activities),
    list: { publicId: card.list.publicId, name: card.list.name },
    lists: (card.list.board?.lists ?? []).map((list) => ({ publicId: list.publicId, name: list.name })),
  };
}

export async function getKanCard(cardId: string): Promise<KanCardDetail> {
  return toCardDetail(await kanRequest<RawCard>("GET", `/cards/${cardId}`));
}

export interface KanCardUpdate {
  title?: string;
  description?: string;
  listPublicId?: string;
}

export async function updateKanCard(cardId: string, update: KanCardUpdate): Promise<void> {
  await kanRequest("PUT", `/cards/${cardId}`, update);
}

export async function addKanCardComment(cardId: string, comment: string): Promise<void> {
  await kanRequest("POST", `/cards/${cardId}/comments`, { comment });
}
