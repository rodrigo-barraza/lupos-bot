import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getServerAgeYears,
  computeStartDate,
  formatTimePeriod,
  getMedal,
  shuffleArray,
  addTimePeriodOptions,
  resolvePeriod,
  truncateAtLineBoundary,
  buildLeaderboardEmbed,
  tryTimeoutMember,
  EMBED_DESCRIPTION_LIMIT,
  MAX_TIMEOUT_DURATION_MS,
} from "../commandUtils.ts";
import { SlashCommandBuilder } from "discord.js";
import type {
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
} from "discord.js";

describe("commandUtils", () => {
  describe("getServerAgeYears", () => {
    it("computes whole years from the guild creation timestamp", () => {
      const threeYearsAgo = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000 - 1000;
      expect(
        getServerAgeYears({ createdTimestamp: threeYearsAgo } as Guild),
      ).toBe(3);
    });

    it("returns 0 for a brand-new server", () => {
      expect(getServerAgeYears({ createdTimestamp: Date.now() } as Guild)).toBe(
        0,
      );
    });
  });

  describe("computeStartDate", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0)); // July 15 2026, local time
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("subtracts years, months, and days from now", () => {
      const { startDate } = computeStartDate(1, 2, 3);
      expect(startDate.getFullYear()).toBe(2025);
      expect(startDate.getMonth()).toBe(4); // May
      expect(startDate.getDate()).toBe(12);
    });

    it("returns a matching unix timestamp", () => {
      const { startDate, unixStartDate } = computeStartDate(0, 0, 7);
      expect(unixStartDate).toBe(Math.floor(startDate.getTime()));
    });

    it("returns now when all offsets are zero", () => {
      const { startDate } = computeStartDate(0, 0, 0);
      expect(startDate.getTime()).toBe(Date.now());
    });
  });

  describe("formatTimePeriod", () => {
    it("formats single units with correct pluralization", () => {
      expect(formatTimePeriod(1, 0, 0)).toBe("Last 1 year");
      expect(formatTimePeriod(2, 0, 0)).toBe("Last 2 years");
      expect(formatTimePeriod(0, 1, 0)).toBe("Last 1 month");
      expect(formatTimePeriod(0, 0, 5)).toBe("Last 5 days");
    });

    it("joins multiple units", () => {
      expect(formatTimePeriod(1, 2, 3)).toBe("Last 1 year, 2 months, 3 days");
    });

    it("uses the fallback when no units are given", () => {
      expect(formatTimePeriod(0, 0, 0)).toBe("All time");
      expect(formatTimePeriod(0, 0, 0, "Since server creation")).toBe(
        "Since server creation",
      );
    });
  });

  describe("getMedal", () => {
    it("awards podium medals, honorable mentions, then padding", () => {
      expect(getMedal(0)).toBe("🥇");
      expect(getMedal(1)).toBe("🥈");
      expect(getMedal(2)).toBe("🥉");
      expect(getMedal(3)).toBe("🏅");
      expect(getMedal(4)).toBe("🏅");
      expect(getMedal(5)).toBe("  ");
    });
  });

  describe("addTimePeriodOptions", () => {
    it("appends years/months/days options with normalized ranges", () => {
      const builder = addTimePeriodOptions(
        new SlashCommandBuilder().setName("test").setDescription("test"),
      );
      const options = builder.toJSON().options ?? [];
      const byName = new Map(
        options.map((o) => [o.name, o as unknown as Record<string, unknown>]),
      );
      expect(byName.get("years")).toMatchObject({ min_value: 0, max_value: 7 });
      expect(byName.get("months")).toMatchObject({
        min_value: 0,
        max_value: 12,
      });
      expect(byName.get("days")).toMatchObject({ min_value: 0, max_value: 31 });
    });
  });

  describe("resolvePeriod", () => {
    function fakeInteraction(
      values: Record<string, number | null>,
      guildCreatedTimestamp?: number,
    ): ChatInputCommandInteraction {
      return {
        options: {
          getInteger: (name: string) => values[name] ?? null,
        },
        guild:
          guildCreatedTimestamp !== undefined
            ? ({ createdTimestamp: guildCreatedTimestamp } as Guild)
            : null,
      } as unknown as ChatInputCommandInteraction;
    }

    it("uses the provided options and formats the label", () => {
      const period = resolvePeriod(fakeInteraction({ years: 1, days: 3 }));
      expect(period.years).toBe(1);
      expect(period.months).toBe(0);
      expect(period.days).toBe(3);
      expect(period.label).toBe("Last 1 year, 3 days");
      expect(period.unixStartDate).toBe(Math.floor(period.startDate.getTime()));
    });

    it("defaults to server lifetime + 1 year when all options are zero", () => {
      const threeYearsAgo = Date.now() - 3.5 * 365 * 24 * 60 * 60 * 1000;
      const period = resolvePeriod(fakeInteraction({}, threeYearsAgo));
      expect(period.years).toBe(4); // 3 whole years + 1
      expect(period.label).toBe("Server lifetime (default)");
    });

    it("does not collapse to a zero-length window for young servers", () => {
      const period = resolvePeriod(fakeInteraction({}, Date.now()));
      expect(period.years).toBe(1);
      expect(period.unixStartDate).toBeLessThan(Date.now());
    });

    it("falls back to 1 year outside a guild", () => {
      const period = resolvePeriod(fakeInteraction({}));
      expect(period.years).toBe(1);
      expect(period.label).toBe("Server lifetime (default)");
    });

    it("honors a command-specific default period", () => {
      const period = resolvePeriod(fakeInteraction({}, Date.now()), {
        days: 7,
        label: "Last 7 days (default)",
      });
      expect(period.days).toBe(7);
      expect(period.years).toBe(0);
      expect(period.label).toBe("Last 7 days (default)");
    });

    it("ignores the default period when options are provided", () => {
      const period = resolvePeriod(fakeInteraction({ months: 2 }), {
        days: 7,
        label: "Last 7 days (default)",
      });
      expect(period.months).toBe(2);
      expect(period.label).toBe("Last 2 months");
    });
  });

  describe("truncateAtLineBoundary", () => {
    it("returns short text unchanged", () => {
      expect(truncateAtLineBoundary("hello\nworld")).toBe("hello\nworld");
    });

    it("truncates at a line boundary and appends an ellipsis", () => {
      const line = "x".repeat(100);
      const text = Array(50).fill(line).join("\n"); // 5049 chars
      const truncated = truncateAtLineBoundary(text);
      expect(truncated.length).toBeLessThanOrEqual(EMBED_DESCRIPTION_LIMIT);
      expect(truncated.endsWith("…")).toBe(true);
      // Everything before the ellipsis is whole lines
      const body = truncated.slice(0, -1);
      for (const bodyLine of body.split("\n")) {
        expect(bodyLine).toBe(line);
      }
    });

    it("hard-truncates a single overlong line", () => {
      const text = "y".repeat(5000);
      const truncated = truncateAtLineBoundary(text);
      expect(truncated.length).toBe(EMBED_DESCRIPTION_LIMIT);
      expect(truncated.endsWith("…")).toBe(true);
    });
  });

  describe("buildLeaderboardEmbed", () => {
    interface Entry {
      name: string;
      score: number;
    }
    const entries: Entry[] = Array.from({ length: 12 }, (_, i) => ({
      name: `player${i + 1}`,
      score: 100 - i,
    }));
    const formatLine = (
      entry: Entry,
      index: number,
      medal: string,
      section: "top" | "bottom",
    ) =>
      section === "bottom"
        ? `💀 #${index + 1}. ${entry.name}`
        : `${medal} ${index + 1}. ${entry.name} - ${entry.score}`;

    it("renders medal lines for the top N entries", () => {
      const embed = buildLeaderboardEmbed({
        title: "Test Board",
        color: 0x123456,
        entries,
        topN: 10,
        formatLine,
      });
      const description = embed.data.description ?? "";
      expect(embed.data.title).toBe("Test Board");
      expect(description).toContain("🥇 1. player1 - 100");
      expect(description).toContain("🥈 2. player2 - 99");
      expect(description).toContain("🥉 3. player3 - 98");
      expect(description).toContain("10. player10");
      expect(description).not.toContain("11. player11");
    });

    it("renders a bottom section (worst first) when there are extra entries", () => {
      const embed = buildLeaderboardEmbed({
        title: "Test Board",
        color: 0x123456,
        entries,
        topN: 10,
        bottomN: 2,
        topHeader: "Top",
        bottomHeader: "Shame",
        formatLine,
      });
      const description = embed.data.description ?? "";
      expect(description).toContain("**Top**");
      expect(description).toContain("**Shame**");
      const worstIndex = description.indexOf("💀 #12. player12");
      const secondWorstIndex = description.indexOf("💀 #11. player11");
      expect(worstIndex).toBeGreaterThan(-1);
      expect(secondWorstIndex).toBeGreaterThan(-1);
      expect(worstIndex).toBeLessThan(secondWorstIndex);
    });

    it("omits the bottom section when everyone fits in the top", () => {
      const embed = buildLeaderboardEmbed({
        title: "Test Board",
        color: 0x123456,
        entries: entries.slice(0, 5),
        topN: 10,
        bottomN: 2,
        formatLine,
      });
      expect(embed.data.description ?? "").not.toContain("💀");
    });

    it("includes preamble description and footer, truncated to the embed limit", () => {
      const embed = buildLeaderboardEmbed({
        title: "Test Board",
        color: 0x123456,
        description: "Some stats up top",
        entries: Array.from({ length: 500 }, (_, i) => ({
          name: `verylongplayername${i}`.repeat(3),
          score: i,
        })),
        formatLine: (entry: Entry, index: number, medal: string) =>
          `${medal} ${index + 1}. ${entry.name}`,
        footer: "footer text",
      });
      const description = embed.data.description ?? "";
      expect(description.startsWith("Some stats up top")).toBe(true);
      expect(description.length).toBeLessThanOrEqual(EMBED_DESCRIPTION_LIMIT);
      expect(description.endsWith("…")).toBe(true);
      expect(embed.data.footer?.text).toBe("footer text");
    });
  });

  describe("tryTimeoutMember", () => {
    it("times out a moderatable member with the clamped duration", async () => {
      const timeout = vi.fn().mockResolvedValue(undefined);
      const member = { moderatable: true, timeout } as unknown as GuildMember;

      const result = await tryTimeoutMember(member, 60000, "test reason");
      expect(result).toEqual({ ok: true });
      expect(timeout).toHaveBeenCalledWith(60000, "test reason");
    });

    it("clamps the duration to Discord's 28-day maximum", async () => {
      const timeout = vi.fn().mockResolvedValue(undefined);
      const member = { moderatable: true, timeout } as unknown as GuildMember;

      await tryTimeoutMember(member, MAX_TIMEOUT_DURATION_MS * 2, "too long");
      expect(timeout).toHaveBeenCalledWith(MAX_TIMEOUT_DURATION_MS, "too long");
    });

    it("fails without throwing when the member is not moderatable", async () => {
      const timeout = vi.fn();
      const member = { moderatable: false, timeout } as unknown as GuildMember;

      const result = await tryTimeoutMember(member, 60000, "test");
      expect(result).toEqual({ ok: false, error: "missing permissions" });
      expect(timeout).not.toHaveBeenCalled();
    });

    it("translates Discord error 50013 to missing permissions", async () => {
      const timeout = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("Missing Permissions"), { code: 50013 }),
        );
      const member = { moderatable: true, timeout } as unknown as GuildMember;

      const result = await tryTimeoutMember(member, 60000, "test");
      expect(result).toEqual({ ok: false, error: "missing permissions" });
    });

    it("returns other errors as messages without throwing", async () => {
      const timeout = vi.fn().mockRejectedValue(new Error("boom"));
      const member = { moderatable: true, timeout } as unknown as GuildMember;

      const result = await tryTimeoutMember(member, 60000, "test");
      expect(result).toEqual({ ok: false, error: "boom" });
    });
  });

  describe("shuffleArray", () => {
    it("keeps the same elements (in-place permutation)", () => {
      const array = [1, 2, 3, 4, 5, 6, 7, 8];
      const copy = [...array];
      shuffleArray(array);
      expect(array.length).toBe(copy.length);
      expect([...array].sort((a, b) => a - b)).toEqual(copy);
    });

    it("handles empty and single-element arrays", () => {
      const empty: number[] = [];
      const single = [42];
      shuffleArray(empty);
      shuffleArray(single);
      expect(empty).toEqual([]);
      expect(single).toEqual([42]);
    });
  });
});
