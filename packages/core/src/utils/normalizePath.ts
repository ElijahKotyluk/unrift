export function normalizePath(p: string): string {
  // Stable for matching/reporting across platforms
  return p.replace(/\\/g, "/");
}
