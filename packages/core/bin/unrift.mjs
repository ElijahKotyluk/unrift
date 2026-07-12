#!/usr/bin/env node
"use strict";

// Run the real CLI. The CLI installs the module-mock loader itself
// (see src/mock/register-loader.ts), so this bin stays a thin entry point.
await import("../dist/esm/cli.js");
