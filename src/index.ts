#!/usr/bin/env bun

export * from "./constants.js";
export * from "./tasks.js";
export * from "./status.js";
export * from "./dashboard.js";
export * from "./plan.js";
export * from "./notify.js";
export * from "./cli.js";

import { main } from "./cli.js";

main().catch(console.error);
