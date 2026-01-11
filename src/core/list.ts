import fs from "node:fs/promises";
import path from "node:path";

import { collectSkillEntries, createTarStream } from "./tar.js";
import { digestStreamSha256 } from "./digest.js";
import { listSkillDirs } from "./paths.js";

export type SkillListJsonItem = {
  id: string;
  digest: string;
  files?: number;
  summary?: string;
  version?: string;
};

export type SkillListJson = {
  skillflag_version: "0.1";
  skills: SkillListJsonItem[];
};

type SkillInfo = {
  id: string;
  dir: string;
  summary?: string;
  version?: string;
};

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---\n")) return {};
  const endIdx = content.indexOf("\n---", 4);
  if (endIdx === -1) return {};
  const block = content.slice(4, endIdx + 1);
  const lines = block.split("\n").filter((line) => line.trim().length > 0);
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (!key || !value) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    }
    fields[key] = value;
  }
  return fields;
}

async function readSkillInfo(dir: string, id: string): Promise<SkillInfo> {
  const skillMdPath = path.join(dir, "SKILL.md");
  try {
    const content = await fs.readFile(skillMdPath, "utf8");
    const fields = parseFrontmatter(content);
    const summary = fields.description
      ? fields.description.replace(/[\t\n]/g, " ").trim()
      : undefined;
    return {
      id,
      dir,
      summary,
      version: fields.version,
    };
  } catch {
    return { id, dir };
  }
}

export async function listSkills(rootDirs: string[]): Promise<SkillInfo[]> {
  const seen = new Map<string, string>();

  for (const rootDir of rootDirs) {
    const dirs = await listSkillDirs(rootDir);
    for (const skill of dirs) {
      if (!seen.has(skill.id)) {
        seen.set(skill.id, skill.dir);
      }
    }
  }

  const infos: SkillInfo[] = [];
  for (const [id, dir] of seen.entries()) {
    infos.push(await readSkillInfo(dir, id));
  }

  infos.sort((a, b) => a.id.localeCompare(b.id));
  return infos;
}

export async function listSkillsJson(
  rootDirs: string[],
): Promise<SkillListJson> {
  const skills = await listSkills(rootDirs);
  const results: SkillListJsonItem[] = [];

  for (const skill of skills) {
    const { entries, fileCount } = await collectSkillEntries(
      skill.dir,
      skill.id,
    );
    const stream = createTarStream(entries);
    const digest = await digestStreamSha256(stream);

    const item: SkillListJsonItem = {
      id: skill.id,
      digest,
    };

    if (fileCount > 0) {
      item.files = fileCount;
    }
    if (skill.summary) {
      item.summary = skill.summary;
    }
    if (skill.version) {
      item.version = skill.version;
    }

    results.push(item);
  }

  return {
    skillflag_version: "0.1",
    skills: results,
  };
}
