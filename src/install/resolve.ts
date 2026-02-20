import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { InstallError } from "./errors.js";
import { uniqueValues } from "../utils/collections.js";

export const AGENTS = [
  "codex",
  "claude",
  "portable",
  "vscode",
  "copilot",
  "amp",
  "goose",
  "opencode",
  "factory",
  "cursor",
] as const;

export const SCOPES = ["repo", "user", "admin", "cwd", "parent"] as const;

export type Agent = (typeof AGENTS)[number];
export type Scope = (typeof SCOPES)[number];

type ScopeResolvers = Partial<Record<Scope, (cwd: string) => string>>;

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

function configRoot(): string {
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}

const scopeResolversByAgent: Record<Agent, ScopeResolvers> = {
  codex: {
    repo: (cwd) => path.join(resolveRepoRoot(cwd), ".codex/skills"),
    cwd: (cwd) => path.join(cwd, ".codex/skills"),
    parent: (cwd) => path.join(path.resolve(cwd, ".."), ".codex/skills"),
    user: () => {
      const root = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
      return path.join(root, "skills");
    },
    admin: () => "/etc/codex/skills",
  },
  claude: {
    repo: (cwd) => path.join(resolveRepoRoot(cwd), ".claude/skills"),
    user: () => path.join(os.homedir(), ".claude/skills"),
  },
  portable: {
    repo: (cwd) => path.join(resolveRepoRoot(cwd), ".agents/skills"),
    user: () => path.join(configRoot(), "agents/skills"),
  },
  vscode: {
    repo: (cwd) => path.join(resolveRepoRoot(cwd), ".github/skills"),
  },
  copilot: {
    repo: (cwd) => path.join(resolveRepoRoot(cwd), ".github/skills"),
  },
  amp: {
    repo: (cwd) => path.join(resolveRepoRoot(cwd), ".agents/skills"),
    user: () => path.join(configRoot(), "agents/skills"),
  },
  goose: {
    repo: (cwd) => path.join(resolveRepoRoot(cwd), ".agents/skills"),
    user: () => path.join(configRoot(), "agents/skills"),
  },
  opencode: {
    repo: (cwd) => path.join(resolveRepoRoot(cwd), ".opencode/skill"),
    user: () => path.join(configRoot(), "opencode/skill"),
  },
  factory: {
    repo: (cwd) => path.join(resolveRepoRoot(cwd), ".factory/skills"),
    user: () => path.join(os.homedir(), ".factory/skills"),
  },
  cursor: {
    repo: (cwd) => path.join(resolveRepoRoot(cwd), ".cursor/skills"),
  },
};

export function assertAgent(value: string): Agent {
  if ((AGENTS as readonly string[]).includes(value)) {
    return value as Agent;
  }
  throw new InstallError(`Unsupported agent: ${value}`);
}

export function assertScope(value: string): Scope {
  if ((SCOPES as readonly string[]).includes(value)) {
    return value as Scope;
  }
  throw new InstallError(`Unsupported scope: ${value}`);
}

export function supportedScopesForAgent(agent: Agent): Scope[] {
  return Object.keys(scopeResolversByAgent[agent]) as Scope[];
}

export function sharedScopesForAgents(agents: Agent[]): Scope[] {
  const uniqueAgents = uniqueValues(agents);
  if (uniqueAgents.length === 0) {
    return [];
  }

  const first = uniqueAgents[0];
  return supportedScopesForAgent(first).filter((scope) =>
    uniqueAgents.every((agent) =>
      supportedScopesForAgent(agent).includes(scope),
    ),
  );
}

export function assertSupportedAgentScopes(
  agents: Agent[],
  scopes: Scope[],
): void {
  for (const agent of uniqueValues(agents)) {
    const supported = supportedScopesForAgent(agent);
    for (const scope of uniqueValues(scopes)) {
      if (!supported.includes(scope)) {
        throw new InstallError(`Unsupported agent/scope: ${agent} ${scope}`);
      }
    }
  }
}

export function resolveSkillsRoot(
  agent: Agent,
  scope: Scope,
  cwd: string,
): string {
  const resolver = scopeResolversByAgent[agent][scope];
  if (!resolver) {
    throw new InstallError(`Unsupported agent/scope: ${agent} ${scope}`);
  }
  return resolver(cwd);
}
