import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";

import { runInstallCli } from "../../src/install/cli.js";
import { createCapture } from "../helpers/capture.js";
import { makeTempDir, writeFile } from "../helpers/tmp.js";

function initGit(repoDir: string): void {
  execFileSync("git", ["init"], { cwd: repoDir });
}

test("runInstallCli requires flags without an interactive tty", async () => {
  const stderr = createCapture();

  const exitCode = await runInstallCli(["node", "skill-install"], {
    stdin: Readable.from([]),
    stderr: stderr.stream,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.text(), /Missing required flags/);
  assert.match(stderr.text(), /skill-install \[PATH/);
});

test("runInstallCli keeps non-interactive install behavior with flags", async (t) => {
  const repo = await makeTempDir("skill-install-cli-repo-");
  const skill = await makeTempDir("skill-install-cli-skill-");
  t.after(async () => {
    await repo.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill\ndescription: CLI test skill\n---\n",
  );
  await writeFile(skill.dir, "templates/readme.txt", "hello\n");

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    ["node", "skill-install", skill.dir, "--agent", "codex", "--scope", "repo"],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 0);
  assert.match(stderr.text(), /Installed cli-skill to/);

  const installedSkill = path.join(
    repo.dir,
    ".codex/skills/cli-skill/SKILL.md",
  );
  const installedContent = await fs.readFile(installedSkill, "utf8");
  assert.match(installedContent, /name: cli-skill/);
});

test("runInstallCli installs multiple skills across repeated scopes", async (t) => {
  const repo = await makeTempDir("skill-install-cli-multi-repo-");
  const codexHome = await makeTempDir("skill-install-cli-multi-codex-home-");
  const skillOne = await makeTempDir("skill-install-cli-skill-one-");
  const skillTwo = await makeTempDir("skill-install-cli-skill-two-");
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome.dir;
  t.after(async () => {
    process.env.CODEX_HOME = previousCodexHome;
    await repo.cleanup();
    await codexHome.cleanup();
    await skillOne.cleanup();
    await skillTwo.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skillOne.dir,
    "SKILL.md",
    "---\nname: cli-skill-one\ndescription: CLI multi test skill one\n---\n",
  );
  await writeFile(
    skillTwo.dir,
    "SKILL.md",
    "---\nname: cli-skill-two\ndescription: CLI multi test skill two\n---\n",
  );

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    [
      "node",
      "skill-install",
      skillOne.dir,
      skillTwo.dir,
      "--agent",
      "codex",
      "--scope",
      "repo",
      "--scope",
      "user",
    ],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 0);
  assert.match(stderr.text(), /Installed cli-skill-one to/);
  assert.match(stderr.text(), /Installed cli-skill-two to/);

  await fs.access(path.join(repo.dir, ".codex/skills/cli-skill-one/SKILL.md"));
  await fs.access(path.join(repo.dir, ".codex/skills/cli-skill-two/SKILL.md"));
  await fs.access(path.join(codexHome.dir, "skills/cli-skill-one/SKILL.md"));
  await fs.access(path.join(codexHome.dir, "skills/cli-skill-two/SKILL.md"));
});

test("runInstallCli accepts comma-separated scopes", async (t) => {
  const repo = await makeTempDir("skill-install-cli-comma-repo-");
  const codexHome = await makeTempDir("skill-install-cli-comma-codex-home-");
  const skill = await makeTempDir("skill-install-cli-comma-skill-");
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome.dir;
  t.after(async () => {
    process.env.CODEX_HOME = previousCodexHome;
    await repo.cleanup();
    await codexHome.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill-comma\ndescription: CLI comma scope skill\n---\n",
  );

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    [
      "node",
      "skill-install",
      skill.dir,
      "--agent",
      "codex",
      "--scope",
      "repo,user",
    ],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 0);
  assert.match(stderr.text(), /Installed cli-skill-comma to/);

  await fs.access(
    path.join(repo.dir, ".codex/skills/cli-skill-comma/SKILL.md"),
  );
  await fs.access(path.join(codexHome.dir, "skills/cli-skill-comma/SKILL.md"));
});

test("runInstallCli supports repeated --agent and installs matrix combinations", async (t) => {
  const repo = await makeTempDir("skill-install-cli-agents-repo-");
  const codexHome = await makeTempDir("skill-install-cli-agents-codex-home-");
  const home = await makeTempDir("skill-install-cli-agents-home-");
  const skill = await makeTempDir("skill-install-cli-agents-skill-");
  const previousCodexHome = process.env.CODEX_HOME;
  const previousHome = process.env.HOME;
  process.env.CODEX_HOME = codexHome.dir;
  process.env.HOME = home.dir;
  t.after(async () => {
    process.env.CODEX_HOME = previousCodexHome;
    process.env.HOME = previousHome;
    await repo.cleanup();
    await codexHome.cleanup();
    await home.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill-agents\ndescription: CLI multi-agent test skill\n---\n",
  );

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    [
      "node",
      "skill-install",
      skill.dir,
      "--agent",
      "codex",
      "--agent",
      "claude",
      "--scope",
      "repo",
      "--scope",
      "user",
    ],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 0);
  const installLines = stderr
    .text()
    .split("\n")
    .filter((line) => line.startsWith("Installed "));
  assert.equal(installLines.length, 4);

  await fs.access(
    path.join(repo.dir, ".codex/skills/cli-skill-agents/SKILL.md"),
  );
  await fs.access(
    path.join(repo.dir, ".claude/skills/cli-skill-agents/SKILL.md"),
  );
  await fs.access(path.join(codexHome.dir, "skills/cli-skill-agents/SKILL.md"));
  await fs.access(
    path.join(home.dir, ".claude/skills/cli-skill-agents/SKILL.md"),
  );
});

test("runInstallCli handles multi-agent installs when agents share a destination", async (t) => {
  const repo = await makeTempDir("skill-install-cli-shared-dest-repo-");
  const skill = await makeTempDir("skill-install-cli-shared-dest-skill-");
  t.after(async () => {
    await repo.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: cli-skill-shared\ndescription: CLI shared destination test skill\n---\n",
  );

  const stderr = createCapture();
  const exitCode = await runInstallCli(
    [
      "node",
      "skill-install",
      skill.dir,
      "--agent",
      "portable",
      "--agent",
      "amp",
      "--scope",
      "repo",
    ],
    {
      stdin: Readable.from([]),
      stderr: stderr.stream,
      cwd: repo.dir,
    },
  );

  assert.equal(exitCode, 0);
  assert.match(stderr.text(), /Installed cli-skill-shared to/);
  await fs.access(
    path.join(repo.dir, ".agents/skills/cli-skill-shared/SKILL.md"),
  );
});
