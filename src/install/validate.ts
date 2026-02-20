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
  const frontmatterMatch = content.match(
    /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
  );
  if (!frontmatterMatch) {
    return {};
  }
  const block = frontmatterMatch[1];
  const lines = block.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    const value = stripYamlQuotes(rawValue);
    if (key && value) {
      fields[key] = value;
    }
  }
  return fields;
}

function stripYamlQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
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
    throw new InstallError("SKILL.md metadata is missing name.");
  }
  if (!description) {
    throw new InstallError("SKILL.md metadata is missing description.");
  }

  return { name, description };
}
