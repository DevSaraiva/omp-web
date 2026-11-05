import { NextResponse } from "next/server";
import { getHerdrTree } from "@/lib/herdr";
import { isApiRequestAllowed } from "@/lib/request-security";
import { listAllSessions } from "@/lib/session-reader";
import { sessionPathKey } from "@/lib/session-path";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/herdr - Herdr machines, workspaces, tabs and panes (with omp session ids for local panes)
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  try {
    const machines = await getHerdrTree({ force: new URL(req.url).searchParams.has("force") });
    const byPath = new Map<string, SessionInfo>();
    for (const s of await listAllSessions()) byPath.set(sessionPathKey(s.path), s);
    for (const machine of machines) {
      if (!machine.local) continue;
      for (const ws of machine.workspaces) {
        for (const tab of ws.tabs) {
          for (const pane of tab.panes) {
            const session = pane.sessionPath ? byPath.get(sessionPathKey(pane.sessionPath)) : undefined;
            if (session) { pane.session = session; pane.sessionId = session.id; }
          }
        }
      }
    }
    return NextResponse.json({ machines });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
