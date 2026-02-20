import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import {
  confirm,
  intro,
  isCancel,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import type { Option } from "@clack/prompts";

import { InstallError, toErrorMessage } from "./errors.js";
import { assertAgent, assertScope, installSkill } from "./install.js";
import { resolveSkillsRoot, type Agent, type Scope } from "./resolve.js";
import { assertSkillDir, readSkillMetadata } from "./validate.js";

export type InstallCliOptions = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  cwd?: string;
};

type ParsedArgs = {
  inputPath?: string;
  agent?: string;
  scope?: string;
  force: boolean;
};

type ResolvedInstallArgs = {
  inputPath?: string;
  agent: Agent;
  scope: Scope;
  force: boolean;
};

const usageLines = [
  "Usage:",
  "  skill-install [PATH] --agent <codex|claude|portable|vscode|copilot|amp|goose|opencode|factory|cursor> --scope <repo|user|cwd|parent|admin>",
  "  skill-install --agent <codex|claude|portable|vscode|copilot|amp|goose|opencode|factory|cursor> --scope <repo|user|cwd|parent|admin> < tar",
];

const agentOptions: Option<Agent>[] = [
  {
    value: "codex",
    label: "codex",
    hint: "OpenAI Codex CLI skills (.codex/skills or CODEX_HOME/skills)",
  },
  {
    value: "claude",
    label: "claude",
    hint: "Claude Code skills (.claude/skills)",
  },
  {
    value: "portable",
    label: "portable",
    hint: "Portable agents skills (.agents/skills)",
  },
  {
    value: "vscode",
    label: "vscode",
    hint: "VS Code skills in .github/skills",
  },
  {
    value: "copilot",
    label: "copilot",
    hint: "GitHub Copilot skills in .github/skills",
  },
  {
    value: "amp",
    label: "amp",
    hint: "Amp agent skills (.agents/skills)",
  },
  {
    value: "goose",
    label: "goose",
    hint: "Goose agent skills (.agents/skills)",
  },
  {
    value: "opencode",
    label: "opencode",
    hint: "OpenCode skills (.opencode/skill)",
  },
  {
    value: "factory",
    label: "factory",
    hint: "Factory skills (.factory/skills)",
  },
  {
    value: "cursor",
    label: "cursor",
    hint: "Cursor skills (.cursor/skills)",
  },
];

const scopeDescriptions: Record<Scope, string> = {
  repo: "Install to the current git repo root.",
  user: "Install to your user-level skills directory.",
  admin: "Install system-wide under /etc (typically needs sudo).",
  cwd: "Install relative to the current working directory.",
  parent: "Install relative to the parent of the current directory.",
};

const supportedScopesByAgent: Record<Agent, Scope[]> = {
  codex: ["repo", "user", "admin", "cwd", "parent"],
  claude: ["repo", "user"],
  portable: ["repo", "user"],
  vscode: ["repo"],
  copilot: ["repo"],
  amp: ["repo", "user"],
  goose: ["repo", "user"],
  opencode: ["repo", "user"],
  factory: ["repo", "user"],
  cursor: ["repo"],
};

const allScopes: Scope[] = ["repo", "user", "admin", "cwd", "parent"];

function parseArgs(args: string[]): ParsedArgs {
  const rest = [...args];
  let inputPath: string | undefined;
  let agent: string | undefined;
  let scope: string | undefined;
  let force = false;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--agent") {
      agent = rest[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--scope") {
      scope = rest[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new InstallError(`Unknown option: ${arg}`);
    }
    if (!inputPath) {
      inputPath = arg;
      continue;
    }
    throw new InstallError(`Unexpected argument: ${arg}`);
  }

  return { inputPath, agent, scope, force };
}

function stdinHasData(stream: Readable): boolean {
  if (typeof (stream as { isTTY?: boolean }).isTTY === "boolean") {
    return !(stream as { isTTY?: boolean }).isTTY;
  }
  return !stream.readableEnded;
}

function stdinIsTty(stream: Readable): boolean {
  return (stream as { isTTY?: boolean }).isTTY === true;
}

function asAgent(value: string | undefined): Agent | undefined {
  if (!value) return undefined;
  try {
    return assertAgent(value);
  } catch {
    return undefined;
  }
}

function asScope(value: string | undefined): Scope | undefined {
  if (!value) return undefined;
  try {
    return assertScope(value);
  } catch {
    return undefined;
  }
}

function validateRequiredFlags(parsed: ParsedArgs): ResolvedInstallArgs {
  if (!parsed.agent || !parsed.scope) {
    throw new InstallError(`Missing required flags.\n${usageLines.join("\n")}`);
  }
  return {
    inputPath: parsed.inputPath,
    agent: assertAgent(parsed.agent),
    scope: assertScope(parsed.scope),
    force: parsed.force,
  };
}

function resolveInstallInput(
  inputPath: string | undefined,
  stdin: Readable,
): { kind: "dir"; dir: string } | { kind: "tar"; stream: Readable } {
  if (inputPath) {
    const stat = fs.statSync(inputPath);
    if (!stat.isDirectory()) {
      throw new InstallError("PATH must be a directory containing SKILL.md.");
    }
    return { kind: "dir", dir: inputPath };
  }
  if (stdinHasData(stdin)) {
    return { kind: "tar", stream: stdin };
  }
  throw new InstallError(
    `Missing PATH or tar stream on stdin.\n${usageLines.join("\n")}`,
  );
}

function cancelWizard(
  stdin: Readable,
  stdout: Writable,
  message = "Install cancelled.",
): null {
  outro(message, { input: stdin, output: stdout });
  return null;
}

function validatePathPrompt(value: string | undefined): string | undefined {
  const candidate = value?.trim() ?? "";
  if (!candidate) return "PATH is required.";
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isDirectory()) {
      return "PATH must be a directory.";
    }
  } catch {
    return "PATH does not exist.";
  }
  return undefined;
}

async function runInstallWizard(
  parsed: ParsedArgs,
  stdin: Readable,
  stdout: Writable,
  cwd: string,
): Promise<ResolvedInstallArgs | null> {
  intro("skill-install wizard", { input: stdin, output: stdout });

  const defaultPath = parsed.inputPath ?? cwd;
  const pathValue = await text({
    message: "PATH to a skill directory (defaults to current directory)",
    placeholder: defaultPath,
    defaultValue: defaultPath,
    validate: validatePathPrompt,
    input: stdin,
    output: stdout,
  });
  if (isCancel(pathValue)) return cancelWizard(stdin, stdout);
  const inputPath = pathValue.trim() || defaultPath;

  const agentInitial = asAgent(parsed.agent) ?? "codex";
  const agentValue = await select({
    message: "Agent target",
    options: agentOptions,
    initialValue: agentInitial,
    input: stdin,
    output: stdout,
  });
  if (isCancel(agentValue)) return cancelWizard(stdin, stdout);
  const agent = assertAgent(agentValue);

  const supportedScopes = supportedScopesByAgent[agent];
  const scopeInitial = (() => {
    const initialScope = asScope(parsed.scope);
    if (initialScope && supportedScopes.includes(initialScope)) {
      return initialScope;
    }
    return supportedScopes[0];
  })();
  const scopeOptions: Option<Scope>[] = allScopes.map((scope) => ({
    value: scope,
    label: scope,
    hint:
      scopeDescriptions[scope] +
      (supportedScopes.includes(scope)
        ? ""
        : " (not supported for this agent)"),
    disabled: !supportedScopes.includes(scope),
  }));
  const scopeValue = await select({
    message: "Scope target",
    options: scopeOptions,
    initialValue: scopeInitial,
    input: stdin,
    output: stdout,
  });
  if (isCancel(scopeValue)) return cancelWizard(stdin, stdout);
  const scope = assertScope(scopeValue);

  const forceValue = await confirm({
    message: "Force overwrite if the destination already exists? (--force)",
    initialValue: parsed.force,
    input: stdin,
    output: stdout,
  });
  if (isCancel(forceValue)) return cancelWizard(stdin, stdout);
  const force = forceValue;

  const sourceDir = path.resolve(inputPath);
  await assertSkillDir(sourceDir);
  const meta = await readSkillMetadata(sourceDir);
  const skillsRoot = resolveSkillsRoot(agent, scope, cwd);
  const destDir = path.join(skillsRoot, meta.name);

  note(
    [
      `Source: ${sourceDir}`,
      `Skill: ${meta.name}`,
      `Agent: ${agent}`,
      `Scope: ${scope}`,
      `Destination: ${destDir}`,
      `Force: ${force ? "yes" : "no"}`,
    ].join("\n"),
    "Install summary",
    { input: stdin, output: stdout },
  );

  const confirmed = await confirm({
    message: "Proceed with install?",
    initialValue: true,
    input: stdin,
    output: stdout,
  });
  if (isCancel(confirmed) || !confirmed) return cancelWizard(stdin, stdout);

  return { inputPath, agent, scope, force };
}

async function runInstall(
  args: ResolvedInstallArgs,
  stdin: Readable,
  stdout: Writable,
  cwd: string,
  useSpinner: boolean,
): Promise<{ skillId: string; installedTo: string }> {
  const input = resolveInstallInput(args.inputPath, stdin);
  if (!useSpinner) {
    return installSkill(input, {
      agent: args.agent,
      scope: args.scope,
      cwd,
      force: args.force,
    });
  }

  const s = spinner({ input: stdin, output: stdout });
  s.start("Installing skill...");
  try {
    const result = await installSkill(input, {
      agent: args.agent,
      scope: args.scope,
      cwd,
      force: args.force,
    });
    s.stop("Install complete.");
    return result;
  } catch (err) {
    s.error("Install failed.");
    throw err;
  }
}

export async function runInstallCli(
  argv: string[],
  opts: InstallCliOptions = {},
): Promise<number> {
  const stdout = (opts.stdout ?? process.stdout) as Writable;
  const stderr = (opts.stderr ?? process.stderr) as Writable;
  const stdin = opts.stdin ?? process.stdin;
  const cwd = opts.cwd ?? process.cwd();

  try {
    const parsed = parseArgs(argv.slice(2));
    let wizardUsed = false;

    const installArgs =
      !parsed.agent || !parsed.scope
        ? (() => {
            if (!stdinIsTty(stdin)) {
              return validateRequiredFlags(parsed);
            }
            wizardUsed = true;
            return null;
          })()
        : validateRequiredFlags(parsed);

    const resolved =
      installArgs ?? (await runInstallWizard(parsed, stdin, stdout, cwd));
    if (!resolved) {
      return 1;
    }

    const result = await runInstall(resolved, stdin, stdout, cwd, wizardUsed);

    stderr.write(`Installed ${result.skillId} to ${result.installedTo}\n`);
    if (wizardUsed) {
      outro("Done.", { input: stdin, output: stdout });
    }
    return 0;
  } catch (err) {
    stderr.write(`${toErrorMessage(err)}\n`);
    return err instanceof InstallError ? err.exitCode : 1;
  }
}
