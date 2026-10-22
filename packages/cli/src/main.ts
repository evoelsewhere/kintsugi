#!/usr/bin/env node
import { createDefaultCliDeps, runCliWithSignals } from "./cli.js";

const exitCode = await runCliWithSignals(process.argv.slice(2), createDefaultCliDeps());
process.exitCode = exitCode;
