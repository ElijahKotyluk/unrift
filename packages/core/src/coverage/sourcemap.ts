export type RawSourceMap = {
  sources: string[];
  mappings: string;
};

/** One mapping: a spot in the generated code and where it came from. */
export type Mapping = {
  genLine: number;
  genColumn: number;
  source: number;
  line: number;
  column: number;
};

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map([...BASE64].map((c, i) => [c, i]));

/** Decodes the `mappings` of a v3 source map. Lines and columns are 0-based. */
export function decodeMappings(mappings: string): Mapping[] {
  const out: Mapping[] = [];
  let genLine = 0;
  let genColumn = 0;
  let source = 0;
  let line = 0;
  let column = 0;
  let i = 0;

  const readVlq = (): number => {
    let result = 0;
    let shift = 0;
    let digit: number;

    do {
      const value = BASE64_VALUE.get(mappings[i++]);

      if (value === undefined) throw new Error("Invalid source map mappings");

      digit = value;
      result += (digit & 31) * 2 ** shift;
      shift += 5;
    } while (digit & 32);

    return result & 1 ? -(result - 1) / 2 : result / 2;
  };

  while (i < mappings.length) {
    const c = mappings[i];

    if (c === ";") {
      genLine++;
      genColumn = 0;
      i++;
      continue;
    }

    if (c === ",") {
      i++;
      continue;
    }

    genColumn += readVlq();

    // A segment of 1 has no source, it's generated code
    if (i < mappings.length && mappings[i] !== "," && mappings[i] !== ";") {
      source += readVlq();
      line += readVlq();
      column += readVlq();

      // Name index, not needed
      if (i < mappings.length && mappings[i] !== "," && mappings[i] !== ";") {
        readVlq();
      }

      out.push({ genLine, genColumn, source, line, column });
    }
  }

  return out;
}

const INLINE_MAP_RE =
  /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/;

/** The inline source map at the end of `code`, if it has one. */
export function readInlineSourceMap(code: string): RawSourceMap | null {
  const match = INLINE_MAP_RE.exec(code);

  if (!match) return null;

  try {
    const map = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));

    if (!Array.isArray(map.sources) || typeof map.mappings !== "string") {
      return null;
    }

    return map as RawSourceMap;
  } catch {
    return null;
  }
}

/** Offset where each line starts, so a line and column become an offset. */
export function lineStarts(code: string): number[] {
  const starts = [0];

  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) starts.push(i + 1);
  }

  return starts;
}
