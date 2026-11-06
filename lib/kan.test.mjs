import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { resolveKanConfig, KanNotConfiguredError } = await jiti.import("./kan.ts");
const { buildKanTaskText, pickDefaultHerdrWorkspace } = await jiti.import("./kan-types.ts");

const claudeConfig = {
  mcpServers: { kan: { env: { KAN_BASE_URL: "http://file.example:3000/", KAN_API_TOKEN: "file-token" } } },
};

test("environment wins over the Kan MCP server config and trailing slashes are trimmed", () => {
  const config = resolveKanConfig(
    { KAN_BASE_URL: "http://env.example/", KAN_API_TOKEN: "env-token" },
    () => claudeConfig,
  );
  assert.deepEqual(config, { baseUrl: "http://env.example", apiToken: "env-token" });
});

test("falls back to ~/.claude.json when the environment is absent", () => {
  assert.deepEqual(resolveKanConfig({}, () => claudeConfig), {
    baseUrl: "http://file.example:3000",
    apiToken: "file-token",
  });
});

test("a half-set environment is not mixed with the file: a token is never paired with a foreign URL", () => {
  const config = resolveKanConfig({ KAN_BASE_URL: "http://env.example" }, () => claudeConfig);
  assert.deepEqual(config, { baseUrl: "http://file.example:3000", apiToken: "file-token" });
});

test("missing or unreadable config raises the not-configured error", () => {
  assert.throws(() => resolveKanConfig({}, () => ({ mcpServers: {} })), KanNotConfiguredError);
  assert.throws(() => resolveKanConfig({}, () => { throw new Error("ENOENT"); }), KanNotConfiguredError);
  assert.throws(
    () => resolveKanConfig({}, () => ({ mcpServers: { kan: { env: { KAN_BASE_URL: "http://x" } } } })),
    KanNotConfiguredError,
  );
});

test("task text carries title, description and only the unchecked checklist items", () => {
  const text = buildKanTaskText({
    title: " SHARE-1 Create a share link ",
    description: "As a rider I want a link.",
    checklists: [
      {
        name: "Acceptance criteria",
        items: [
          { title: "Dialog explains visibility", completed: false },
          { title: "Token is 128-bit", completed: true },
          { title: "Create endpoint checks owner", completed: false },
        ],
      },
      { name: "Done already", items: [{ title: "All finished", completed: true }] },
    ],
  });
  assert.equal(
    text,
    [
      "SHARE-1 Create a share link",
      "As a rider I want a link.",
      "Open checklist items\nAcceptance criteria:\n- [ ] Dialog explains visibility\n- [ ] Create endpoint checks owner",
    ].join("\n\n"),
  );
});

test("task text is just the title for a bare card", () => {
  assert.equal(buildKanTaskText({ title: "Fix it", description: "  ", checklists: [] }), "Fix it");
});

test("default Herdr workspace: local, matches the repo folder, prefers the playbook's kind of work", () => {
  const machines = [
    {
      id: "local", label: "Mac", local: true,
      workspaces: [
        { id: "w1", label: "omp-web" },
        { id: "w2", label: "2bikefit - Marketing" },
        { id: "w3", label: "2bikefit - Software" },
      ],
    },
    { id: "pi", label: "Pi", local: false, workspaces: [{ id: "w9", label: "other - Software" }] },
  ];
  assert.equal(pickDefaultHerdrWorkspace(machines, "/Users/me/code/2bikefit", "software"), "w3");
  assert.equal(pickDefaultHerdrWorkspace(machines, "/Users/me/code/2bikefit", "ads"), "w2");
  assert.equal(pickDefaultHerdrWorkspace(machines, "/Users/me/code/2bikefit", "sports"), "w2");
  assert.equal(pickDefaultHerdrWorkspace(machines, "/Users/me/code/omp-web/"), "w1");
  assert.equal(pickDefaultHerdrWorkspace(machines, "/Users/me/code/other", "software"), undefined);
  assert.equal(pickDefaultHerdrWorkspace(machines, ""), undefined);
});
