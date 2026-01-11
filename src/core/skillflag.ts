import process from "node:process";
import { Writable } from "node:stream";

import { SkillflagError, toErrorMessage } from "./errors.js";
import { exportSkill } from "./export.js";
import { listSkillIds, listSkillsJson } from "./list.js";
import { resolveSkillsRoot } from "./paths.js";
import { showSkill } from "./show.js";

export type SkillflagOptions = {
  skillsRoot: URL | string;
  stdout?: Writable;
  stderr?: Writable;
};

type SkillAction =
  | { kind: "list"; json: boolean }
  | { kind: "export"; id: string }
  | { kind: "show"; id: string };

const usageLines = [
  "Usage:",
  "  --skill list [--json]",
  "  --skill export <id>",
  "  --skill show <id>",
];

function parseSkillArgs(args: string[]): SkillAction {
  const idx = args.indexOf("--skill");
  if (idx === -1) {
    throw new SkillflagError(`Missing --skill flag.\n${usageLines.join("\n")}`);
  }

  const action = args[idx + 1];
  if (!action || action.startsWith("-")) {
    throw new SkillflagError(
      `Missing --skill action.\n${usageLines.join("\n")}`,
    );
  }

  if (action === "list") {
    const json = args.includes("--json");
    const extras = args.filter((_, i) => i !== idx && i !== idx + 1);
    const invalid = extras.filter((arg) => arg !== "--json");
    if (invalid.length > 0) {
      throw new SkillflagError(
        `Unexpected arguments: ${invalid.join(" ")}.\n${usageLines.join("\n")}`,
      );
    }
    return { kind: "list", json };
  }

  if (action === "export" || action === "show") {
    const id = args[idx + 2];
    if (!id || id.startsWith("-")) {
      throw new SkillflagError(
        `Missing skill id.\n${usageLines.join("\n")}`,
      );
    }
    if (args.includes("--json")) {
      throw new SkillflagError(
        `--json is only valid for --skill list.\n${usageLines.join("\n")}`,
      );
    }
    return { kind: action, id };
  }

  throw new SkillflagError(
    `Unknown --skill action: ${action}.\n${usageLines.join("\n")}`,
  );
}

export async function handleSkillflag(
  argv: string[],
  opts: SkillflagOptions,
): Promise<number> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  try {
    const action = parseSkillArgs(argv.slice(2));
    const skillsRoot = resolveSkillsRoot(opts.skillsRoot);

    if (action.kind === "list") {
      if (action.json) {
        const payload = await listSkillsJson(skillsRoot);
        stdout.write(JSON.stringify(payload));
      } else {
        const ids = await listSkillIds(skillsRoot);
        if (ids.length > 0) {
          stdout.write(`${ids.join("\n")}\n`);
        }
      }
      return 0;
    }

    if (action.kind === "export") {
      await exportSkill(skillsRoot, action.id, stdout);
      return 0;
    }

    await showSkill(skillsRoot, action.id, stdout);
    return 0;
  } catch (err) {
    const message = toErrorMessage(err);
    stderr.write(`${message}\n`);
    return err instanceof SkillflagError ? err.exitCode : 1;
  }
}
