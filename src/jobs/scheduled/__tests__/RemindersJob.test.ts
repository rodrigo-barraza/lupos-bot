// ============================================================
// RemindersJob.test.ts — the 30 s ticker around RemindersService
// ============================================================
// A tick still in flight makes the next one a no-op (the atomic claim
// in RemindersService is the real double-send guard; this keeps ticks
// from stacking), a failed tick never kills the schedule, and the job
// delivers once at start so reminders due while Lupos was down go out
// immediately.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client } from "discord.js";

const deliverDueReminders = vi.fn();
vi.mock("../../../services/RemindersService.ts", () => ({
  default: { deliverDueReminders },
}));

const { default: RemindersJob, runReminderTick } = await import(
  "#root/jobs/scheduled/RemindersJob.ts"
);

const client = {} as Client;

beforeEach(() => {
  deliverDueReminders.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  RemindersJob.stopJob();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runReminderTick", () => {
  it("skips a tick while the previous one is still delivering", async () => {
    let finish!: () => void;
    deliverDueReminders.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ sent: 1, failed: 0, retrying: 0 });
        }),
    );
    const first = runReminderTick(client);
    expect(await runReminderTick(client)).toBeNull();
    finish();
    expect(await first).toEqual({ sent: 1, failed: 0, retrying: 0 });
    expect(deliverDueReminders).toHaveBeenCalledTimes(1);

    deliverDueReminders.mockResolvedValue({ sent: 0, failed: 0, retrying: 0 });
    expect(await runReminderTick(client)).toEqual({ sent: 0, failed: 0, retrying: 0 });
  });

  it("survives a failing tick", async () => {
    deliverDueReminders.mockRejectedValueOnce(new Error("mongo down"));
    expect(await runReminderTick(client)).toBeNull();
    deliverDueReminders.mockResolvedValue({ sent: 0, failed: 0, retrying: 0 });
    expect(await runReminderTick(client)).not.toBeNull();
  });
});

describe("RemindersJob.startJob", () => {
  it("delivers immediately, then every 30 seconds, and starts only once", async () => {
    vi.useFakeTimers();
    deliverDueReminders.mockResolvedValue({ sent: 0, failed: 0, retrying: 0 });
    RemindersJob.startJob(client);
    RemindersJob.startJob(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(deliverDueReminders).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(deliverDueReminders).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deliverDueReminders).toHaveBeenCalledTimes(4);
  });
});
