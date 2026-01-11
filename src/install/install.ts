import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { InstallError } from "./errors.js";
import { assertSkillDir, readSkillMetadata } from "./validate.js";
import { extractSkillTarToTemp } from "./extract.js";
import { resolveSkillsRoot, type Agent, type Scope } from "./resolve.js";
import { copySkillDir } from "./copy.js";

export type InstallInput =
  | { kind: "dir"; dir: string }
  | { kind: "tar"; stream: Readable };

export type InstallOptions = {
  agent: Agent;
  scope: Scope;
  cwd: string;
  force: boolean;
};

export type InstallResult = {
  skillId: string;
  installedTo: string;
};

export async function installSkill(
  input: InstallInput,
  options: InstallOptions,
): Promise<InstallResult> {
  const { agent, scope, cwd, force } = options;

  let rootDir = "";
  let cleanup = async () => {};
  if (input.kind === "dir") {
    rootDir = path.resolve(input.dir);
  } else {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-install-"));
    cleanup = async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    };
    rootDir = await extractSkillTarToTemp(input.stream, tempDir);
  }

  try {
    await assertSkillDir(rootDir);
    const meta = await readSkillMetadata(rootDir);
    const skillId = meta.name;

    const skillsRoot = resolveSkillsRoot(agent, scope, cwd);
    const destDir = path.join(skillsRoot, skillId);

    await copySkillDir(rootDir, destDir, force);

    return { skillId, installedTo: destDir };
  } finally {
    await cleanup();
  }
}

export function assertAgent(value: string): Agent {
  if (
    value === "codex" ||
    value === "claude" ||
    value === "portable" ||
    value === "vscode" ||
    value === "copilot" ||
    value === "amp" ||
    value === "goose" ||
    value === "opencode" ||
    value === "factory" ||
    value === "cursor"
  ) {
    return value;
  }
  throw new InstallError(`Unsupported agent: ${value}`);
}

export function assertScope(value: string): Scope {
  if (
    value === "repo" ||
    value === "user" ||
    value === "admin" ||
    value === "cwd" ||
    value === "parent"
  ) {
    return value;
  }
  throw new InstallError(`Unsupported scope: ${value}`);
}
