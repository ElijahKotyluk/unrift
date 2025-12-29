interface UnriftConfigOptions {
  testDir?: string;
  rootDir?: string;
  timeoutMs?: number;
  bail?: boolean;
  pattern?: string;
  includes?: string[];
  excludes?: string[];
  matchers?: string[];
}

function defineConfig(options: UnriftConfigOptions): UnriftConfigOptions {
  return options;
}

export { defineConfig, type UnriftConfigOptions };
