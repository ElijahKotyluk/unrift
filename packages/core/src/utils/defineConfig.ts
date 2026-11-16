import type { CoverageReporter, CoverageThresholds } from "../coverage/report";

export interface UnriftCoverageOptions {
  /** Same as --coverage. */
  enabled?: boolean;
  /** Only report files matching one of these, relative to the config file. */
  include?: string[];
  exclude?: string[];
  /** Defaults to "text". */
  reporter?: CoverageReporter | CoverageReporter[];
  /** Where lcov and json reports go. Defaults to "coverage". */
  reportsDirectory?: string;
  /** The run fails when a percentage is under its threshold. */
  thresholds?: CoverageThresholds;
}

export interface UnriftConfigOptions {
  testDir?: string;
  timeoutMs?: number;
  bail?: boolean;
  retries?: number;
  pattern?: string;
  includes?: string[];
  excludes?: string[];
  matchers?: string[];
  coverage?: UnriftCoverageOptions;
}

export function defineConfig(
  options: UnriftConfigOptions,
): UnriftConfigOptions {
  return options;
}
