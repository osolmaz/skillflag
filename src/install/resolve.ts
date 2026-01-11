import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { InstallError } from "./errors.js";

export type Agent = "codex" | "claude";
export type Scope = "repo" | "user" | "admin" | "cwd" | "parent";

export function resolveRepoRoot(cwd: string): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
    }).trim();
    if (out) return out;
  } catch {
    // fall through
  }
  return cwd;
}

export function resolveSkillsRoot(
  agent: Agent,
  scope: Scope,
  cwd: string,
): string {
  if (agent === "codex") {
    if (scope === "repo") {
      return path.join(resolveRepoRoot(cwd), ".codex/skills");
    }
    if (scope === "cwd") {
      return path.join(cwd, ".codex/skills");
    }
    if (scope === "parent") {
      return path.join(path.resolve(cwd, ".."), ".codex/skills");
    }
    if (scope === "user") {
      const root = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
      return path.join(root, "skills");
    }
    if (scope === "admin") {
      return "/etc/codex/skills";
    }
  }

  if (agent === "claude") {
    if (scope === "repo") {
      return path.join(resolveRepoRoot(cwd), ".claude/skills");
    }
    if (scope === "user") {
      return path.join(os.homedir(), ".claude/skills");
    }
  }

  throw new InstallError(`Unsupported agent/scope: ${agent} ${scope}`);
}
