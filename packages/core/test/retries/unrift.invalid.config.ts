import { defineConfig, type UnriftConfigOptions } from "@unrift/core";

// Fixture config for the retries test. "3" is what a JSON config could give.
export default defineConfig({
  testDir: ".",
  retries: "3" as unknown as UnriftConfigOptions["retries"],
});
