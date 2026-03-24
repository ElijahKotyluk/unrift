const enabled =
  process.stdout.isTTY &&
  process.env.NO_COLOR !== "1" &&
  process.env.NO_COLOR !== "true";

function wrap(code: string) {
  return (text: string) => (enabled ? `\x1b[${code}m${text}\x1b[0m` : text);
}

function compose(...codes: string[]) {
  return (text: string) =>
    enabled ? `\x1b[${codes.join(";")}m${text}\x1b[0m` : text;
}

export const colors = {
  // Basic colors
  green: wrap("32"),
  red: wrap("31"),
  yellow: wrap("33"),
  cyan: wrap("36"),
  magenta: wrap("35"),
  white: wrap("37"),

  // Modifiers
  bold: wrap("1"),
  dim: wrap("2"),
  italic: wrap("3"),
  underline: wrap("4"),
  strikethrough: wrap("9"),

  // Bright colors
  gray: wrap("90"),

  // Backgrounds
  bgRed: wrap("41"),
  bgGreen: wrap("42"),
  bgYellow: wrap("43"),
  bgCyan: wrap("46"),

  // Composites
  boldGreen: compose("1", "32"),
  boldRed: compose("1", "31"),
  boldYellow: compose("1", "33"),
  boldCyan: compose("1", "36"),
  boldDim: compose("1", "2"),

  // Badge-style (white on colored background)
  badgePass: compose("1", "30", "42"),
  badgeFail: compose("1", "37", "41"),
  badgeSkip: compose("1", "30", "43"),
  badgeTodo: compose("1", "35"),
};
