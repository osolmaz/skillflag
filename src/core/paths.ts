import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SkillflagError } from "./errors.js";

export type SkillDir = {
  id: string;
  dir: string;
};

export function defaultSkillsRoot(): URL {
  return new URL("../../skills/", import.meta.url);
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
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listSkillDirs(rootDir: string): Promise<SkillDir[]> {
  let dirents: Dirent[] = [];
  try {
    dirents = await fs.readdir(rootDir, { withFileTypes: true });
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
