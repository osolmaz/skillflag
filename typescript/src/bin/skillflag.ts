#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import { handleSkillflag } from "../skillflag.js";
import { defaultSkillsRoot } from "../core/paths.js";

// Conformance/testing hook shared by all implementations in this repo: when
// SKILLFLAG_SKILLS_ROOT is set (path-list separated), use those roots and
// exclude the bundled skill.
const envRoots = process.env.SKILLFLAG_SKILLS_ROOT;
const skillsOptions = envRoots
  ? {
      skillsRoot: envRoots.split(path.delimiter).filter((p) => p.length > 0),
      includeBundledSkill: false,
    }
  : { skillsRoot: defaultSkillsRoot() };

const cliArgs = process.argv.slice(2);
const exitCode =
  cliArgs[0] === "install"
    ? await (
        await import("../install/cli.js")
      ).runInstallCli([
        process.argv[0] ?? "node",
        "skill-install",
        ...cliArgs.slice(1),
      ])
    : await handleSkillflag(process.argv, skillsOptions);
process.exitCode = exitCode;
