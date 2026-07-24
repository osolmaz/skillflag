#!/usr/bin/env node
// Mirror the canonical bundled skills (skills/ at the repo root) into every
// implementation package. Run with --check to verify the copies instead of
// writing them (used by CI).
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repoRoot, "skills");

const targets = [
  "typescript/skills",
  "go/skillflag/skills",
  "python/src/skillflag/skills",
  "rust/crates/skillflag/skills",
];

const check = process.argv.includes("--check");

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return new Map();
  const out = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [rel, content] of listFiles(abs, base)) out.set(rel, content);
    } else if (entry.isFile()) {
      out.set(path.relative(base, abs), fs.readFileSync(abs));
    } else {
      throw new Error(`Unsupported entry in skills tree: ${abs}`);
    }
  }
  return out;
}

const sourceFiles = listFiles(source);
if (sourceFiles.size === 0) {
  console.error(`No skill files found under ${source}`);
  process.exit(1);
}

let failed = false;
for (const target of targets) {
  const dest = path.join(repoRoot, target);
  const packageDir = path.join(repoRoot, target.split("/")[0]);
  if (!fs.existsSync(packageDir)) {
    console.error(`skip: ${target} (package directory missing)`);
    continue;
  }
  if (check) {
    const destFiles = listFiles(dest);
    const sourceKeys = [...sourceFiles.keys()];
    const destKeys = [...destFiles.keys()];
    const same =
      sourceKeys.length === destKeys.length &&
      sourceKeys.every((k) => destFiles.has(k) && destFiles.get(k).equals(sourceFiles.get(k)));
    if (same) {
      console.error(`ok:   ${target}`);
    } else {
      console.error(`DIFF: ${target} is out of sync with skills/ (run: node scripts/sync-skills.mjs)`);
      failed = true;
    }
  } else {
    fs.rmSync(dest, { recursive: true, force: true });
    for (const [rel, content] of sourceFiles) {
      const abs = path.join(dest, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    console.error(`synced: ${target}`);
  }
}

process.exit(failed ? 1 : 0);
