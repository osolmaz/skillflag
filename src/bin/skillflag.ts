#!/usr/bin/env node
import process from "node:process";

import { handleSkillflag } from "../core/skillflag.js";
import { defaultSkillsRoot } from "../core/paths.js";

const exitCode = await handleSkillflag(process.argv, {
  skillsRoot: defaultSkillsRoot(),
});
process.exitCode = exitCode;
