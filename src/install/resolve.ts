import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { InstallError } from "./errors.js";

export type Agent =
  | "codex"
  | "claude"
  | "portable"
  | "vscode"
  | "copilot"
  | "amp"
  | "goose"
  | "opencode"
  | "factory"
  | "cursor";
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

  if (agent === "portable") {
    if (scope === "repo") {
      return path.join(resolveRepoRoot(cwd), ".agents/skills");
    }
    if (scope === "user") {
      const root =
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
      return path.join(root, "agents/skills");
    }
  }

  if (agent === "vscode" || agent === "copilot") {
    if (scope === "repo") {
      return path.join(resolveRepoRoot(cwd), ".github/skills");
    }
  }

  if (agent === "amp" || agent === "goose") {
    if (scope === "repo") {
      return path.join(resolveRepoRoot(cwd), ".agents/skills");
    }
    if (scope === "user") {
      const root =
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
      return path.join(root, "agents/skills");
    }
  }

  if (agent === "opencode") {
    if (scope === "repo") {
      return path.join(resolveRepoRoot(cwd), ".opencode/skill");
    }
    if (scope === "user") {
      const root =
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
      return path.join(root, "opencode/skill");
    }
  }

  if (agent === "factory") {
    if (scope === "repo") {
      return path.join(resolveRepoRoot(cwd), ".factory/skills");
    }
    if (scope === "user") {
      return path.join(os.homedir(), ".factory/skills");
    }
  }

  if (agent === "cursor") {
    if (scope === "repo") {
      return path.join(resolveRepoRoot(cwd), ".cursor/skills");
    }
  }

  throw new InstallError(`Unsupported agent/scope: ${agent} ${scope}`);
}
