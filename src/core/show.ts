import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";

import { resolveSkillDir } from "./paths.js";

export async function showSkill(
  rootDir: string,
  id: string,
  stdout: Writable,
): Promise<void> {
  const skillDir = await resolveSkillDir(rootDir, id);
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const content = await fs.readFile(skillMdPath, "utf8");
  stdout.write(content);
}
