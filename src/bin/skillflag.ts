#!/usr/bin/env node
import process from "node:process";

import { handleSkillflag } from "../core/skillflag.js";
import { defaultSkillsRoot } from "../core/paths.js";
import { runInstallCli } from "../install/cli.js";

const args = process.argv.slice(2);
if (args[0] === "install") {
  const exitCode = await runInstallCli([
    process.argv[0],
    process.argv[1],
    ...args.slice(1),
  ]);
  process.exitCode = exitCode;
} else {
  const exitCode = await handleSkillflag(process.argv, {
    skillsRoot: defaultSkillsRoot(),
  });
  process.exitCode = exitCode;
}
