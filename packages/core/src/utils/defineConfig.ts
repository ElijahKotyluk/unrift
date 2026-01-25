export interface UnriftConfigOptions {
  testDir?: string;
  rootDir?: string;
  timeoutMs?: number;
  bail?: boolean;
  pattern?: string;
  includes?: string[];
  excludes?: string[];
  matchers?: string[];
}

export function defineConfig(
  options: UnriftConfigOptions,
): UnriftConfigOptions {
  return options;
}
