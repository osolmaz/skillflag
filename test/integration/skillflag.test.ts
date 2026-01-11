import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import * as tar from "tar-stream";

import { handleSkillflag } from "../../src/core/skillflag.js";
import { createCapture } from "../helpers/capture.js";

const fixturesRoot = path.resolve(process.cwd(), "test/fixtures/skills");
const bundledSkillsRoot = path.resolve(process.cwd(), "skills");

function sha256(buffer: Buffer): string {
  const hash = createHash("sha256");
  hash.update(buffer);
  return `sha256:${hash.digest("hex")}`;
}

async function collectTarEntries(buffer: Buffer): Promise<string[]> {
  const extract = tar.extract();
  const entries: string[] = [];

  return new Promise((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      entries.push(header.name);
      stream.resume();
      stream.on("end", next);
    });

    extract.on("finish", () => resolve(entries));
    extract.on("error", reject);

    extract.end(buffer);
  });
}

type TarHeader = {
  name: string;
  type: string | null | undefined;
  mtime: Date | undefined;
  uid: number | undefined;
  gid: number | undefined;
  uname: string | undefined;
  gname: string | undefined;
};

async function collectTarHeaders(buffer: Buffer): Promise<TarHeader[]> {
  const extract = tar.extract();
  const headers: TarHeader[] = [];

  return new Promise((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      headers.push({
        name: header.name,
        type: header.type,
        mtime: header.mtime instanceof Date ? header.mtime : undefined,
        uid: header.uid,
        gid: header.gid,
        uname: header.uname,
        gname: header.gname,
      });
      stream.resume();
      stream.on("end", next);
    });

    extract.on("finish", () => resolve(headers));
    extract.on("error", reject);

    extract.end(buffer);
  });
}

test("--skill list outputs sorted ids", async () => {
  const stdout = createCapture();
  const stderr = createCapture();

  const exitCode = await handleSkillflag(["node", "cli", "--skill", "list"], {
    skillsRoot: fixturesRoot,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");
  assert.equal(stdout.text(), "alpha\nbeta\n");
});

test("bundled skill is discoverable and exportable", async () => {
  await fs.access(path.join(bundledSkillsRoot, "skillflag/SKILL.md"));

  const listStdout = createCapture();
  const listStderr = createCapture();

  const listExit = await handleSkillflag(["node", "cli", "--skill", "list"], {
    skillsRoot: bundledSkillsRoot,
    stdout: listStdout.stream,
    stderr: listStderr.stream,
  });

  assert.equal(listExit, 0);
  assert.equal(listStderr.text(), "");
  const ids = listStdout
    .text()
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  assert.ok(ids.includes("skillflag"));

  const exportStdout = createCapture();
  const exportStderr = createCapture();
  const exportExit = await handleSkillflag(
    ["node", "cli", "--skill", "export", "skillflag"],
    {
      skillsRoot: bundledSkillsRoot,
      stdout: exportStdout.stream,
      stderr: exportStderr.stream,
    },
  );

  assert.equal(exportExit, 0);
  assert.equal(exportStderr.text(), "");
  const entries = await collectTarEntries(exportStdout.buffer());
  assert.ok(entries.includes("skillflag/SKILL.md"));
});

test("--skill list --json matches export digest", async () => {
  const listStdout = createCapture();
  const listStderr = createCapture();

  const listExit = await handleSkillflag(
    ["node", "cli", "--skill", "list", "--json"],
    {
      skillsRoot: fixturesRoot,
      stdout: listStdout.stream,
      stderr: listStderr.stream,
    },
  );

  assert.equal(listExit, 0);
  assert.equal(listStderr.text(), "");

  const payload = JSON.parse(listStdout.text()) as {
    skillflag_version: string;
    skills: Array<{ id: string; digest: string }>;
  };

  assert.equal(payload.skillflag_version, "0.1");
  assert.equal(payload.skills.length, 2);

  const alpha = payload.skills.find((skill) => skill.id === "alpha");
  assert.ok(alpha?.digest.startsWith("sha256:"));

  const exportStdout = createCapture();
  const exportStderr = createCapture();
  const exportExit = await handleSkillflag(
    ["node", "cli", "--skill", "export", "alpha"],
    {
      skillsRoot: fixturesRoot,
      stdout: exportStdout.stream,
      stderr: exportStderr.stream,
    },
  );

  assert.equal(exportExit, 0);
  assert.equal(exportStderr.text(), "");

  const exportDigest = sha256(exportStdout.buffer());
  assert.equal(alpha?.digest, exportDigest);
});

test("--skill export produces a single top-level dir", async () => {
  const stdout = createCapture();
  const stderr = createCapture();

  const exitCode = await handleSkillflag(
    ["node", "cli", "--skill", "export", "alpha"],
    { skillsRoot: fixturesRoot, stdout: stdout.stream, stderr: stderr.stream },
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");

  const entries = await collectTarEntries(stdout.buffer());
  assert.ok(entries.includes("alpha/"));
  assert.ok(entries.includes("alpha/SKILL.md"));
  assert.ok(entries.every((name) => name.startsWith("alpha/")));
});

test("--skill export tar metadata is normalized and ordered", async () => {
  const stdout = createCapture();
  const stderr = createCapture();

  const exitCode = await handleSkillflag(
    ["node", "cli", "--skill", "export", "alpha"],
    { skillsRoot: fixturesRoot, stdout: stdout.stream, stderr: stderr.stream },
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");

  const headers = await collectTarHeaders(stdout.buffer());
  assert.ok(headers.length > 0);

  const names = headers.map((h) => h.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, sorted);

  for (const header of headers) {
    assert.equal(header.uid, 0);
    assert.equal(header.gid, 0);
    assert.equal(header.uname, "");
    assert.equal(header.gname, "");
    assert.ok(header.mtime instanceof Date);
    assert.equal(header.mtime?.getTime(), 0);
  }
});

test("--skill export missing id returns error", async () => {
  const stdout = createCapture();
  const stderr = createCapture();

  const exitCode = await handleSkillflag(
    ["node", "cli", "--skill", "export", "missing"],
    { skillsRoot: fixturesRoot, stdout: stdout.stream, stderr: stderr.stream },
  );

  assert.equal(exitCode, 1);
  assert.equal(stdout.text(), "");
  assert.match(stderr.text(), /Skill not found/);
});
