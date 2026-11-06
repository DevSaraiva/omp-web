"use client";

import { useCallback, useEffect, useState } from "react";
import { herdrAgentForest, type HerdrAgentNode, type HerdrMachine, type HerdrPane, type HerdrStatus } from "@/lib/herdr-tree";
import type { SessionInfo } from "@/lib/types";

const POLL_MS = 3000;
const COLLAPSE_KEY = "omp-web:herdr-collapsed";

const STATUS_COLOR: Record<HerdrStatus, string> = {
  working: "var(--accent)",
  blocked: "#f59e0b",
  done: "#22c55e",
  idle: "var(--text-dim)",
  unknown: "var(--text-dim)",
};

const STATUS_LABEL: Record<HerdrStatus, string> = {
  working: "working",
  blocked: "needs approval",
  done: "done",
  idle: "idle",
  unknown: "",
};

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? { ...parsed } : {};
  } catch {
    return {};
  }
}

function Dot({ status }: { status: HerdrStatus }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: STATUS_COLOR[status],
        boxShadow: status === "working" ? "0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent)" : undefined,
      }}
    />
  );
}

const rowStyle = (depth: number, selected: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 30,
  padding: `4px 10px 4px ${10 + depth * 14}px`, border: "none", borderRadius: 7,
  background: selected ? "var(--bg-hover)" : "none", color: "var(--text)", cursor: "pointer",
  fontSize: 13, textAlign: "left", overflow: "hidden",
});

/** Name for an agent row: its Herdr pane label (minus a "sub:" prefix), else its terminal title. */
function agentLabel(pane: HerdrPane): string {
  return pane.label?.replace(/^sub:\s*/, "") || pane.title.replace(/^π\s*\S\s*/, "");
}

/**
 * Mirrors the user's Herdr layout (machines, workspaces, tabs, agents) above the
 * project list. Selecting an agent opens its omp session; input to it goes through
 * Herdr (see ChatWindow's Herdr mode), so the terminal and the browser stay one session.
 */
export function HerdrPanel(props: {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo) => void;
}) {
  const { selectedSessionId, onSelectSession } = props;
  const [machines, setMachines] = useState<HerdrMachine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => { setCollapsed(loadCollapsed()); }, []);

  const toggle = useCallback((key: string, defaultCollapsed = false) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !(prev[key] ?? defaultCollapsed) };
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/herdr");
          const data: unknown = await res.json();
          if (!stopped && data && typeof data === "object") {
            if ("machines" in data && Array.isArray(data.machines)) {
              setMachines(data.machines);
              setError(null);
            } else if ("error" in data) {
              setError(String(data.error));
            }
          }
        } catch (e) {
          if (!stopped) setError(e instanceof Error ? e.message : String(e));
        }
      }
      if (!stopped) timer = setTimeout(load, POLL_MS);
    };
    void load();
    const onVisible = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void load(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const open = (pane: HerdrPane) => { if (pane.session) onSelectSession(pane.session); };

  const paneRow = (pane: HerdrPane, label: string, depth: number, machineLocal: boolean, isSubagent = false) => {
    const selectable = machineLocal && !!pane.session;
    return (
      <button
        key={pane.paneId}
        type="button"
        onClick={() => open(pane)}
        disabled={!selectable}
        title={selectable
          ? `${pane.title || label} (${STATUS_LABEL[pane.status] || pane.status})`
          : machineLocal ? "No omp session for this pane yet" : "Sessions on other machines open in their own omp-web"}
        style={{ ...rowStyle(depth, selectable && pane.sessionId === selectedSessionId), opacity: selectable ? 1 : 0.55, cursor: selectable ? "pointer" : "default" }}
      >
        {isSubagent && <span aria-label="subagent" style={{ color: "var(--text-dim)", fontSize: 12, flexShrink: 0 }}>↳</span>}
        <Dot status={pane.status} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {pane.status === "blocked" && <span style={{ fontSize: 11, color: STATUS_COLOR.blocked }}>approve</span>}
      </button>
    );
  };

  if (!machines && !error) return null;
  const multipleMachines = (machines?.length ?? 0) > 1;

  return (
    <div style={{ padding: "6px 6px 4px", borderBottom: "1px solid var(--border)", flexShrink: 0, maxHeight: "45%", overflowY: "auto" }}>
      <button type="button" onClick={() => toggle("__root")} style={{ ...rowStyle(0, false), color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        <span style={{ width: 10 }}>{collapsed.__root ? "▸" : "▾"}</span>Herdr
      </button>
      {error && !collapsed.__root && <div style={{ padding: "4px 12px", fontSize: 12, color: "var(--text-muted)" }}>Herdr unavailable: {error}</div>}
      {!collapsed.__root && machines?.map((machine) => (
        <div key={machine.id}>
          {multipleMachines && (
            <button type="button" onClick={() => toggle(`m:${machine.id}`)} style={{ ...rowStyle(0, false), fontWeight: 600 }}>
              <span style={{ width: 10, color: "var(--text-muted)" }}>{collapsed[`m:${machine.id}`] ? "▸" : "▾"}</span>
              {machine.label}
              {!machine.reachable && <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>offline</span>}
            </button>
          )}
          {!collapsed[`m:${machine.id}`] && machine.workspaces.map((ws) => {
            const wsKey = `w:${machine.id}:${ws.id}`;
            const depth = multipleMachines ? 1 : 0;
            return (
              <div key={ws.id}>
                <button type="button" onClick={() => toggle(wsKey)} style={rowStyle(depth, false)}>
                  <span style={{ width: 10, color: "var(--text-muted)" }}>{collapsed[wsKey] ? "▸" : "▾"}</span>
                  <Dot status={ws.status} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ws.label}</span>
                </button>
                {!collapsed[wsKey] && ws.tabs.map((tab) => {
                  // Subagents sit under the agent that started them, one level deeper per generation.
                  const rows = (node: HerdrAgentNode, label: string, rowDepth: number, isSubagent: boolean): React.ReactNode[] => [
                    paneRow(node.pane, label, rowDepth, machine.local, isSubagent),
                    ...node.children.flatMap((child) => rows(child, agentLabel(child.pane) || "subagent", rowDepth + 1, true)),
                  ];
                  const forest = herdrAgentForest(tab);
                  // A tab with one top-level agent is that agent; with several, each is listed under the tab.
                  if (forest.length === 1) return <div key={tab.id}>{rows(forest[0], tab.label, depth + 1, false)}</div>;
                  return (
                    <div key={tab.id}>
                      <div style={{ ...rowStyle(depth + 1, false), cursor: "default", color: forest.length ? "var(--text)" : "var(--text-muted)" }}>
                        <Dot status={tab.status} />
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.label}</span>
                      </div>
                      {forest.flatMap((node, i) => rows(node, agentLabel(node.pane) || `agent ${i + 1}`, depth + 2, false))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
