/**
 * DmCampaignService.test.ts
 *
 * Tests the pure decision logic of the invite-DM campaign:
 *   1. pickMessageVariant — deterministic per user, spreads across variants
 *   2. renderMessage — placeholder substitution
 *   3. computeNextDelayMs — bounded by base + jitter
 *   4. evaluateDailyBudget — UTC day rollover reset and cap enforcement
 *   5. classifySendError — 50007 / 40003 / 429 / unknown mappings
 */

import {
  pickMessageVariant,
  renderMessage,
  computeNextDelayMs,
  evaluateDailyBudget,
  classifySendError,
  buildCampaignUpsert,
  utcDateString,
  DEFAULT_MESSAGE_VARIANTS,
  DEFAULT_INVITE_URL,
  DM_DELAY_BASE_MS,
  DM_DELAY_JITTER_MS,
  DAILY_CAP,
} from "../../src/services/DmCampaignService.js";

describe("pickMessageVariant", () => {
  it("is deterministic for the same user", () => {
    const first = pickMessageVariant("1234567890", DEFAULT_MESSAGE_VARIANTS);
    const second = pickMessageVariant("1234567890", DEFAULT_MESSAGE_VARIANTS);
    expect(first).toBe(second);
  });

  it("uses more than one variant across many users", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(pickMessageVariant(`user-${i}`, DEFAULT_MESSAGE_VARIANTS));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("returns empty string for an empty variant list", () => {
    expect(pickMessageVariant("123", [])).toBe("");
  });
});

describe("renderMessage", () => {
  it("substitutes every {name} and {invite} placeholder", () => {
    const rendered = renderMessage(
      "Hey {name}! Join {invite} — see you, {name}!",
      "Thrall",
      "https://discord.gg/classicwhitemane",
    );
    expect(rendered).toBe(
      "Hey Thrall! Join https://discord.gg/classicwhitemane — see you, Thrall!",
    );
  });

  it("every default variant contains both placeholders", () => {
    for (const variant of DEFAULT_MESSAGE_VARIANTS) {
      expect(variant).toContain("{name}");
      expect(variant).toContain("{invite}");
    }
  });
});

describe("computeNextDelayMs", () => {
  it("returns the base delay at random=0", () => {
    expect(computeNextDelayMs(0)).toBe(DM_DELAY_BASE_MS);
  });

  it("stays under base + jitter at random→1", () => {
    expect(computeNextDelayMs(0.999999)).toBeLessThan(
      DM_DELAY_BASE_MS + DM_DELAY_JITTER_MS,
    );
  });
});

describe("evaluateDailyBudget", () => {
  const noonUtc = Date.UTC(2026, 6, 17, 12, 0, 0);

  it("allows sending when under the cap on the same day", () => {
    const decision = evaluateDailyBudget(
      { date: utcDateString(noonUtc), sent: DAILY_CAP - 1 },
      noonUtc,
      DAILY_CAP,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.daily.sent).toBe(DAILY_CAP - 1);
  });

  it("blocks sending at the cap", () => {
    const decision = evaluateDailyBudget(
      { date: utcDateString(noonUtc), sent: DAILY_CAP },
      noonUtc,
      DAILY_CAP,
    );
    expect(decision.allowed).toBe(false);
  });

  it("resets the counter when the UTC day rolls over", () => {
    const decision = evaluateDailyBudget(
      { date: "2026-07-16", sent: DAILY_CAP },
      noonUtc,
      DAILY_CAP,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.daily).toEqual({ date: "2026-07-17", sent: 0 });
  });

  it("treats a missing counter as a fresh day", () => {
    const decision = evaluateDailyBudget(undefined, noonUtc, DAILY_CAP);
    expect(decision.allowed).toBe(true);
    expect(decision.daily.sent).toBe(0);
  });
});

describe("buildCampaignUpsert", () => {
  const context = {
    sourceGuildId: "1",
    excludeGuildId: "2",
    now: new Date(Date.UTC(2026, 6, 17, 12, 0, 0)),
  };

  it("never puts the same path in both $set and $setOnInsert", () => {
    for (const options of [
      {},
      { messageVariants: ["hi {name} {invite}"] },
      { inviteUrl: "https://discord.gg/x" },
      { inviteUrl: "https://discord.gg/x", messageVariants: ["a"] },
    ]) {
      const upsert = buildCampaignUpsert(options, context);
      const overlap = Object.keys(upsert.$set).filter(
        (key) => key in upsert.$setOnInsert,
      );
      expect(overlap).toEqual([]);
    }
  });

  it("overrides go in $set so they also update an existing doc", () => {
    const variants = ["updated copy {name} {invite}"];
    const upsert = buildCampaignUpsert({ messageVariants: variants }, context);
    expect(upsert.$set.messageVariants).toEqual(variants);
    expect(upsert.$setOnInsert.messageVariants).toBeUndefined();
  });

  it("defaults go in $setOnInsert when not overridden", () => {
    const upsert = buildCampaignUpsert({}, context);
    expect(upsert.$setOnInsert.messageVariants).toEqual(
      DEFAULT_MESSAGE_VARIANTS,
    );
    expect(upsert.$setOnInsert.inviteUrl).toBe(DEFAULT_INVITE_URL);
    expect(upsert.$set.messageVariants).toBeUndefined();
  });
});

describe("classifySendError", () => {
  it("maps 50007 (DMs closed) to a permanent skip, no pause", () => {
    const classification = classifySendError({ code: 50007 });
    expect(classification.targetStatus).toBe("dms_closed");
    expect(classification.pauseReason).toBeNull();
    expect(classification.countsAsFailure).toBe(false);
  });

  it("maps 40003 (opening DMs too fast) to a campaign pause with the target kept pending", () => {
    const classification = classifySendError({ code: 40003 });
    expect(classification.targetStatus).toBe("pending");
    expect(classification.pauseReason).toContain("40003");
  });

  it("maps a surfaced HTTP 429 to a campaign pause with the target kept pending", () => {
    const classification = classifySendError({ status: 429 });
    expect(classification.targetStatus).toBe("pending");
    expect(classification.pauseReason).toContain("429");
  });

  it("maps unknown errors to failed and counts toward the breaker", () => {
    const classification = classifySendError(new Error("socket hang up"));
    expect(classification.targetStatus).toBe("failed");
    expect(classification.pauseReason).toBeNull();
    expect(classification.countsAsFailure).toBe(true);
  });
});
