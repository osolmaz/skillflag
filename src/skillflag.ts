import process from "node:process";
import type { Readable, Writable } from "node:stream";
import { isCancel, select } from "@clack/prompts";
import type { Option } from "@clack/prompts";

import { SkillflagError, toErrorMessage } from "./core/errors.js";
import { exportSkill } from "./core/export.js";
import { listSkills, listSkillsJson } from "./core/list.js";
import {
  defaultSkillsRoot,
  resolveSkillDirFromRoots,
  resolveSkillsRoot,
} from "./core/paths.js";
import { showSkill } from "./core/show.js";
import { collectSkillEntries, createTarStream } from "./core/tar.js";
import { runInstallCli } from "./install/cli.js";

export type SkillflagOptions = {
  skillsRoot: URL | string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  cwd?: string;
  includeBundledSkill?: boolean;
};

export type SkillflagDispatchOptions = SkillflagOptions & {
  exit?: ((code: number) => void) | false;
};

type SkillAction =
  | { kind: "install"; id?: string; installArgs: string[] }
  | { kind: "list"; json: boolean }
  | { kind: "export"; id: string }
  | { kind: "show"; id: string }
  | { kind: "help" };

const usageLines = [
  "Usage:",
  "  --skill install [<id>] [--agent <agent>] [--scope <scope>] [--force]",
  "  --skill list [--json]",
  "  --skill export <id>",
  "  --skill show <id>",
  "  --skill help",
];

export const SKILLFLAG_HELP_TEXT = [
  "Skillflag help",
  "",
  "Install skillflag globally to get both binaries on your PATH:",
  "  npm install -g skillflag",
  "",
  "Prefer not to install globally? Use npx for one-off runs:",
  "  npx skillflag list",
  "  npx skillflag install --agent codex --scope repo < ./skill.tar",
  "",
  "List available skills:",
  "  tool --skill list",
  "  tool --skill list --json",
  "",
  "Show a skill's documentation:",
  "  tool --skill show <id>",
  "",
  "Export a skill bundle:",
  "  tool --skill export <id>",
  "",
  "Install a skill bundle into an agent:",
  "  tool --skill install [<id>]",
  "  tool --skill export <id> | skill-install --agent <agent> --scope <scope>",
  "",
  "For full details, read docs/SKILLFLAG_SPEC.md.",
].join("\n");

function isSkillActionKind(value: string | undefined): boolean {
  return (
    value === "install" ||
    value === "list" ||
    value === "export" ||
    value === "show" ||
    value === "help"
  );
}

function extractSkillArgs(argv: string[]): string[] {
  const idx = argv.indexOf("--skill");
  if (idx !== -1) {
    return argv.slice(idx + 1);
  }
  if (isSkillActionKind(argv[0])) {
    return argv;
  }
  if (isSkillActionKind(argv[1])) {
    return argv.slice(1);
  }
  if (isSkillActionKind(argv[2])) {
    return argv.slice(2);
  }
  return argv;
}

function parseSkillArgs(argv: string[]): SkillAction {
  const args = extractSkillArgs(argv);
  const action = args[0];
  if (!action || action.startsWith("-")) {
    throw new SkillflagError(
      `Missing --skill action.\n${usageLines.join("\n")}`,
    );
  }

  if (action === "install") {
    const rest = args.slice(1);
    if (rest[0] && !rest[0].startsWith("-")) {
      return { kind: "install", id: rest[0], installArgs: rest.slice(1) };
    }
    return { kind: "install", installArgs: rest };
  }

  if (action === "list") {
    const json = args.slice(1).includes("--json");
    return { kind: "list", json };
  }

  if (action === "help") {
    return { kind: "help" };
  }

  if (action === "export" || action === "show") {
    const id = args[1];
    if (!id || id.startsWith("-")) {
      throw new SkillflagError(`Missing skill id.\n${usageLines.join("\n")}`);
    }
    return { kind: action, id };
  }

  throw new SkillflagError(
    `Unknown --skill action: ${action}.\n${usageLines.join("\n")}`,
  );
}

function stdinIsTty(stream: NodeJS.ReadableStream): boolean {
  return (stream as { isTTY?: boolean }).isTTY === true;
}

async function resolveInstallSkillId(
  action: { id?: string },
  rootDirs: string[],
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): Promise<string> {
  if (action.id) {
    return action.id;
  }

  const skills = await listSkills(rootDirs);
  if (skills.length === 0) {
    throw new SkillflagError("No skills are available to install.");
  }

  if (skills.length === 1) {
    return skills[0].id;
  }

  if (!stdinIsTty(stdin)) {
    throw new SkillflagError(
      "Multiple skills are available; pass an id with --skill install <id>.",
    );
  }

  const options: Option<string>[] = skills.map((skill) => ({
    value: skill.id,
    label: skill.id,
    hint: skill.summary,
  }));
  const selected = await select({
    message: "Select a skill to install",
    options,
    input: stdin as Readable,
    output: stdout as Writable,
  });
  if (isCancel(selected)) {
    throw new SkillflagError("Install cancelled.");
  }
  return selected;
}

async function runInstallAction(
  action: { id?: string; installArgs: string[] },
  rootDirs: string[],
  opts: SkillflagOptions,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
): Promise<number> {
  const skillId = await resolveInstallSkillId(action, rootDirs, stdin, stdout);
  const skillDir = await resolveSkillDirFromRoots(rootDirs, skillId);
  const { entries } = await collectSkillEntries(skillDir, skillId);
  const stream = createTarStream(entries);

  return runInstallCli(["node", "skill-install", ...action.installArgs], {
    stdin: stdin as Readable,
    stdout: stdout as Writable,
    stderr: stderr as Writable,
    cwd: opts.cwd,
    providedInput: { kind: "tar", stream },
    providedSkillId: skillId,
  });
}

export async function handleSkillflag(
  argv: string[],
  opts: SkillflagOptions,
): Promise<number> {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  try {
    const action = parseSkillArgs(argv);
    const skillsRoot = resolveSkillsRoot(opts.skillsRoot);
    const bundledRoot = resolveSkillsRoot(defaultSkillsRoot());
    const includeBundled = opts.includeBundledSkill !== false;
    const rootDirs =
      includeBundled && bundledRoot !== skillsRoot
        ? [skillsRoot, bundledRoot]
        : [skillsRoot];

    if (action.kind === "install") {
      return runInstallAction(action, rootDirs, opts, stdin, stdout, stderr);
    }

    if (action.kind === "list") {
      if (action.json) {
        const payload = await listSkillsJson(rootDirs);
        stdout.write(JSON.stringify(payload));
      } else {
        const skills = await listSkills(rootDirs);
        if (skills.length > 0) {
          const lines = skills.map((skill) =>
            skill.summary ? `${skill.id}\t${skill.summary}` : skill.id,
          );
          stdout.write(`${lines.join("\n")}\n`);
        }
      }
      return 0;
    }

    if (action.kind === "export") {
      const skillDir = await resolveSkillDirFromRoots(rootDirs, action.id);
      await exportSkill(skillDir, action.id, stdout);
      return 0;
    }

    if (action.kind === "help") {
      stdout.write(`${SKILLFLAG_HELP_TEXT}\n`);
      return 0;
    }

    const skillDir = await resolveSkillDirFromRoots(rootDirs, action.id);
    await showSkill(skillDir, action.id, stdout);
    return 0;
  } catch (err) {
    const message = toErrorMessage(err);
    stderr.write(`${message}\n`);
    return err instanceof SkillflagError ? err.exitCode : 1;
  }
}

export async function maybeHandleSkillflag(
  argv: string[],
  opts: SkillflagDispatchOptions,
): Promise<boolean> {
  if (!argv.includes("--skill")) {
    return false;
  }
  const { exit, ...skillOpts } = opts;
  const exitCode = await handleSkillflag(argv, skillOpts);
  if (exit !== false) {
    const exitFn = exit ?? process.exit;
    exitFn(exitCode);
  }
  return true;
}
