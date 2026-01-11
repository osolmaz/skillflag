import process from "node:process";
import { SkillflagError, toErrorMessage } from "./errors.js";
import { exportSkill } from "./export.js";
import { listSkills, listSkillsJson } from "./list.js";
import {
  defaultSkillsRoot,
  resolveSkillDirFromRoots,
  resolveSkillsRoot,
} from "./paths.js";
import { showSkill } from "./show.js";

export type SkillflagOptions = {
  skillsRoot: URL | string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  includeBundledSkill?: boolean;
};

export type SkillflagDispatchOptions = SkillflagOptions & {
  exit?: ((code: number) => void) | false;
};

type SkillAction =
  | { kind: "list"; json: boolean }
  | { kind: "export"; id: string }
  | { kind: "show"; id: string }
  | { kind: "help" };

const usageLines = [
  "Usage:",
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
  "  npx skillflag --skill list",
  "  npx skillflag install --agent codex --scope repo ./skills/your-skill",
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
  "  tool --skill export <id> | skill-install --agent <agent> --scope <scope>",
  "  skillflag install --agent <agent> --scope <scope> <path-or-tar>",
  "",
  "For full details, read docs/SKILLFLAG_SPEC.md.",
].join("\n");

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
    const json = args.slice(idx + 2).includes("--json");
    return { kind: "list", json };
  }

  if (action === "help") {
    return { kind: "help" };
  }

  if (action === "export" || action === "show") {
    const id = args[idx + 2];
    if (!id || id.startsWith("-")) {
      throw new SkillflagError(`Missing skill id.\n${usageLines.join("\n")}`);
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
    const bundledRoot = resolveSkillsRoot(defaultSkillsRoot());
    const includeBundled = opts.includeBundledSkill !== false;
    const rootDirs =
      includeBundled && bundledRoot !== skillsRoot
        ? [skillsRoot, bundledRoot]
        : [skillsRoot];

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
