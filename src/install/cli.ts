import process from "node:process";
import fs from "node:fs";
import { Readable } from "node:stream";

import { InstallError, toErrorMessage } from "./errors.js";
import { assertAgent, assertScope, installSkill } from "./install.js";

export type InstallCliOptions = {
  stdin?: Readable;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  cwd?: string;
};

type ParsedArgs = {
  inputPath?: string;
  agent: string;
  scope: string;
  force: boolean;
};

const usageLines = [
  "Usage:",
  "  skill-install [PATH] --agent <codex|claude> --scope <repo|user|cwd|parent|admin>",
  "  skill-install --agent <codex|claude> --scope <repo|user|cwd|parent|admin> < tar",
];

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

  if (!agent || !scope) {
    throw new InstallError(`Missing required flags.\n${usageLines.join("\n")}`);
  }

  return { inputPath, agent, scope, force };
}

function stdinHasData(stream: Readable): boolean {
  if (typeof (stream as { isTTY?: boolean }).isTTY === "boolean") {
    return !(stream as { isTTY?: boolean }).isTTY;
  }
  return !stream.readableEnded;
}

export async function runInstallCli(
  argv: string[],
  opts: InstallCliOptions = {},
): Promise<number> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const stdin = opts.stdin ?? process.stdin;
  const cwd = opts.cwd ?? process.cwd();

  try {
    const parsed = parseArgs(argv.slice(2));
    const agent = assertAgent(parsed.agent);
    const scope = assertScope(parsed.scope);

    let input:
      | { kind: "dir"; dir: string }
      | { kind: "tar"; stream: Readable };

    if (parsed.inputPath) {
      const stat = fs.statSync(parsed.inputPath);
      if (!stat.isDirectory()) {
        throw new InstallError("PATH must be a directory containing SKILL.md.");
      }
      input = { kind: "dir", dir: parsed.inputPath };
    } else if (stdinHasData(stdin)) {
      input = { kind: "tar", stream: stdin };
    } else {
      throw new InstallError(`Missing PATH or tar stream on stdin.\n${usageLines.join("\n")}`);
    }

    const result = await installSkill(input, {
      agent,
      scope,
      cwd,
      force: parsed.force,
    });

    stderr.write(
      `Installed ${result.skillId} to ${result.installedTo}\n`,
    );
    return 0;
  } catch (err) {
    stderr.write(`${toErrorMessage(err)}\n`);
    return err instanceof InstallError ? err.exitCode : 1;
  }
}
