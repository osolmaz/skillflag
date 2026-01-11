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

export async function listSkillIds(rootDir: string): Promise<string[]> {
  const skills = await listSkillDirs(rootDir);
  return skills.map((skill) => skill.id);
}

export async function listSkillsJson(rootDir: string): Promise<SkillListJson> {
  const skills = await listSkillDirs(rootDir);
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

    results.push(item);
  }

  return {
    skillflag_version: "0.1",
    skills: results,
  };
}
