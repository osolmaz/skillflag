import fs from "node:fs";
import fsPromises from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SkillflagError } from "./errors.js";

export type SkillDir = {
  id: string;
  dir: string;
};

export function defaultSkillsRoot(): URL {
  const startDir = path.dirname(fileURLToPath(import.meta.url));
  let current = startDir;
  while (true) {
    const candidate = path.join(current, "package.json");
    if (fs.existsSync(candidate)) {
      return pathToFileURL(path.join(current, "skills/"));
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return pathToFileURL(path.join(startDir, "../../skills/"));
    }
    current = parent;
  }
}

export function resolveSkillsRoot(root: URL | string): string {
  if (root instanceof URL) {
    return fileURLToPath(root);
  }
  return path.resolve(root);
}

export function assertValidSkillId(id: string): void {
  if (!id || id === "." || id === "..") {
    throw new SkillflagError("Skill id is required.");
  }
  if (id.includes("/") || id.includes("\\")) {
    throw new SkillflagError(`Invalid skill id: ${id}`);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listSkillDirs(rootDir: string): Promise<SkillDir[]> {
  let dirents: Dirent[] = [];
  try {
    dirents = await fsPromises.readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillDir[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const id = dirent.name;
    const skillDir = path.join(rootDir, id);
    const skillMd = path.join(skillDir, "SKILL.md");
    if (await pathExists(skillMd)) {
      skills.push({ id, dir: skillDir });
    }
  }

  skills.sort((a, b) => a.id.localeCompare(b.id));
  return skills;
}

export async function resolveSkillDir(
  rootDir: string,
  id: string,
): Promise<string> {
  assertValidSkillId(id);
  const skillDir = path.join(rootDir, id);
  const skillMd = path.join(skillDir, "SKILL.md");
  if (!(await pathExists(skillMd))) {
    throw new SkillflagError(`Skill not found: ${id}`);
  }
  return skillDir;
}

export async function resolveSkillDirFromRoots(
  rootDirs: string[],
  id: string,
): Promise<string> {
  assertValidSkillId(id);
  for (const rootDir of rootDirs) {
    const skillDir = path.join(rootDir, id);
    const skillMd = path.join(skillDir, "SKILL.md");
    if (await pathExists(skillMd)) {
      return skillDir;
    }
  }
  throw new SkillflagError(`Skill not found: ${id}`);
}
