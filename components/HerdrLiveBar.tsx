"use client";

import { useEffect, useState } from "react";
import type { HerdrLiveInfo } from "@/lib/herdr-tree";

const STATUS_TEXT: Record<HerdrLiveInfo["status"], string> = {
  working: "working",
  blocked: "waiting for approval",
  done: "done",
  idle: "idle",
  unknown: "",
};

const buttonStyle: React.CSSProperties = {
  height: 26, padding: "0 9px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)",
  color: "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)", cursor: "pointer", flexShrink: 0,
};

/**
 * Shown above the composer when the session runs in a Herdr pane. Messages typed in
 * omp-web go to that pane; the terminal view and its keys answer the TUI's own
 * prompts (approvals, pickers) that the browser transcript cannot show.
 */
export function HerdrLiveBar(props: {
  live: HerdrLiveInfo;
  sessionId: string;
  onKeys: (keys: string[]) => Promise<boolean>;
}) {
  const { live, sessionId, onKeys } = props;
  const [terminalOpen, setTerminalOpen] = useState(live.status === "blocked");
  const [screen, setScreen] = useState<string | null>(null);

  useEffect(() => { if (live.status === "blocked") setTerminalOpen(true); }, [live.status]);

  useEffect(() => {
    if (!terminalOpen) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await fetch(`/api/herdr/session/${encodeURIComponent(sessionId)}?screen=1`);
        const body: unknown = await res.json();
        if (!stopped && body && typeof body === "object" && "screen" in body && typeof body.screen === "string") setScreen(body.screen);
      } catch {
        // keep the last screen
      }
      if (!stopped) timer = setTimeout(load, 1500);
    };
    void load();
    return () => { stopped = true; clearTimeout(timer); };
  }, [terminalOpen, sessionId]);

  const key = (keys: string[]) => () => { void onKeys(keys); };

  return (
    <div style={{ margin: "0 12px 6px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-panel)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", flexWrap: "wrap" }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: live.status === "working" ? "var(--accent)" : live.status === "blocked" ? "#f59e0b" : "var(--text-dim)",
        }} />
        <span style={{ flex: 1, minWidth: 140, fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Herdr · {live.workspaceLabel} / {live.tabLabel}{STATUS_TEXT[live.status] ? ` · ${STATUS_TEXT[live.status]}` : ""}
        </span>
        <button type="button" style={buttonStyle} onClick={() => setTerminalOpen((v) => !v)}>
          {terminalOpen ? "Hide terminal" : "Terminal"}
        </button>
      </div>
      {terminalOpen && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <pre style={{
            margin: 0, padding: "8px 10px", maxHeight: 260, overflow: "auto", fontSize: 11, lineHeight: 1.35,
            fontFamily: "var(--font-mono)", color: "var(--text)", background: "var(--bg)", whiteSpace: "pre",
          }}>
            {screen ?? "Loading…"}
          </pre>
          <div style={{ display: "flex", gap: 6, padding: "6px 8px", flexWrap: "wrap" }}>
            <button type="button" style={buttonStyle} onClick={key(["up"])} aria-label="Up">↑</button>
            <button type="button" style={buttonStyle} onClick={key(["down"])} aria-label="Down">↓</button>
            <button type="button" style={buttonStyle} onClick={key(["enter"])}>Enter</button>
            <button type="button" style={buttonStyle} onClick={key(["tab"])}>Tab</button>
            <button type="button" style={buttonStyle} onClick={key(["esc"])}>Esc</button>
            <button type="button" style={buttonStyle} onClick={key(["y"])}>y</button>
            <button type="button" style={buttonStyle} onClick={key(["n"])}>n</button>
          </div>
        </div>
      )}
    </div>
  );
}
