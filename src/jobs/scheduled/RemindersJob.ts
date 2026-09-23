import RemindersService from "#root/services/RemindersService.ts";
import type { DeliverySummary } from "#root/services/RemindersService.ts";
import { REMINDER_POLL_INTERVAL_MS } from "#root/constants/DiscordActionConstants.ts";
import type { Client } from "discord.js";

/**
 * RemindersJob — delivers the agent's scheduled reminders.
 *
 * Every 30 seconds (and once right at start, so reminders that fell due
 * while Lupos was down go out immediately, marked late) it hands due
 * reminders to RemindersService, which claims each one atomically. A
 * tick still running when the next fires is skipped rather than
 * stacked; the atomic claim is what guarantees no double-send even if
 * two ticks did overlap.
 */

let tickInFlight = false;
let intervalHandle: NodeJS.Timeout | null = null;

/** One delivery pass; null when skipped (a tick is in flight) or failed. */
export async function runReminderTick(
  client: Client,
): Promise<DeliverySummary | null> {
  if (tickInFlight) return null;
  tickInFlight = true;
  try {
    const summary = await RemindersService.deliverDueReminders(client);
    if (summary.sent || summary.failed || summary.retrying) {
      console.log(
        `⏰ [RemindersJob] Delivered ${summary.sent}, failed ${summary.failed}, retrying ${summary.retrying}`,
      );
    }
    return summary;
  } catch (error: unknown) {
    console.error(
      `⏰ [RemindersJob] Tick failed: ${(error as Error)?.message ?? error}`,
    );
    return null;
  } finally {
    tickInFlight = false;
  }
}

const RemindersJob = {
  startJob(client: Client) {
    if (intervalHandle) return;
    console.log(
      `⏰ [RemindersJob] Delivering reminders every ${REMINDER_POLL_INTERVAL_MS / 1000}s`,
    );
    void runReminderTick(client);
    intervalHandle = setInterval(() => {
      void runReminderTick(client);
    }, REMINDER_POLL_INTERVAL_MS);
  },

  stopJob() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  },
};

export default RemindersJob;
