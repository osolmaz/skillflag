import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import * as tar from "tar-stream";

import { handleSkillflag } from "../../src/core/skillflag.js";
import { createCapture } from "../helpers/capture.js";

const fixturesRoot = path.resolve(
  process.cwd(),
  "test/fixtures/skills",
);

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

test("--skill list outputs sorted ids", async () => {
  const stdout = createCapture();
  const stderr = createCapture();

  const exitCode = await handleSkillflag(
    ["node", "cli", "--skill", "list"],
    { skillsRoot: fixturesRoot, stdout: stdout.stream, stderr: stderr.stream },
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.text(), "");
  assert.equal(stdout.text(), "alpha\nbeta\n");
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
