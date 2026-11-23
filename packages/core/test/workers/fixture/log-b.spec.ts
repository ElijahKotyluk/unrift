import { it, mock } from "@unrift/core";

it("b", async () => {
  console.log("log: b");
  console.error("log: b error");

  // A character split across two writes, and one written as base64
  process.stdout.write("log: ");
  process.stdout.write(Buffer.from([0xe2]));
  process.stdout.write(Buffer.from([0x82, 0xac]));
  process.stdout.write("4oKsCg==", "base64");

  // The write callback doesn't go through the test's faked queueMicrotask
  mock.useFakeTimers({ toFake: ["queueMicrotask"] });

  try {
    await new Promise((resolve) =>
      process.stdout.write("log: called\n", resolve),
    );
  } finally {
    mock.useRealTimers();
  }
});
