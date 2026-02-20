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
  assert.match(stderr.text(), /skill-install \[PATH]/);
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
