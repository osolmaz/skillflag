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
import { installSkill, type InstallInput } from "./install.js";
import {
  AGENTS,
  SCOPES,
  assertAgent,
  assertScope,
  assertSupportedAgentScopes,
  resolveSkillsRoot,
  sharedScopesForAgents,
  type Agent,
  type Scope,
} from "./resolve.js";
import { assertSkillDir, readSkillMetadata } from "./validate.js";
import { uniqueValues } from "../utils/collections.js";

export type InstallCliOptions = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  cwd?: string;
  openPromptTty?: () => PromptTtyStreams | null;
  providedInput?: InstallInput;
  providedInputs?: InstallInput[];
  providedSkillId?: string;
  providedSkillIds?: string[];
  promptApi?: InstallPromptApi;
};

export type InstallPromptApi = {
  confirm: (opts: Parameters<typeof confirm>[0]) => Promise<boolean | symbol>;
  intro: (
    message?: string,
    opts?: { input?: Readable; output?: Writable },
  ) => void;
  isCancel: (value: unknown) => value is symbol;
  multiselect: <Value>(opts: {
    message: string;
    options: Option<Value>[];
    initialValues?: Value[];
    required?: boolean;
    input?: Readable;
    output?: Writable;
  }) => Promise<Value[] | symbol>;
  note: (
    message?: string,
    title?: string,
    opts?: { input?: Readable; output?: Writable },
  ) => void;
  outro: (
    message?: string,
    opts?: { input?: Readable; output?: Writable },
  ) => void;
  spinner: (opts?: { input?: Readable; output?: Writable }) => {
    start: (message?: string) => void;
    stop: (message?: string) => void;
    error: (message?: string) => void;
  };
  text: (opts: Parameters<typeof text>[0]) => Promise<string | symbol>;
};

type ParsedArgs = {
  inputPaths: string[];
  agents: string[];
  scopes: string[];
  force: boolean;
  help: boolean;
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

type PromptTtyStreams = {
  input: Readable;
  output: Writable;
  close: () => void;
};

const agentList = AGENTS.join(", ");
const scopeList = SCOPES.join(", ");

const usageLines = [
  "Usage:",
  "  skill-install [PATH ...] [--agent <agent>[,<agent>...]] [--scope <scope>[,<scope>...]] [--force]",
  "",
  "Input:",
  "  PATH ...            Skill directory path(s) containing SKILL.md.",
  "  stdin tar stream    If PATH is omitted, reads a tar bundle from stdin.",
  "",
  "Options:",
  "  --agent <values>    Target agent(s); repeat or use comma-separated values.",
  `                      Supported agents: ${agentList}`,
  "  --scope <values>    Target scope(s); repeat or use comma-separated values.",
  `                      Supported scopes: ${scopeList}`,
  "  --force             Overwrite destination if it already exists.",
  "  -h, --help          Show this help.",
  "",
  "Behavior:",
  "  If --agent or --scope is missing and an interactive TTY is available,",
  "  the installer launches a wizard to collect missing values.",
];

const usageText = usageLines.join("\n");

const defaultPromptApi: InstallPromptApi = {
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  spinner,
  text,
};

const agentHints: Record<Agent, string> = {
  codex: "OpenAI Codex CLI skills (.codex/skills or CODEX_HOME/skills)",
  claude: "Claude Code skills (.claude/skills)",
  portable: "Portable agents skills (.agents/skills)",
  vscode: "VS Code skills in .github/skills",
  copilot: "GitHub Copilot skills in .github/skills",
  amp: "Amp agent skills (.agents/skills)",
  goose: "Goose agent skills (.agents/skills)",
  opencode: "OpenCode skills (.opencode/skill)",
  factory: "Factory skills (.factory/skills)",
  cursor: "Cursor skills (.cursor/skills)",
};

const agentOptions: Option<Agent>[] = AGENTS.map((agent) => ({
  value: agent,
  label: agent,
  hint: agentHints[agent],
}));

const scopeDescriptions: Record<Scope, string> = {
  repo: "Install to the current git repo root.",
  user: "Install to your user-level skills directory.",
  admin: "Install system-wide under /etc (typically needs sudo).",
  cwd: "Install relative to the current working directory.",
  parent: "Install relative to the parent of the current directory.",
};

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
  let help = false;

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
    if (arg === "--help" || arg === "-h") {
      help = true;
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
    help,
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

function stdinIsPipe(stream: Readable): boolean {
  const tty = (stream as { isTTY?: boolean }).isTTY;
  if (tty === false) {
    return true;
  }
  if (tty === true) {
    return false;
  }
  return (stream as { fd?: unknown }).fd === 0;
}

function openPromptTty(): PromptTtyStreams | null {
  let inputFd: number | undefined;
  let outputFd: number | undefined;

  try {
    inputFd = fs.openSync("/dev/tty", "r");
    outputFd = fs.openSync("/dev/tty", "w");
    const promptInputFd = inputFd;
    const promptOutputFd = outputFd;

    const input = fs.createReadStream("/dev/tty", {
      fd: inputFd,
      autoClose: false,
    });
    const output = fs.createWriteStream("/dev/tty", {
      fd: outputFd,
      autoClose: false,
    });

    let closed = false;
    return {
      input,
      output,
      close: () => {
        if (closed) {
          return;
        }
        closed = true;

        input.destroy();
        output.destroy();
        try {
          fs.closeSync(promptInputFd);
        } catch {
          // Ignore close errors.
        }
        try {
          fs.closeSync(promptOutputFd);
        } catch {
          // Ignore close errors.
        }
      },
    };
  } catch {
    if (inputFd !== undefined) {
      try {
        fs.closeSync(inputFd);
      } catch {
        // Ignore close errors.
      }
    }
    if (outputFd !== undefined) {
      try {
        fs.closeSync(outputFd);
      } catch {
        // Ignore close errors.
      }
    }
    return null;
  }
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
  return uniqueValues(
    values
      .map((value) => asScope(value))
      .filter((value): value is Scope => value !== undefined),
  );
}

function validateRequiredFlags(parsed: ParsedArgs): ResolvedInstallArgs {
  if (parsed.agents.length === 0 || parsed.scopes.length === 0) {
    throw new InstallError(`Missing required flags.\n${usageText}`);
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
  promptInput: Readable,
  promptOutput: Writable,
  promptApi: InstallPromptApi,
  message = "Install cancelled.",
): null {
  promptApi.outro(message, { input: promptInput, output: promptOutput });
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

  throw new InstallError(`Missing PATH or tar stream on stdin.\n${usageText}`);
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

function assertNoInstallCollisions(plan: InstallPlanItem[]): void {
  const plansByDestination = new Map<string, InstallPlanItem[]>();
  for (const item of plan) {
    const entries = plansByDestination.get(item.destination) ?? [];
    entries.push(item);
    plansByDestination.set(item.destination, entries);
  }

  const collisions = [...plansByDestination.entries()]
    .filter(([, items]) => items.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));

  if (collisions.length === 0) {
    return;
  }

  const lines = ["Install destination collisions detected:"];
  for (const [destination, items] of collisions) {
    lines.push(`- ${destination}`);
    for (const item of items) {
      lines.push(
        `  - ${item.source.skillIdHint} @ ${item.agent}/${item.scope} (source: ${item.source.source})`,
      );
    }
  }
  lines.push(
    "Resolve collisions by changing skill IDs, sources, --agent, or --scope so each combination has a unique destination.",
  );
  throw new InstallError(lines.join("\n"));
}

async function runInstallWizard(
  parsed: ParsedArgs,
  stdin: Readable,
  promptInput: Readable,
  promptOutput: Writable,
  cwd: string,
  provided: ProvidedInstallInputs,
  promptApi: InstallPromptApi,
): Promise<WizardResult | null> {
  promptApi.intro("skill-install wizard", {
    input: promptInput,
    output: promptOutput,
  });

  let inputPaths = parsed.inputPaths;
  if (
    provided.inputs.length === 0 &&
    inputPaths.length === 0 &&
    !stdinHasData(stdin)
  ) {
    const defaultPath = cwd;
    const pathValue = await promptApi.text({
      message:
        "PATH to skill directory (comma-separated for multiple, defaults to current directory)",
      placeholder: defaultPath,
      defaultValue: defaultPath,
      validate: validatePathPrompt,
      input: promptInput,
      output: promptOutput,
    });
    if (promptApi.isCancel(pathValue)) {
      return cancelWizard(promptInput, promptOutput, promptApi);
    }
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
    const agentValues = await promptApi.multiselect({
      message: "Agent targets",
      options: agentOptions,
      initialValues: parsedAgents.length > 0 ? parsedAgents : [],
      required: true,
      input: promptInput,
      output: promptOutput,
    });
    if (promptApi.isCancel(agentValues)) {
      return cancelWizard(promptInput, promptOutput, promptApi);
    }
    agents = uniqueValues(agentValues.map((value) => assertAgent(value)));
  }

  const supportedScopes = sharedScopesForAgents(agents);
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
    const scopeValues = await promptApi.multiselect({
      message: "Scope targets",
      options: scopeOptions,
      initialValues: parsedScopes.length > 0 ? parsedScopes : [],
      required: true,
      input: promptInput,
      output: promptOutput,
    });
    if (promptApi.isCancel(scopeValues)) {
      return cancelWizard(promptInput, promptOutput, promptApi);
    }
    scopes = uniqueValues(scopeValues.map((scope) => assertScope(scope)));
  }

  const forceValue = await promptApi.confirm({
    message: "Force overwrite if the destination already exists? (--force)",
    initialValue: parsed.force,
    input: promptInput,
    output: promptOutput,
  });
  if (promptApi.isCancel(forceValue)) {
    return cancelWizard(promptInput, promptOutput, promptApi);
  }
  const force = forceValue;

  assertSupportedAgentScopes(agents, scopes);

  const sources = await resolveInstallSources(inputPaths, stdin, provided);
  const plan = buildInstallPlan(sources, agents, scopes, cwd);
  assertNoInstallCollisions(plan);

  const sourceLines = sources.map(
    (source) => `${source.skillIdHint} <= ${source.source}`,
  );
  const installLines = plan.map(
    (item) =>
      `${item.source.skillIdHint} @ ${item.agent}/${item.scope} -> ${item.destination}`,
  );

  promptApi.note(
    [
      `Sources (${sources.length}):`,
      ...sourceLines,
      `Agents (${agents.length}): ${agents.join(", ")}`,
      `Scopes (${scopes.length}): ${scopes.join(", ")}`,
      `Matrix: ${sources.length} skill(s) × ${agents.length} agent(s) × ${scopes.length} scope(s) = ${plan.length} combination(s)`,
      `Execution targets: ${plan.length}`,
      `Planned combinations (${plan.length}):`,
      ...installLines,
      `Force: ${force ? "yes" : "no"}`,
    ].join("\n"),
    "Install summary",
    { input: promptInput, output: promptOutput },
  );

  const confirmed = await promptApi.confirm({
    message: "Proceed with install?",
    initialValue: true,
    input: promptInput,
    output: promptOutput,
  });
  if (promptApi.isCancel(confirmed) || !confirmed) {
    return cancelWizard(promptInput, promptOutput, promptApi);
  }

  return {
    args: { inputPaths, agents, scopes, force },
    sources,
  };
}

async function runInstall(
  args: ResolvedInstallArgs,
  sources: PreparedInstallSource[],
  promptInput: Readable,
  promptOutput: Writable,
  cwd: string,
  useSpinner: boolean,
  promptApi: InstallPromptApi,
): Promise<InstallExecutionResult[]> {
  const plan = buildInstallPlan(sources, args.agents, args.scopes, cwd);
  assertNoInstallCollisions(plan);

  const execute = async (): Promise<InstallExecutionResult[]> => {
    const results: InstallExecutionResult[] = [];
    for (const item of plan) {
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

  const s = promptApi.spinner({ input: promptInput, output: promptOutput });
  s.start(`Installing ${plan.length} target${plan.length === 1 ? "" : "s"}...`);
  try {
    const result = await execute();
    s.stop("Install complete.");
    return result;
  } catch (err) {
    s.error("Install failed.");
    throw err;
  }
}

async function drainStream(stream: Readable): Promise<void> {
  try {
    for await (const chunk of stream) {
      // Drain source stdin so upstream writers do not hit EPIPE when we exit early.
      void chunk;
    }
  } catch {
    // Ignore drain failures; original command error should still be reported.
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
  const promptApi = opts.promptApi ?? defaultPromptApi;
  const openPromptTtyFn = opts.openPromptTty ?? openPromptTty;

  let promptInput = stdin;
  let promptOutput = stdout;
  let closePromptTty: (() => void) | null = null;

  try {
    const parsed = parseArgs(argv.slice(2));
    if (parsed.help) {
      stdout.write(`${usageText}\n`);
      if (stdinIsPipe(stdin)) {
        await drainStream(stdin);
      }
      return 0;
    }

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
      if (stdinIsTty(stdin)) {
        wizardUsed = true;
      } else if (stdinIsPipe(stdin) && stdinHasData(stdin)) {
        const promptTty = openPromptTtyFn();
        if (promptTty) {
          wizardUsed = true;
          promptInput = promptTty.input;
          promptOutput = promptTty.output;
          closePromptTty = promptTty.close;
        }
      }

      if (!wizardUsed) {
        resolvedArgs = validateRequiredFlags(parsed);
        sources = await resolveInstallSources(
          resolvedArgs.inputPaths,
          stdin,
          provided,
        );
      } else {
        const wizardResult = await runInstallWizard(
          parsed,
          stdin,
          promptInput,
          promptOutput,
          cwd,
          provided,
          promptApi,
        );
        if (!wizardResult) {
          if (stdinIsPipe(stdin)) {
            await drainStream(stdin);
          }
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
      promptInput,
      promptOutput,
      cwd,
      wizardUsed,
      promptApi,
    );

    for (const result of results) {
      stderr.write(
        `Installed ${result.skillId} to ${result.installedTo} (${result.agent}/${result.scope})\n`,
      );
    }
    if (wizardUsed) {
      promptApi.outro("Done.", { input: promptInput, output: promptOutput });
    }
    return 0;
  } catch (err) {
    if (stdinIsPipe(stdin)) {
      await drainStream(stdin);
    }
    stderr.write(`${toErrorMessage(err)}\n`);
    return err instanceof InstallError ? err.exitCode : 1;
  } finally {
    closePromptTty?.();
  }
}
