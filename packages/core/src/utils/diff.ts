import { colors } from "./colors";

function formatValue(value: unknown, indent: number = 2): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function")
    return `[Function: ${value.name || "anonymous"}]`;

  if (value instanceof Date) return `Date(${value.toISOString()})`;
  if (value instanceof RegExp) return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";

    const padding = " ".repeat(indent);
    const items = value.map((v) => `${padding}${formatValue(v, indent + 2)}`);

    return `[\n${items.join(",\n")}\n${" ".repeat(indent - 2)}]`;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);

    if (keys.length === 0) return "{}";

    const padding = " ".repeat(indent);
    const entries = keys.map(
      (k) =>
        `${padding}${k}: ${formatValue((value as Record<string, unknown>)[k], indent + 2)}`,
    );

    return `{\n${entries.join(",\n")}\n${" ".repeat(indent - 2)}}`;
  }

  return String(value);
}

function diffArrays(received: unknown[], expected: unknown[]): string {
  const len = Math.max(received.length, expected.length);
  const lines: string[] = [];

  for (let i = 0; i < len; i++) {
    const inReceived = i < received.length;
    const inExpected = i < expected.length;

    if (inReceived && inExpected) {
      const rv = formatValue(received[i]);
      const ev = formatValue(expected[i]);

      if (rv !== ev) {
        lines.push(colors.red(`  - [${i}]: ${rv}`));
        lines.push(colors.green(`  + [${i}]: ${ev}`));
      } else {
        lines.push(`    [${i}]: ${rv}`);
      }
    } else if (inReceived) {
      lines.push(colors.red(`  - [${i}]: ${formatValue(received[i])}`));
    } else {
      lines.push(colors.green(`  + [${i}]: ${formatValue(expected[i])}`));
    }
  }

  return lines.join("\n");
}

function diffObjects(
  received: Record<string, unknown>,
  expected: Record<string, unknown>,
): string {
  const allKeys = new Set([...Object.keys(received), ...Object.keys(expected)]);

  const lines: string[] = [];

  for (const key of allKeys) {
    const inReceived = Object.hasOwn(received, key);
    const inExpected = Object.hasOwn(expected, key);

    if (inReceived && inExpected) {
      const rv = formatValue(received[key]);
      const ev = formatValue(expected[key]);

      if (rv !== ev) {
        lines.push(colors.red(`  - ${key}: ${rv}`));
        lines.push(colors.green(`  + ${key}: ${ev}`));
      } else {
        lines.push(`    ${key}: ${rv}`);
      }
    } else if (inReceived) {
      lines.push(colors.red(`  - ${key}: ${formatValue(received[key])}`));
    } else {
      lines.push(colors.green(`  + ${key}: ${formatValue(expected[key])}`));
    }
  }

  return lines.join("\n");
}

export function formatDiff(received: unknown, expected: unknown): string {
  // For arrays, provide per-element diffing
  if (Array.isArray(received) && Array.isArray(expected)) {
    const diff = diffArrays(received, expected);

    return (
      `\n${colors.red("- Received")} / ${colors.green("+ Expected")}\n\n` + diff
    );
  }

  // For objects, provide a structural diff
  if (
    received !== null &&
    expected !== null &&
    typeof received === "object" &&
    typeof expected === "object" &&
    !Array.isArray(received) &&
    !Array.isArray(expected) &&
    !(received instanceof Date) &&
    !(expected instanceof Date) &&
    !(received instanceof RegExp) &&
    !(expected instanceof RegExp)
  ) {
    const diff = diffObjects(
      received as Record<string, unknown>,
      expected as Record<string, unknown>,
    );

    return (
      `\n${colors.red("- Received")} / ${colors.green("+ Expected")}\n\n` + diff
    );
  }

  // Default: simple received/expected display
  return (
    `\n  ${colors.red("Received:")} ${formatValue(received)}` +
    `\n  ${colors.green("Expected:")} ${formatValue(expected)}`
  );
}
