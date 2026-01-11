import fs from "node:fs/promises";
import path from "node:path";

import { InstallError } from "./errors.js";

export type SkillMetadata = {
  name: string;
  description: string;
};

export async function assertSkillDir(rootDir: string): Promise<void> {
  const skillMd = path.join(rootDir, "SKILL.md");
  try {
    await fs.access(skillMd);
  } catch {
    throw new InstallError("SKILL.md not found in skill root.");
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---\n")) {
    throw new InstallError("Missing YAML frontmatter in SKILL.md.");
  }
  const endIdx = content.indexOf("\n---", 4);
  if (endIdx === -1) {
    throw new InstallError("Unterminated YAML frontmatter in SKILL.md.");
  }
  const block = content.slice(4, endIdx + 1);
  const lines = block.split("\n").filter((line) => line.trim().length > 0);
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) {
      fields[key] = value;
    }
  }
  return fields;
}

export async function readSkillMetadata(
  rootDir: string,
): Promise<SkillMetadata> {
  const skillMdPath = path.join(rootDir, "SKILL.md");
  const content = await fs.readFile(skillMdPath, "utf8");
  const fields = parseFrontmatter(content);
  const name = fields.name;
  const description = fields.description;

  if (!name) {
    throw new InstallError("SKILL.md frontmatter is missing name.");
  }
  if (!description) {
    throw new InstallError("SKILL.md frontmatter is missing description.");
  }

  return { name, description };
}
