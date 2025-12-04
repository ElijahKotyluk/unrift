interface UnriftConfigOptions {
  testDir?: string;
  rootDir?: string;
  timeoutMs?: number;
  bail?: boolean;
  includes?: string[];
  excludes?: string[];
}

function defineConfig(options: UnriftConfigOptions): UnriftConfigOptions {
  return options;
}

export { defineConfig, type UnriftConfigOptions };
