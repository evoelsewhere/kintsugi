#!/usr/bin/env node
import { createDefaultCliDeps, runCli } from "./cli.js";

const exitCode = await runCli(process.argv.slice(2), createDefaultCliDeps());
process.exitCode = exitCode;
