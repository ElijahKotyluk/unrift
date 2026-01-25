import { defineConfig } from "@unrift/core";

export default defineConfig({
  testDir: "test",
  timeoutMs: 5000,
  bail: false,
  excludes: ["only", "bail", "fail"],
});
