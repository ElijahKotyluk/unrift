import { types } from "node:util";

import { isErrorLike } from "../utils/helpers";

/**
 * Turns a value into the text stored in a snapshot. Follows Jest's format
 * (sorted keys, trailing commas, `Map {`, `[Error: x]`) so snapshots read the
 * same, but it's our own printer, not pretty-format.
 */
export function serialize(value: unknown): string {
  return print(value, "", []);
}

function print(value: unknown, indent: string, parents: object[]): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  switch (typeof value) {
    case "boolean":
      return String(value);
    case "number":
      return Object.is(value, -0) ? "-0" : String(value);
    case "bigint":
      return `${value}n`;
    case "string":
      // Escaped so a quote in the value can't pass for the end of the string,
      // like ["a", "b"] vs ['a",\n  "b']. Jest's format before 29 did the same.
      return `"${value.replace(/["\\]/g, "\\$&")}"`;
    case "symbol":
      return value.toString();
    case "function":
      return `[Function ${value.name || "anonymous"}]`;
  }

  const obj = value as object;

  // A stack of parents, not a seen-set, so a value used twice that isn't
  // circular still prints in full both times.
  if (parents.includes(obj)) return "[Circular]";

  // util.types checks the internal slot, so values from another realm (vm,
  // a worker) still print their contents instead of `Map {}`.
  if (types.isDate(obj)) {
    const time = Date.prototype.getTime.call(obj);

    return Number.isNaN(time)
      ? "Date { NaN }"
      : Date.prototype.toISOString.call(obj);
  }

  if (types.isRegExp(obj)) return RegExp.prototype.toString.call(obj);

  if (types.isBoxedPrimitive(obj)) {
    return `[${constructorName(obj)}: ${print(obj.valueOf(), indent, parents)}]`;
  }

  if (isErrorLike(obj)) {
    return obj.message ? `[${obj.name}: ${obj.message}]` : `[${obj.name}]`;
  }

  const inner = indent + "  ";
  const next = [...parents, obj];
  const block = (
    prefix: string,
    open: string,
    close: string,
    items: string[],
  ) =>
    items.length === 0
      ? `${prefix}${open}${close}`
      : `${prefix}${open}\n${items.map((item) => `${inner}${item},\n`).join("")}${indent}${close}`;

  if (Array.isArray(obj)) {
    const name = constructorName(obj);
    const items: string[] = [];

    // A hole isn't undefined: new Array(1) and [undefined] differ
    for (let i = 0; i < obj.length; i++) {
      items.push(
        Object.prototype.hasOwnProperty.call(obj, i)
          ? print(obj[i], inner, next)
          : "<empty>",
      );
    }

    return block(name === "Array" ? "" : `${name} `, "[", "]", items);
  }

  // Buffers and views print their bytes, DataView and ArrayBuffer included
  const bytes = types.isAnyArrayBuffer(obj)
    ? new Uint8Array(obj)
    : types.isDataView(obj)
      ? new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength)
      : undefined;

  if (bytes || types.isTypedArray(obj)) {
    const items = Array.from(
      (bytes ?? obj) as unknown as ArrayLike<unknown>,
      (v) => print(v, inner, next),
    );

    return block(`${constructorName(obj)} `, "[", "]", items);
  }

  if (types.isMap(obj)) {
    const items = [...Map.prototype.entries.call(obj)].map(
      ([k, v]) => `${print(k, inner, next)} => ${print(v, inner, next)}`,
    );

    return block(`${constructorName(obj)} `, "{", "}", items);
  }

  if (types.isSet(obj)) {
    const items = [...Set.prototype.values.call(obj)].map((v) =>
      print(v, inner, next),
    );

    return block(`${constructorName(obj)} `, "{", "}", items);
  }

  const record = obj as Record<PropertyKey, unknown>;
  const keys: PropertyKey[] = Object.keys(obj).sort();

  for (const sym of Object.getOwnPropertySymbols(obj)) {
    if (Object.prototype.propertyIsEnumerable.call(obj, sym)) keys.push(sym);
  }

  const items = keys.map(
    (key) => `${print(key, inner, next)}: ${print(record[key], inner, next)}`,
  );
  const name = constructorName(obj);

  return block(name === "Object" ? "" : `${name} `, "{", "}", items);
}

function constructorName(obj: object): string {
  const proto: unknown = Object.getPrototypeOf(obj);

  if (proto === null) return "Object";

  const ctor = (proto as { constructor?: unknown }).constructor;

  return typeof ctor === "function" && ctor.name ? ctor.name : "Object";
}
