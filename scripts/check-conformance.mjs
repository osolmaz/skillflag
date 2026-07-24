#!/usr/bin/env node
// Cross-implementation conformance suite.
//
// Builds every implementation in this repo, then verifies that they agree
// byte-for-byte on the Skillflag producer surface (list, list --json, show,
// export) over the shared fixtures, that digests match the export bytes, and
// that every installer produces the same installed tree from the same tar
// stream. The TypeScript implementation is the reference; everything is
// compared against it.
//
// Usage: node scripts/check-conformance.mjs [--require-all]
//   --require-all  fail (instead of skip) when an implementation is missing
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = path.join(repoRoot, "fixtures", "skills");
const requireAll = process.argv.includes("--require-all");
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "skillflag-conformance-"));

let failures = 0;
const cleanups = [() => fs.rmSync(buildDir, { recursive: true, force: true })];

function log(line) {
  process.stderr.write(`${line}\n`);
}

function fail(message) {
  failures += 1;
  log(`FAIL: ${message}`);
}

function pass(message) {
  log(`ok:   ${message}`);
}

function build(name, cmd, args, cwd) {
  log(`building ${name}...`);
  execFileSync(cmd, args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
}

function defineImplementations() {
  const impls = [];

  const tsDir = path.join(repoRoot, "typescript");
  if (fs.existsSync(tsDir)) {
    if (!fs.existsSync(path.join(tsDir, "node_modules"))) {
      build("typescript deps", "npm", ["ci"], tsDir);
    }
    build("typescript", "npm", ["run", "-s", "build"], tsDir);
    impls.push({
      name: "typescript",
      producer: ["node", path.join(tsDir, "dist", "bin", "skillflag.js")],
      installer: ["node", path.join(tsDir, "dist", "bin", "skill-install.js")],
    });
  }

  const goDir = path.join(repoRoot, "go");
  if (fs.existsSync(goDir)) {
    build(
      "go",
      "go",
      ["build", "-o", buildDir + path.sep, "./cmd/skillflag-go", "./cmd/skill-install-go"],
      goDir,
    );
    impls.push({
      name: "go",
      producer: [path.join(buildDir, "skillflag-go")],
      installer: [path.join(buildDir, "skill-install-go")],
    });
  }

  const pyDir = path.join(repoRoot, "python");
  if (fs.existsSync(pyDir)) {
    build("python", "uv", ["sync", "--quiet"], pyDir);
    const venvBin = path.join(pyDir, ".venv", "bin");
    impls.push({
      name: "python",
      producer: [path.join(venvBin, "skillflag-py")],
      installer: [path.join(venvBin, "skill-install-py")],
    });
  }

  const rustDir = path.join(repoRoot, "rust");
  if (fs.existsSync(rustDir)) {
    build("rust", "cargo", ["build", "--quiet", "--workspace"], rustDir);
    const target = path.join(rustDir, "target", "debug");
    impls.push({
      name: "rust",
      producer: [path.join(target, "skillflag-rs")],
      installer: [path.join(target, "skill-install-rs")],
    });
  }

  return impls;
}

function run(argv, { input, cwd, env } = {}) {
  const [cmd, ...args] = argv;
  const result = spawnSync(cmd, args, {
    input,
    cwd: cwd ?? repoRoot,
    env: { ...process.env, SKILLFLAG_SKILLS_ROOT: fixturesRoot, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function snapshotTree(dir) {
  const out = new Map();
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const entryAbs = path.join(abs, entry.name);
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(entryAbs, entryRel);
      } else {
        const stat = fs.statSync(entryAbs);
        const exec = (stat.mode & 0o111) !== 0;
        out.set(entryRel, `${exec ? "x" : "-"}:${fs.readFileSync(entryAbs).toString("hex")}`);
      }
    }
  };
  walk(dir, "");
  return out;
}

function treesEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function makeTempGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillflag-install-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", dir]);
  return dir;
}

const impls = defineImplementations();
const missing = ["typescript", "go", "python", "rust"].filter(
  (name) => !impls.some((impl) => impl.name === name),
);
for (const name of missing) {
  if (requireAll) fail(`implementation missing: ${name}`);
  else log(`skip: ${name} (not present)`);
}

if (impls.length === 0 || impls[0].name !== "typescript") {
  fail("the typescript reference implementation is required");
} else {
  const [reference, ...others] = impls;

  // 1. Producer surface: byte-identical stdout across implementations.
  const producerCases = [
    ["list"],
    ["list", "--json"],
    ["show", "alpha"],
    ["show", "beta"],
    ["export", "alpha"],
    ["export", "beta"],
  ];
  const referenceOutputs = new Map();
  for (const args of producerCases) {
    const key = args.join(" ");
    const res = run([...reference.producer, ...args]);
    if (res.status !== 0) {
      fail(`${reference.name}: '${key}' exited ${res.status}: ${res.stderr}`);
      continue;
    }
    referenceOutputs.set(key, res.stdout);
    for (const impl of others) {
      const other = run([...impl.producer, ...args]);
      if (other.status !== 0) {
        fail(`${impl.name}: '${key}' exited ${other.status}: ${other.stderr}`);
      } else if (!other.stdout.equals(res.stdout)) {
        fail(`${impl.name}: '${key}' output differs from ${reference.name} (${other.stdout.length} vs ${res.stdout.length} bytes)`);
      } else {
        pass(`${impl.name}: '${key}' matches ${reference.name}`);
      }
    }
  }

  // 2. Digests in list --json match the export bytes.
  const listJson = referenceOutputs.get("list --json");
  if (listJson) {
    const payload = JSON.parse(listJson.toString("utf8"));
    for (const skill of payload.skills) {
      const tarBytes = referenceOutputs.get(`export ${skill.id}`);
      if (!tarBytes) continue;
      const digest = `sha256:${createHash("sha256").update(tarBytes).digest("hex")}`;
      if (digest === skill.digest) pass(`digest for '${skill.id}' matches export bytes`);
      else fail(`digest mismatch for '${skill.id}': listed ${skill.digest}, computed ${digest}`);
    }
  }

  // 3. Unknown skill id: exit 1, error on stderr, nothing on stdout.
  for (const impl of impls) {
    const res = run([...impl.producer, "export", "missing"]);
    if (res.status === 1 && res.stdout.length === 0 && res.stderr.toString().includes("Skill not found: missing")) {
      pass(`${impl.name}: unknown id fails correctly`);
    } else {
      fail(`${impl.name}: unknown id — status ${res.status}, stdout ${res.stdout.length} bytes, stderr: ${res.stderr}`);
    }
  }

  // 4. Installer round-trip: same tar stream -> same installed tree.
  const alphaTar = referenceOutputs.get("export alpha");
  const expectedTree = snapshotTree(path.join(fixturesRoot, "alpha"));
  if (alphaTar) {
    for (const impl of impls) {
      const repo = makeTempGitRepo();
      const installArgs = [...impl.installer, "--agent", "codex", "--scope", "repo"];
      const first = run(installArgs, { input: alphaTar, cwd: repo });
      const installedDir = path.join(repo, ".codex", "skills", "alpha");
      if (first.status !== 0) {
        fail(`${impl.name}: install exited ${first.status}: ${first.stderr}`);
        continue;
      }
      if (!fs.existsSync(installedDir) || !treesEqual(snapshotTree(installedDir), expectedTree)) {
        fail(`${impl.name}: installed tree differs from fixture`);
        continue;
      }
      const conflict = run(installArgs, { input: alphaTar, cwd: repo });
      const forced = run([...installArgs, "--force"], { input: alphaTar, cwd: repo });
      if (conflict.status !== 1) fail(`${impl.name}: expected exit 1 when destination exists, got ${conflict.status}`);
      else if (forced.status !== 0) fail(`${impl.name}: --force install exited ${forced.status}: ${forced.stderr}`);
      else pass(`${impl.name}: installer round-trip, conflict, and --force behave correctly`);
    }
  }

  // 5. Producer-side install (--skill install <id>) writes the same tree.
  for (const impl of impls) {
    const repo = makeTempGitRepo();
    const res = run(
      [...impl.producer, "--skill", "install", "alpha", "--agent", "codex", "--scope", "repo"],
      { cwd: repo },
    );
    const installedDir = path.join(repo, ".codex", "skills", "alpha");
    if (res.status !== 0) {
      fail(`${impl.name}: '--skill install alpha' exited ${res.status}: ${res.stderr}`);
    } else if (!fs.existsSync(installedDir) || !treesEqual(snapshotTree(installedDir), expectedTree)) {
      fail(`${impl.name}: '--skill install' tree differs from fixture`);
    } else {
      pass(`${impl.name}: '--skill install alpha' installs the fixture tree`);
    }
  }
}

for (const cleanup of cleanups) {
  try {
    cleanup();
  } catch {
    // best-effort cleanup
  }
}

if (failures > 0) {
  log(`\nconformance: ${failures} failure(s)`);
  process.exit(1);
}
log("\nconformance: all checks passed");
