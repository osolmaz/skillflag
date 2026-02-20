import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import {
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  spinner,
  text,
} from "@clack/prompts";
import type { Option } from "@clack/prompts";

import { InstallError, toErrorMessage } from "./errors.js";
import {
  assertAgent,
  assertScope,
  installSkill,
  type InstallInput,
} from "./install.js";
import { resolveSkillsRoot, type Agent, type Scope } from "./resolve.js";
import { assertSkillDir, readSkillMetadata } from "./validate.js";

export type InstallCliOptions = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  cwd?: string;
  providedInput?: InstallInput;
  providedInputs?: InstallInput[];
  providedSkillId?: string;
  providedSkillIds?: string[];
};

type ParsedArgs = {
  inputPaths: string[];
  agents: string[];
  scopes: string[];
  force: boolean;
};

type ResolvedInstallArgs = {
  inputPaths: string[];
  agents: Agent[];
  scopes: Scope[];
  force: boolean;
};

type ProvidedInstallInputs = {
  inputs: InstallInput[];
  skillIds: string[];
};

type PreparedInstallSource = {
  source: string;
  skillIdHint: string;
  makeInput: () => InstallInput;
};

type InstallPlanItem = {
  source: PreparedInstallSource;
  agent: Agent;
  scope: Scope;
  destination: string;
};

type InstallExecutionResult = {
  skillId: string;
  agent: Agent;
  installedTo: string;
  scope: Scope;
};

type WizardResult = {
  args: ResolvedInstallArgs;
  sources: PreparedInstallSource[];
};

const usageLines = [
  "Usage:",
  "  skill-install [PATH ...] --agent <codex|claude|portable|vscode|copilot|amp|goose|opencode|factory|cursor>[,<agent>...] [--agent <agent>[,<agent>...]] --scope <repo|user|cwd|parent|admin>[,<scope>...] [--scope <scope>[,<scope>...]] [--force]",
  "  skill-install --agent <codex|claude|portable|vscode|copilot|amp|goose|opencode|factory|cursor>[,<agent>...] [--agent <agent>[,<agent>...]] --scope <repo|user|cwd|parent|admin>[,<scope>...] [--scope <scope>[,<scope>...]] [--force] < tar",
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

function uniqueValues<T>(values: T[]): T[] {
  const out: T[] = [];
  for (const value of values) {
    if (!out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

function parseScopeValues(value: string | undefined): string[] {
  if (!value || value.startsWith("-")) {
    throw new InstallError("Missing value for --scope.");
  }
  const scopes = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (scopes.length === 0) {
    throw new InstallError("Missing value for --scope.");
  }
  return scopes;
}

function parseAgentValues(value: string | undefined): string[] {
  if (!value || value.startsWith("-")) {
    throw new InstallError("Missing value for --agent.");
  }
  const agents = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (agents.length === 0) {
    throw new InstallError("Missing value for --agent.");
  }
  return agents;
}

function parseArgs(args: string[]): ParsedArgs {
  const rest = [...args];
  const inputPaths: string[] = [];
  const agents: string[] = [];
  const scopes: string[] = [];
  let force = false;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--agent") {
      agents.push(...parseAgentValues(rest[i + 1]));
      i += 1;
      continue;
    }
    if (arg === "--scope") {
      scopes.push(...parseScopeValues(rest[i + 1]));
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
    inputPaths.push(arg);
  }

  return {
    inputPaths,
    agents: uniqueValues(agents),
    scopes: uniqueValues(scopes),
    force,
  };
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

function asAgents(values: string[]): Agent[] {
  return uniqueValues(
    values
      .map((value) => asAgent(value))
      .filter((value): value is Agent => value !== undefined),
  );
}

function asScope(value: string | undefined): Scope | undefined {
  if (!value) return undefined;
  try {
    return assertScope(value);
  } catch {
    return undefined;
  }
}

function asScopes(values: string[]): Scope[] {
  return values
    .map((value) => asScope(value))
    .filter((value): value is Scope => value !== undefined);
}

function getSharedScopes(agents: Agent[]): Scope[] {
  if (agents.length === 0) return [];
  return supportedScopesByAgent[agents[0]].filter((scope) =>
    agents.every((agent) => supportedScopesByAgent[agent].includes(scope)),
  );
}

function assertSupportedAgentScopes(agents: Agent[], scopes: Scope[]): void {
  for (const agent of agents) {
    const supportedScopes = supportedScopesByAgent[agent];
    for (const scope of scopes) {
      if (!supportedScopes.includes(scope)) {
        throw new InstallError(`Unsupported agent/scope: ${agent} ${scope}`);
      }
    }
  }
}

function validateRequiredFlags(parsed: ParsedArgs): ResolvedInstallArgs {
  if (parsed.agents.length === 0 || parsed.scopes.length === 0) {
    throw new InstallError(`Missing required flags.\n${usageLines.join("\n")}`);
  }
  const agents = uniqueValues(parsed.agents.map((agent) => assertAgent(agent)));
  const scopes = uniqueValues(parsed.scopes.map((scope) => assertScope(scope)));
  assertSupportedAgentScopes(agents, scopes);
  return {
    inputPaths: parsed.inputPaths,
    agents,
    scopes,
    force: parsed.force,
  };
}

function normalizeProvidedInputs(
  opts: InstallCliOptions,
): ProvidedInstallInputs {
  if (opts.providedInput && opts.providedInputs?.length) {
    throw new InstallError(
      "providedInput and providedInputs cannot be used together.",
    );
  }
  if (opts.providedSkillId && opts.providedSkillIds?.length) {
    throw new InstallError(
      "providedSkillId and providedSkillIds cannot be used together.",
    );
  }

  const inputs =
    opts.providedInputs ?? (opts.providedInput ? [opts.providedInput] : []);
  const skillIds =
    opts.providedSkillIds ??
    (opts.providedSkillId ? [opts.providedSkillId] : []);

  if (skillIds.length > 0 && inputs.length === 0) {
    throw new InstallError("Preset skill ids require preset install inputs.");
  }
  if (skillIds.length > 0 && skillIds.length !== inputs.length) {
    throw new InstallError(
      "Preset skill id count must match preset install input count.",
    );
  }

  return { inputs, skillIds };
}

function parsePathList(value: string | undefined): string[] {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return [];
  }
  return uniqueValues(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

function validatePathPrompt(value: string | undefined): string | undefined {
  const candidates = parsePathList(value);
  if (candidates.length === 0) return "PATH is required.";
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isDirectory()) {
        return `PATH must be a directory: ${candidate}`;
      }
    } catch {
      return `PATH does not exist: ${candidate}`;
    }
  }
  return undefined;
}

function cancelWizard(
  stdin: Readable,
  stdout: Writable,
  message = "Install cancelled.",
): null {
  outro(message, { input: stdin, output: stdout });
  return null;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    stream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", reject);
  });
}

async function prepareInstallSource(
  input: InstallInput,
  skillId?: string,
): Promise<PreparedInstallSource> {
  if (input.kind === "dir") {
    const sourceDir = path.resolve(input.dir);
    let stat;
    try {
      stat = fs.statSync(sourceDir);
    } catch {
      throw new InstallError(`PATH does not exist: ${sourceDir}`);
    }
    if (!stat.isDirectory()) {
      throw new InstallError("PATH must be a directory containing SKILL.md.");
    }

    await assertSkillDir(sourceDir);
    const meta = await readSkillMetadata(sourceDir);
    return {
      source: sourceDir,
      skillIdHint: meta.name,
      makeInput: () => ({ kind: "dir", dir: sourceDir }),
    };
  }

  const tarBuffer = await streamToBuffer(input.stream);
  return {
    source: "tar stream",
    skillIdHint: skillId ?? "<from skill bundle>",
    makeInput: () => ({ kind: "tar", stream: Readable.from(tarBuffer) }),
  };
}

async function resolveInstallSources(
  inputPaths: string[],
  stdin: Readable,
  provided: ProvidedInstallInputs,
): Promise<PreparedInstallSource[]> {
  if (inputPaths.length > 0 && provided.inputs.length > 0) {
    throw new InstallError("PATH cannot be used when install input is preset.");
  }

  if (inputPaths.length > 0) {
    return Promise.all(
      inputPaths.map((inputPath) =>
        prepareInstallSource({ kind: "dir", dir: inputPath }),
      ),
    );
  }

  if (provided.inputs.length > 0) {
    return Promise.all(
      provided.inputs.map((input, index) =>
        prepareInstallSource(input, provided.skillIds[index]),
      ),
    );
  }

  if (stdinHasData(stdin)) {
    return [await prepareInstallSource({ kind: "tar", stream: stdin })];
  }

  throw new InstallError(
    `Missing PATH or tar stream on stdin.\n${usageLines.join("\n")}`,
  );
}

function buildInstallPlan(
  sources: PreparedInstallSource[],
  agents: Agent[],
  scopes: Scope[],
  cwd: string,
): InstallPlanItem[] {
  const plan: InstallPlanItem[] = [];
  for (const source of sources) {
    for (const agent of agents) {
      for (const scope of scopes) {
        const skillsRoot = resolveSkillsRoot(agent, scope, cwd);
        plan.push({
          source,
          agent,
          scope,
          destination: path.join(skillsRoot, source.skillIdHint),
        });
      }
    }
  }
  return plan;
}

function dedupeInstallPlan(plan: InstallPlanItem[]): InstallPlanItem[] {
  const seenByDestination = new Map<string, Set<PreparedInstallSource>>();
  const deduped: InstallPlanItem[] = [];

  for (const item of plan) {
    const seenSources = seenByDestination.get(item.destination) ?? new Set();
    if (seenSources.has(item.source)) {
      continue;
    }
    seenSources.add(item.source);
    seenByDestination.set(item.destination, seenSources);
    deduped.push(item);
  }

  return deduped;
}

async function runInstallWizard(
  parsed: ParsedArgs,
  stdin: Readable,
  stdout: Writable,
  cwd: string,
  provided: ProvidedInstallInputs,
): Promise<WizardResult | null> {
  intro("skill-install wizard", { input: stdin, output: stdout });

  let inputPaths = parsed.inputPaths;
  if (provided.inputs.length === 0 && inputPaths.length === 0) {
    const defaultPath = cwd;
    const pathValue = await text({
      message:
        "PATH to skill directory (comma-separated for multiple, defaults to current directory)",
      placeholder: defaultPath,
      defaultValue: defaultPath,
      validate: validatePathPrompt,
      input: stdin,
      output: stdout,
    });
    if (isCancel(pathValue)) return cancelWizard(stdin, stdout);
    inputPaths = parsePathList(pathValue.trim() || defaultPath);
  }

  const parsedAgents = asAgents(parsed.agents);
  let agents: Agent[];
  if (
    parsedAgents.length > 0 &&
    parsedAgents.length === uniqueValues(parsed.agents).length
  ) {
    agents = parsedAgents;
  } else if (agentOptions.length === 1) {
    agents = [assertAgent(agentOptions[0].value)];
  } else {
    const agentValues = await multiselect({
      message: "Agent targets",
      options: agentOptions,
      initialValues: parsedAgents.length > 0 ? parsedAgents : ["codex"],
      required: true,
      input: stdin,
      output: stdout,
    });
    if (isCancel(agentValues)) return cancelWizard(stdin, stdout);
    agents = uniqueValues(agentValues.map((value) => assertAgent(value)));
  }

  const supportedScopes = getSharedScopes(agents);
  if (supportedScopes.length === 0) {
    throw new InstallError(
      `No shared scopes for selected agents: ${agents.join(", ")}`,
    );
  }
  const parsedScopes = asScopes(parsed.scopes).filter((scope) =>
    supportedScopes.includes(scope),
  );

  let scopes: Scope[];
  if (supportedScopes.length === 1) {
    scopes = [supportedScopes[0]];
  } else {
    const scopeOptions: Option<Scope>[] = supportedScopes.map((scope) => ({
      value: scope,
      label: scope,
      hint: scopeDescriptions[scope],
    }));
    const scopeValues = await multiselect({
      message: "Scope targets",
      options: scopeOptions,
      initialValues:
        parsedScopes.length > 0 ? parsedScopes : [supportedScopes[0]],
      required: true,
      input: stdin,
      output: stdout,
    });
    if (isCancel(scopeValues)) return cancelWizard(stdin, stdout);
    scopes = uniqueValues(scopeValues.map((scope) => assertScope(scope)));
  }

  const forceValue = await confirm({
    message: "Force overwrite if the destination already exists? (--force)",
    initialValue: parsed.force,
    input: stdin,
    output: stdout,
  });
  if (isCancel(forceValue)) return cancelWizard(stdin, stdout);
  const force = forceValue;

  assertSupportedAgentScopes(agents, scopes);

  const sources = await resolveInstallSources(inputPaths, stdin, provided);
  const plan = buildInstallPlan(sources, agents, scopes, cwd);
  const executionPlan = dedupeInstallPlan(plan);

  const sourceLines = sources.map(
    (source) => `${source.skillIdHint} <= ${source.source}`,
  );
  const installLines = plan.map(
    (item) =>
      `${item.source.skillIdHint} @ ${item.agent}/${item.scope} -> ${item.destination}`,
  );

  note(
    [
      `Sources (${sources.length}):`,
      ...sourceLines,
      `Agents (${agents.length}): ${agents.join(", ")}`,
      `Scopes (${scopes.length}): ${scopes.join(", ")}`,
      `Matrix: ${sources.length} skill(s) × ${agents.length} agent(s) × ${scopes.length} scope(s) = ${plan.length} combination(s)`,
      `Execution targets: ${executionPlan.length}`,
      `Planned combinations (${plan.length}):`,
      ...installLines,
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

  return {
    args: { inputPaths, agents, scopes, force },
    sources,
  };
}

async function runInstall(
  args: ResolvedInstallArgs,
  sources: PreparedInstallSource[],
  stdin: Readable,
  stdout: Writable,
  cwd: string,
  useSpinner: boolean,
): Promise<InstallExecutionResult[]> {
  const plan = buildInstallPlan(sources, args.agents, args.scopes, cwd);
  const executionPlan = dedupeInstallPlan(plan);

  const execute = async (): Promise<InstallExecutionResult[]> => {
    const results: InstallExecutionResult[] = [];
    for (const item of executionPlan) {
      const result = await installSkill(item.source.makeInput(), {
        agent: item.agent,
        scope: item.scope,
        cwd,
        force: args.force,
      });
      results.push({ ...result, agent: item.agent, scope: item.scope });
    }
    return results;
  };

  if (!useSpinner) {
    return execute();
  }

  const s = spinner({ input: stdin, output: stdout });
  s.start(
    `Installing ${executionPlan.length} target${executionPlan.length === 1 ? "" : "s"}...`,
  );
  try {
    const result = await execute();
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
    const provided = normalizeProvidedInputs(opts);
    if (provided.inputs.length > 0 && parsed.inputPaths.length > 0) {
      throw new InstallError(
        "PATH cannot be used when install input is preset.",
      );
    }

    let wizardUsed = false;

    let resolvedArgs: ResolvedInstallArgs;
    let sources: PreparedInstallSource[];

    if (parsed.agents.length === 0 || parsed.scopes.length === 0) {
      if (!stdinIsTty(stdin)) {
        resolvedArgs = validateRequiredFlags(parsed);
        sources = await resolveInstallSources(
          resolvedArgs.inputPaths,
          stdin,
          provided,
        );
      } else {
        wizardUsed = true;
        const wizardResult = await runInstallWizard(
          parsed,
          stdin,
          stdout,
          cwd,
          provided,
        );
        if (!wizardResult) {
          return 1;
        }
        resolvedArgs = wizardResult.args;
        sources = wizardResult.sources;
      }
    } else {
      resolvedArgs = validateRequiredFlags(parsed);
      sources = await resolveInstallSources(
        resolvedArgs.inputPaths,
        stdin,
        provided,
      );
    }

    const results = await runInstall(
      resolvedArgs,
      sources,
      stdin,
      stdout,
      cwd,
      wizardUsed,
    );

    for (const result of results) {
      stderr.write(
        `Installed ${result.skillId} to ${result.installedTo} (${result.agent}/${result.scope})\n`,
      );
    }
    if (wizardUsed) {
      outro("Done.", { input: stdin, output: stdout });
    }
    return 0;
  } catch (err) {
    stderr.write(`${toErrorMessage(err)}\n`);
    return err instanceof InstallError ? err.exitCode : 1;
  }
}
