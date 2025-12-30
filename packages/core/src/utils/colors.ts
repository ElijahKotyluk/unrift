const enabled =
  process.stdout.isTTY &&
  process.env.NO_COLOR !== "1" &&
  process.env.NO_COLOR !== "true";

function wrap(code: number) {
  return (text: string) =>
    enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const colors = {
  green: wrap(32),
  red: wrap(31),
  yellow: wrap(33),
  bold: wrap(1),
};
