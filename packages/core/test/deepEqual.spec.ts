// import { describe, expect, it } from "@unrift/core";
// import { deepEqual } from "@unrift/core/"

// describe("deepEqual", () => {
//   it("compares identical primitives", () => {
//     expect(deepEqual(1, 1)).toBe(true);
//     expect(deepEqual("string", "string")).toBe(true);
//     expect(deepEqual(true, true)).toBe(true);
//     expect(deepEqual(null, null)).toBe(true);
//     expect(deepEqual(undefined, undefined)).toBe(true);

//     expect(deepEqual(1, 2)).toBe(false);
//     expect(deepEqual("a", "b")).toBe(false);
//     expect(deepEqual(true, false)).toBe(false);
//   });

//   it("treats NaN as equal to NaN", () => {
//     expect(deepEqual(NaN, NaN)).toBe(true);
//   });

//   it("treats +0 and -0 as equal", () => {
//     expect(deepEqual(+0, -0)).toBe(true);
//   });

//   it("compares equal arrays", () => {
//     expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
//     expect(deepEqual([], [])).toBe(true);
//     expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
//     expect(deepEqual([1, [2, 3]], [1, [2, 4]])).toBe(false);

//     expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
//     expect(deepEqual([1, 3], [1, 2])).toBe(false);
//   });

//   it("compares equal typed arrays", () => {
//     expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(
//       true,
//     );
//   });

//   it("compares equal ArrayBuffers", () => {
//     const a = new Uint8Array([1, 2]).buffer;
//     const b = new Uint8Array([1, 2]).buffer;
//     expect(deepEqual(a, b)).toBe(true);

//     const c = new Uint8Array([1, 2]).buffer;
//     const d = new Uint8Array([1, 3]).buffer;
//     expect(deepEqual(c, d)).toBe(false);
//   });

//   it("compares equal DataViews", () => {
//     const a = new DataView(new Uint8Array([5, 6]).buffer);
//     const b = new DataView(new Uint8Array([5, 6]).buffer);
//     expect(deepEqual(a, b)).toBe(true);

//     const c = new DataView(new Uint8Array([5, 6]).buffer);
//     const d = new DataView(new Uint8Array([5, 7]).buffer);
//     expect(deepEqual(c, d)).toBe(false);
//   });

//   it("compares equal dates", () => {
//     expect(deepEqual(new Date(123), new Date(123))).toBe(true);
//     expect(deepEqual(new Date(123), new Date(456))).toBe(false);
//   });

//   it("compares equal RegExp", () => {
//     expect(deepEqual(/abc/gi, /abc/gi)).toBe(true);
//     expect(deepEqual(/abc/g, /abc/i)).toBe(false);
//   });

//   it("compares equal sets", () => {
//     expect(deepEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true);
//     expect(deepEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false);
//   });

//   it("compares nested sets", () => {
//     const a = new Set([{ x: 10 }]);
//     const b = new Set([{ x: 10 }]);
//     expect(deepEqual(a, b)).toBe(true);
//   });

//   it("compares equal maps", () => {
//     const a = new Map([["a", 1]]);
//     const b = new Map([["a", 2]]);
//     expect(deepEqual(a, b)).toBe(false);

//     const c = new Map([["a", 1]]);
//     const d = new Map([["a", 2]]);
//     expect(deepEqual(c, d)).toBe(false);
//   });

//   it("compares objects", () => {
//     expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
//     expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
//     expect(deepEqual({ a: { b: 2 } }, { a: { b: 2 } })).toBe(true);
//     expect(deepEqual({ a: { b: 2 } }, { a: { b: 3 } })).toBe(false);
//   });

//   it("rejects objects with different prototypes", () => {
//     const a = Object.create(null);
//     const b = {};
//     expect(deepEqual(a, b)).toBe(false);
//   });
// });
