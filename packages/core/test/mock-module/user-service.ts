// The tests count how often this runs: a mocked module's code shouldn't
(globalThis as Record<string, unknown>).__userServiceLoads =
  (((globalThis as Record<string, unknown>).__userServiceLoads as number) ??
    0) + 1;

export function getUser(id: number) {
  return { id, name: "real" };
}

export default "real default";
