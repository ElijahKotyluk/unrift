import { defineConfig } from "@unrift/core";

// Fixture config for the retries test. Spawned by test/internal/test/retries.spec.ts.
export default defineConfig({ testDir: ".", retries: 1 });
