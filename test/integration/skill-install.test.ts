import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";

import { installSkill } from "../../src/install/install.js";
import { collectSkillEntries, createTarStream } from "../../src/core/tar.js";
import { makeTempDir, writeFile } from "../helpers/tmp.js";

async function bufferFromStream(
  stream: NodeJS.ReadableStream,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function initGit(repoDir: string): void {
  execFileSync("git", ["init"], { cwd: repoDir });
}

test("install from directory into codex repo scope", async (t) => {
  const repo = await makeTempDir("skill-install-repo-");
  const skill = await makeTempDir("skill-install-skill-");
  t.after(async () => {
    await repo.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: demo-skill\ndescription: Demo\n---\n",
  );
  await writeFile(skill.dir, "templates/hello.txt", "hello\n");

  const result = await installSkill(
    { kind: "dir", dir: skill.dir },
    { agent: "codex", scope: "repo", cwd: repo.dir, force: false },
  );

  const expected = path.join(repo.dir, ".codex/skills/demo-skill");
  const expectedReal = await fs.realpath(expected);
  const actualReal = await fs.realpath(result.installedTo);
  assert.equal(actualReal, expectedReal);
  const skillMd = await fs.readFile(path.join(expected, "SKILL.md"), "utf8");
  assert.match(skillMd, /demo-skill/);
});

test("install from tar stream into claude repo scope", async (t) => {
  const repo = await makeTempDir("skill-install-repo-");
  const skill = await makeTempDir("skill-install-skill-");
  t.after(async () => {
    await repo.cleanup();
    await skill.cleanup();
  });

  initGit(repo.dir);

  await writeFile(
    skill.dir,
    "SKILL.md",
    "---\nname: tar-skill\ndescription: Demo\n---\n",
  );
  await writeFile(skill.dir, "templates/hi.txt", "hi\n");

  const { entries } = await collectSkillEntries(skill.dir, "tar-skill");
  const tarBuffer = await bufferFromStream(createTarStream(entries));

  const result = await installSkill(
    { kind: "tar", stream: Readable.from(tarBuffer) },
    { agent: "claude", scope: "repo", cwd: repo.dir, force: false },
  );

  const expected = path.join(repo.dir, ".claude/skills/tar-skill");
  const expectedReal = await fs.realpath(expected);
  const actualReal = await fs.realpath(result.installedTo);
  assert.equal(actualReal, expectedReal);
  const skillMd = await fs.readFile(path.join(expected, "SKILL.md"), "utf8");
  assert.match(skillMd, /tar-skill/);
});
