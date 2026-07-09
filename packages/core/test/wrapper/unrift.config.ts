import { defineConfig } from "@unrift/core";

// Fixture config for the wrapper-bin integration test. Spawned explicitly by
// test/internal/test/wrapper.spec.ts through the `unrift` wrapper bin - not
// part of normal test discovery.
export default defineConfig({ testDir: "." });
