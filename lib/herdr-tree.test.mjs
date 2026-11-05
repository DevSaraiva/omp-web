import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./herdr-tree.ts");
}

const workspaces = {
  workspaces: [
    { workspace_id: "w4", label: "bikefit - Software", number: 2, agent_status: "idle" },
    { workspace_id: "w3", label: "Marketing", number: 1, agent_status: "working" },
  ],
};
const tabs = {
  tabs: [
    { tab_id: "w4:t7", workspace_id: "w4", label: "change llM", number: 7, agent_status: "idle" },
    { tab_id: "w4:t3", workspace_id: "w4", label: "Front View", number: 3, agent_status: "blocked" },
    { tab_id: "w3:t1", workspace_id: "w3", label: "Exploration", number: 1, agent_status: "working" },
  ],
};
const panes = {
  panes: [
    {
      pane_id: "w4:p6", tab_id: "w4:t3", agent: "omp", agent_status: "blocked",
      agent_session: { agent: "omp", kind: "path", value: "/Users/me/.omp/agent/sessions/-x/a.jsonl" },
      terminal_title_stripped: "π > FRONT", cwd: "/repo", foreground_cwd: "/repo/wt", focused: false,
    },
    { pane_id: "w4:p7", tab_id: "w4:t3", agent_status: "unknown", cwd: "/repo" },
    { pane_id: "w3:p3", tab_id: "w3:t1", agent: "omp", agent_status: "sleeping", agent_session: { kind: "id", value: "abc" } },
  ],
};

test("orders workspaces and tabs the way Herdr numbers them and groups panes under their tab", async () => {
  const { buildHerdrMachine } = await loadSubject();
  const machine = buildHerdrMachine({ id: "local", label: "Mac", local: true }, workspaces, tabs, panes);

  assert.deepEqual(machine.workspaces.map((w) => w.label), ["Marketing", "bikefit - Software"]);
  assert.deepEqual(machine.workspaces[1].tabs.map((t) => t.label), ["Front View", "change llM"]);
  assert.deepEqual(machine.workspaces[1].tabs[0].panes.map((p) => p.paneId), ["w4:p6", "w4:p7"]);
  assert.deepEqual(machine.workspaces[1].tabs[1].panes, []);
});

test("keeps only path-backed sessions and maps unknown statuses to unknown", async () => {
  const { buildHerdrMachine } = await loadSubject();
  const machine = buildHerdrMachine({ id: "local", label: "Mac", local: true }, workspaces, tabs, panes);
  const [front] = machine.workspaces[1].tabs[0].panes;
  const [exploration] = machine.workspaces[0].tabs[0].panes;

  assert.equal(front.sessionPath, "/Users/me/.omp/agent/sessions/-x/a.jsonl");
  assert.equal(front.status, "blocked");
  assert.equal(front.cwd, "/repo/wt");
  assert.equal(exploration.sessionPath, null);
  assert.equal(exploration.status, "unknown");
  assert.equal(machine.workspaces[1].tabs[0].panes[1].agent, null);
});

test("parses saved machines with their enabled flag", async () => {
  const { parseHerdrMachineList } = await loadSubject();
  const list = parseHerdrMachineList(
    "e54e\tpi\tme@100.85.32.97\tdefault\tenabled\nf00d\tmini\tme@mini\tdefault\tdisabled\n\n",
  );

  assert.deepEqual(list, [
    { id: "e54e", label: "pi", target: "me@100.85.32.97", enabled: true },
    { id: "f00d", label: "mini", target: "me@mini", enabled: false },
  ]);
});
