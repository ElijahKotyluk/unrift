export interface UnriftConfigOptions {
  testDir?: string;
  timeoutMs?: number;
  bail?: boolean;
  retries?: number;
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
