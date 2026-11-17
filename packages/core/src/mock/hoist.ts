/**
 * Finds `mock.module("spec", factory)` and `mock.unmock("spec")` calls in a
 * test file's source, so the transform can hoist the top-level ones above
 * the file's imports and point every import of `spec` at a mock.
 *
 * Not a parser: it skips strings, comments, template literals and regexes
 * and counts brackets, which is all it needs to find the calls and where
 * they end.
 */

export type MockCall = {
  kind: "module" | "unmock";
  spec: string;
  /** Start of the statement, including a leading `await` */
  start: number;
  /** End of the call, including a trailing `;` */
  end: number;
  /** The string literal holding the specifier, quotes included */
  specStart: number;
  specEnd: number;
  /** A statement at the top of the file, not inside a function or block */
  topLevel: boolean;
};

const IDENT = /[A-Za-z0-9_$]/;
// A line ending in one of these goes on to the next
const CONTINUES = /[=,.([{+\-*/%&|^!?:<>~]/;
const CALL = /mock\s*\.\s*(module|unmock)\s*\(\s*/y;
// The `unmock` export, called on its own
const UNMOCK = /unmock\s*\(\s*/y;
// Before a `(`, it holds an `if` or loop condition, and the body may follow
const CONTROL = /(?:^|[^\w$.])(?:if|for|while|with|for\s+await)\s*$/;
// After these the next statement is the body of an `else` or `do`
const ELSE_DO = /(?:^|[^\w$.])(?:else|do)$/;

// After these a `/` starts a regex, not a division
const BEFORE_REGEX = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const KEYWORDS_BEFORE_REGEX =
  /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new)$/;

export function findMockCalls(source: string): MockCall[] {
  const calls: MockCall[] = [];
  const n = source.length;
  let depth = 0;
  // Last character that wasn't whitespace or a comment, and whether a
  // newline came after it
  let prev = "";
  let prevEnd = 0;
  let newline = true;
  let i = 0;
  // Open brackets, true for the `(` of an `if` or loop
  const brackets: boolean[] = [];
  // End of the last `if` or loop condition, a statement there is its body
  let controlEnd = -1;

  const skipString = (quote: string) => {
    i++;
    while (i < n && source[i] !== quote) {
      if (source[i] === "\\") i++;
      else if (source[i] === "\n") break;
      i++;
    }
    i++;
  };

  const skipTemplate = () => {
    i++;
    while (i < n && source[i] !== "`") {
      if (source[i] === "\\") i += 2;
      else if (source[i] === "$" && source[i + 1] === "{") {
        i += 2;
        skipCode("}");
        i++;
      } else i++;
    }
    i++;
  };

  const skipRegex = () => {
    i++;
    let inClass = false;
    while (i < n && source[i] !== "\n") {
      const c = source[i];
      if (c === "\\") i++;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
      i++;
    }
    i++;
    while (i < n && IDENT.test(source[i])) i++;
  };

  // Skips comments and whitespace. Returns false if there was none.
  const skipTrivia = (): boolean => {
    const from = i;
    while (i < n) {
      const c = source[i];
      if (c === "\n") {
        newline = true;
        i++;
      } else if (c === " " || c === "\t" || c === "\r") i++;
      else if (c === "/" && source[i + 1] === "/") {
        while (i < n && source[i] !== "\n") i++;
      } else if (c === "/" && source[i + 1] === "*") {
        const close = source.indexOf("*/", i + 2);
        i = close === -1 ? n : close + 2;
      } else break;
    }
    return i > from;
  };

  const regexAllowed = () =>
    prev === "" ||
    BEFORE_REGEX.has(prev) ||
    KEYWORDS_BEFORE_REGEX.test(source.slice(Math.max(0, prevEnd - 7), prevEnd));

  // A statement after `if (...)`, `else` or a loop is its body
  const isBody = (end: number) =>
    end === controlEnd || ELSE_DO.test(source.slice(Math.max(0, end - 5), end));

  const statementStart = () =>
    !isBody(prevEnd) &&
    (prev === "" ||
      prev === ";" ||
      prev === "}" ||
      (newline && !CONTINUES.test(prev)));

  // Reads a string literal at i, or returns null
  const readSpec = (): { spec: string; start: number; end: number } | null => {
    const quote = source[i];
    if (quote !== '"' && quote !== "'") return null;
    const start = i;
    skipString(quote);
    const raw = source.slice(start + 1, i - 1);
    if (raw.includes("\\") || raw.includes("\n")) return null;
    return { spec: raw, start, end: i };
  };

  // Scans code until `close` at the current depth (or the end)
  function skipCode(close?: string): void {
    const base = depth;
    while (i < n) {
      if (skipTrivia()) continue;
      const c = source[i];

      if (close && c === close && depth === base) return;

      if (c === '"' || c === "'") {
        skipString(c);
      } else if (c === "`") {
        skipTemplate();
      } else if (c === "/" && regexAllowed()) {
        skipRegex();
      } else if (c === "(" || c === "[" || c === "{") {
        brackets.push(
          c === "(" && CONTROL.test(source.slice(Math.max(0, i - 20), i)),
        );
        depth++;
        i++;
      } else if (c === ")" || c === "]" || c === "}") {
        const control = brackets.pop();
        depth--;
        i++;
        if (control && c === ")") controlEnd = i;
      } else if (c === "m" && (i === 0 || !IDENT.test(source[i - 1]))) {
        CALL.lastIndex = i;
        const m = CALL.exec(source);
        if (m) {
          tryCall(m[1] as MockCall["kind"], CALL.lastIndex);
          continue;
        }
        i++;
      } else if (
        c === "u" &&
        prev !== "." &&
        (i === 0 || !IDENT.test(source[i - 1]))
      ) {
        UNMOCK.lastIndex = i;
        if (UNMOCK.exec(source)) {
          tryCall("unmock", UNMOCK.lastIndex);
          continue;
        }
        i++;
      } else {
        i++;
      }

      prev = source[i - 1];
      prevEnd = i;
      newline = false;
    }
  }

  function tryCall(kind: MockCall["kind"], argsAt: number): void {
    const callStart = i;
    const topLevel = depth === 0;
    let start = callStart;
    let atStatement = statementStart();

    // `await mock.module(...)` at the top of the file
    const before = source.slice(0, callStart).match(/(?:^|[^\w$.])await\s+$/);
    if (before) {
      const awaitAt =
        callStart - before[0].length + (before[0].startsWith("await") ? 0 : 1);
      start = awaitAt;
      atStatement = statementStartAt(awaitAt);
    }

    i = argsAt;
    const spec = readSpec();

    // The rest of the call: up to its closing paren
    depth++;
    skipCode(")");
    depth--;
    i++;

    let end = i;
    const save = i;
    const saveNewline = newline;
    newline = false;
    skipTrivia();
    if (source[i] === ";") end = i + 1;
    i = save;
    newline = saveNewline;

    prev = ")";
    prevEnd = i;
    newline = false;

    if (!spec) return;

    calls.push({
      kind,
      spec: spec.spec,
      start,
      end,
      specStart: spec.start,
      specEnd: spec.end,
      topLevel: topLevel && atStatement,
    });
  }

  // Whether `at` begins a statement, looking back past whitespace and comments
  function statementStartAt(at: number): boolean {
    // Blank out comments, keeping offsets
    const text = source
      .slice(0, at)
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
    const trimmed = text.trimEnd();
    if (trimmed === "") return true;
    if (isBody(trimmed.length)) return false;
    const last = trimmed[trimmed.length - 1];
    if (last === ";" || last === "}") return true;
    return (
      text.length > trimmed.length &&
      text.slice(trimmed.length).includes("\n") &&
      !CONTINUES.test(last)
    );
  }

  skipCode();

  return calls;
}
