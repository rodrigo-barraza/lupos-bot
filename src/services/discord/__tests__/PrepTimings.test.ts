import PrepTimings from "../PrepTimings.ts";

describe("PrepTimings", () => {
  it("prints the stages in order, then total and sinceTrigger", async () => {
    const timings = new PrepTimings(Date.now() - 5_000);
    timings.record("fetch", 1234.4);
    await timings.time("extract", async () => {});
    const line = timings.line("123456789012345678");
    expect(line).toMatch(
      /^⏱️ \[prep\] 123456789012345678 fetch=1234 extract=\d+ total=\d+ sinceTrigger=(\d{4})$/,
    );
    expect(Number(line.split("sinceTrigger=")[1])).toBeGreaterThanOrEqual(
      5_000,
    );
  });

  it("records a stage that throws", async () => {
    const timings = new PrepTimings();
    await expect(
      timings.time("fetch", async () => {
        throw new Error("rest down");
      }),
    ).rejects.toThrow("rest down");
    expect(timings.line("1")).toMatch(/fetch=\d+ total=\d+$/);
  });

  it("records the queue wait once, and only after enqueueing", async () => {
    const timings = new PrepTimings();
    timings.recordQueueWait();
    timings.markEnqueued();
    await new Promise((resolve) => setTimeout(resolve, 15));
    timings.recordQueueWait();
    timings.recordQueueWait();
    const line = timings.line("1");
    expect(line.match(/queue=/g)).toHaveLength(1);
    expect(Number(line.match(/queue=(\d+)/)![1])).toBeGreaterThanOrEqual(10);
  });
});
