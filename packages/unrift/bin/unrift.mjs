#!/usr/bin/env node
"use strict";

// Run the real CLI. It imports @unrift/core's CLI, which installs the
// module-mock loader itself - so this wrapper bin needs no bootstrap logic.
await import("../dist/esm/cli.js");
