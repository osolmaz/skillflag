#!/usr/bin/env node
import process from "node:process";

import { handleSkillflag } from "../skillflag.js";
import { defaultSkillsRoot } from "../core/paths.js";
import { runInstallCli } from "../install/cli.js";

const cliArgs = process.argv.slice(2);
const exitCode =
  cliArgs[0] === "install"
    ? await runInstallCli([
        process.argv[0] ?? "node",
        "skill-install",
        ...cliArgs.slice(1),
      ])
    : await handleSkillflag(process.argv, {
        skillsRoot: defaultSkillsRoot(),
      });
process.exitCode = exitCode;
