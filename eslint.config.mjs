import globals from "globals";
import js from "@eslint/js";
import tsEslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import { defineConfig } from "eslint/config";

export default defineConfig(
  {
    files: ["packages/*/test/**.*.*"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    ignores: [
      "node_modules",
      "!.*",
      "**/dist",
      "**/build",
      "**/coverage",
      "**/out",
      "**/lib",
      "**/test/**.*",
    ],
  },
  {
    extends: [js.configs.recommended, ...tsEslint.configs.recommended],
    ignores: ["**/test/**"],
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-this-alias": "off",
      "no-unexpected-multiline": "error",
    },
  },
  eslintPluginPrettierRecommended,
);
