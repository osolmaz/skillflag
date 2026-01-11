import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import { resolveSkillsRoot } from "../../src/install/resolve.js";

const cwd = "/tmp/skillflag-install";

test("resolve portable repo/user roots", () => {
  const repoRoot = resolveSkillsRoot("portable", "repo", cwd);
  assert.equal(repoRoot, path.join(cwd, ".agents/skills"));

  const prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/tmp/xdg";
  const userRoot = resolveSkillsRoot("portable", "user", cwd);
  assert.equal(userRoot, path.join("/tmp/xdg", "agents/skills"));
  process.env.XDG_CONFIG_HOME = prevXdg;
});

test("resolve vscode/copilot repo roots", () => {
  const vscodeRoot = resolveSkillsRoot("vscode", "repo", cwd);
  assert.equal(vscodeRoot, path.join(cwd, ".github/skills"));

  const copilotRoot = resolveSkillsRoot("copilot", "repo", cwd);
  assert.equal(copilotRoot, path.join(cwd, ".github/skills"));
});

test("resolve amp/goose repo roots", () => {
  const ampRoot = resolveSkillsRoot("amp", "repo", cwd);
  assert.equal(ampRoot, path.join(cwd, ".agents/skills"));

  const gooseRoot = resolveSkillsRoot("goose", "repo", cwd);
  assert.equal(gooseRoot, path.join(cwd, ".agents/skills"));
});

test("resolve opencode repo/user roots", () => {
  const repoRoot = resolveSkillsRoot("opencode", "repo", cwd);
  assert.equal(repoRoot, path.join(cwd, ".opencode/skill"));

  const prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/tmp/xdg";
  const userRoot = resolveSkillsRoot("opencode", "user", cwd);
  assert.equal(userRoot, path.join("/tmp/xdg", "opencode/skill"));
  process.env.XDG_CONFIG_HOME = prevXdg;
});

test("resolve factory repo/user roots", () => {
  const repoRoot = resolveSkillsRoot("factory", "repo", cwd);
  assert.equal(repoRoot, path.join(cwd, ".factory/skills"));

  const userRoot = resolveSkillsRoot("factory", "user", cwd);
  assert.equal(userRoot, path.join(os.homedir(), ".factory/skills"));
});

test("resolve cursor repo root", () => {
  const repoRoot = resolveSkillsRoot("cursor", "repo", cwd);
  assert.equal(repoRoot, path.join(cwd, ".cursor/skills"));
});
