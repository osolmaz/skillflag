#!/usr/bin/env node
import process from "node:process";

import { runInstallCli } from "../install/cli.js";

const exitCode = await runInstallCli(process.argv);
process.exitCode = exitCode;
