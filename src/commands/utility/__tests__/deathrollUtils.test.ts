import { describe, it, expect } from "vitest";
import { _testHelpers } from "../deathrollUtils.ts";

const {
  calculateKFactor,
  calculateConfidence,
  applyTimeDecayRD,
  mmrMultiplier,
  gravityGainScale,
  gravityLossScale,
  getSeasonMMR,
  computePlayerProfile,
  getRankTitle,
  formatStreak,
  formatStatsString,
  getMedal,
  getMultiplierName,
  RANK_TIERS,
  BASE_MMR,
  MIN_RD,
  MAX_RD,
  BASE_K,
  GRAVITY_CENTER,
  PLACEMENT_GAMES,
  UNRANKED_DISPLAY,
} = _testHelpers;

describe("deathroll MMR math", () => {
  describe("calculateKFactor", () => {
    it("returns BASE_K at minimum rating deviation (confident veteran)", () => {
      expect(calculateKFactor(MIN_RD)).toBe(BASE_K);
    });

    it("returns 2×BASE_K at maximum rating deviation (new player)", () => {
      expect(calculateKFactor(MAX_RD)).toBe(BASE_K * 2);
    });

    it("clamps rating deviation outside [MIN_RD, MAX_RD]", () => {
      expect(calculateKFactor(0)).toBe(calculateKFactor(MIN_RD));
      expect(calculateKFactor(-50)).toBe(calculateKFactor(MIN_RD));
      expect(calculateKFactor(9999)).toBe(calculateKFactor(MAX_RD));
    });

    it("scales monotonically between the bounds", () => {
      const mid = (MIN_RD + MAX_RD) / 2;
      expect(calculateKFactor(mid)).toBeGreaterThan(calculateKFactor(MIN_RD));
      expect(calculateKFactor(mid)).toBeLessThan(calculateKFactor(MAX_RD));
    });
  });

  describe("calculateConfidence", () => {
    it("is 100% at MIN_RD and 0% at MAX_RD", () => {
      expect(calculateConfidence(MIN_RD)).toBe(100);
      expect(calculateConfidence(MAX_RD)).toBe(0);
    });

    it("clamps out-of-range rating deviation", () => {
      expect(calculateConfidence(0)).toBe(100);
      expect(calculateConfidence(10000)).toBe(0);
    });
  });

  describe("applyTimeDecayRD", () => {
    it("returns MAX_RD for players who never played", () => {
      expect(applyTimeDecayRD(50, undefined)).toBe(MAX_RD);
      expect(applyTimeDecayRD(50, 0)).toBe(MAX_RD);
    });

    it("adds ~1 RD per day of inactivity", () => {
      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
      expect(applyTimeDecayRD(50, tenDaysAgo)).toBeCloseTo(60, 0);
    });

    it("caps decayed RD at MAX_RD", () => {
      const longAgo = Date.now() - 1000 * 24 * 60 * 60 * 1000;
      expect(applyTimeDecayRD(150, longAgo)).toBe(MAX_RD);
    });

    it("barely changes RD for a game played moments ago", () => {
      expect(applyTimeDecayRD(80, Date.now())).toBeCloseTo(80, 1);
    });
  });

  describe("gravity rubber-band", () => {
    it("has no effect exactly at GRAVITY_CENTER", () => {
      expect(gravityGainScale(GRAVITY_CENTER)).toBe(1);
      expect(gravityLossScale(GRAVITY_CENTER)).toBe(1);
    });

    it("reduces gains and amplifies losses above center", () => {
      const high = GRAVITY_CENTER + 200;
      expect(gravityGainScale(high)).toBeLessThan(1);
      expect(gravityLossScale(high)).toBeGreaterThan(1);
    });

    it("boosts gains and softens losses below center", () => {
      const low = GRAVITY_CENTER - 200;
      expect(gravityGainScale(low)).toBeGreaterThan(1);
      expect(gravityLossScale(low)).toBeLessThan(1);
    });

    it("never scales below the 0.15 floor at extreme MMR", () => {
      expect(gravityGainScale(100000)).toBe(0.15);
      expect(gravityLossScale(-100000)).toBe(0.15);
    });
  });

  describe("mmrMultiplier (Double-or-Nothing compression)", () => {
    it("returns 1 for the base game and anything below", () => {
      expect(mmrMultiplier(1)).toBe(1);
      expect(mmrMultiplier(0)).toBe(1);
    });

    it("compresses doublings to +0.25 each", () => {
      expect(mmrMultiplier(2)).toBeCloseTo(1.25);
      expect(mmrMultiplier(4)).toBeCloseTo(1.5);
      expect(mmrMultiplier(16)).toBeCloseTo(2);
      expect(mmrMultiplier(1024)).toBeCloseTo(3.5);
    });
  });

  describe("getSeasonMMR", () => {
    it("returns fresh defaults for a player with no stats", () => {
      expect(getSeasonMMR(null)).toEqual({ mmr: BASE_MMR, rd: MAX_RD });
    });

    it("returns fresh defaults when the stored season does not match", () => {
      expect(
        getSeasonMMR({
          mmrSeason: "definitely-not-the-current-season",
          mmr: 1400,
          rd: 40,
        }),
      ).toEqual({ mmr: BASE_MMR, rd: MAX_RD });
    });
  });
});

describe("deathroll rank & profile", () => {
  describe("getRankTitle", () => {
    it("returns the lowest tier for rock-bottom MMR", () => {
      expect(getRankTitle(-500).title).toBe("Initiate");
      expect(getRankTitle(1).title).toBe("Initiate");
    });

    it("returns the top tier at and above its threshold", () => {
      expect(getRankTitle(1325).title).toBe("Eternus");
      expect(getRankTitle(9999).title).toBe("Eternus");
    });

    it("respects exact tier boundaries", () => {
      expect(getRankTitle(875).title).toBe("Seeker");
      expect(getRankTitle(874).title).toBe("Initiate");
      expect(getRankTitle(BASE_MMR).title).toBe("Arcanist");
    });

    it("covers every MMR value with exactly one tier (tiers are sorted descending)", () => {
      const mins = RANK_TIERS.map((t: { min: number }) => t.min);
      const sorted = [...mins].sort((a, b) => b - a);
      expect(mins).toEqual(sorted);
      expect(mins[mins.length - 1]).toBe(-Infinity);
    });
  });

  describe("computePlayerProfile", () => {
    it("produces a sane default profile for a brand-new player", () => {
      const profile = computePlayerProfile(null);
      expect(profile.wins).toBe(0);
      expect(profile.losses).toBe(0);
      expect(profile.mmr).toBe(BASE_MMR);
      expect(profile.rd).toBe(MAX_RD);
      expect(profile.isPlacement).toBe(true);
      expect(profile.winRate).toBe(0);
    });

    it("keeps players in placement until PLACEMENT_GAMES games", () => {
      const below = computePlayerProfile({
        wins: PLACEMENT_GAMES - 1,
        losses: 0,
        totalGames: PLACEMENT_GAMES - 1,
      });
      const at = computePlayerProfile({
        wins: PLACEMENT_GAMES,
        losses: 0,
        totalGames: PLACEMENT_GAMES,
      });
      expect(below.isPlacement).toBe(true);
      expect(at.isPlacement).toBe(false);
    });

    it("derives totalGames from wins+losses when missing", () => {
      const profile = computePlayerProfile({ wins: 6, losses: 4 });
      expect(profile.totalGames).toBe(10);
      expect(profile.winRate).toBe(60);
    });

    it("ranks placement players as the bottom tier regardless of MMR", () => {
      const profile = computePlayerProfile({
        wins: 1,
        losses: 0,
        totalGames: 1,
        mmr: 1400,
      });
      expect(profile.isPlacement).toBe(true);
      expect(profile.rank.title).toBe("Initiate");
    });
  });
});

describe("deathroll formatting", () => {
  describe("formatStreak", () => {
    it("returns empty for no streak", () => {
      expect(formatStreak(0)).toBe("");
    });

    it("formats win and loss streaks", () => {
      expect(formatStreak(3)).toBe("🔥×3");
      expect(formatStreak(-2)).toBe("💀×2");
    });
  });

  describe("formatStatsString", () => {
    it("shows Unranked during placement", () => {
      const result = formatStatsString({
        wins: 1,
        losses: 1,
        isPlacement: true,
      });
      expect(result).toContain(UNRANKED_DISPLAY.title);
      expect(result).toContain("1W/1L 50%");
    });

    it("shows rank and MMR after placement", () => {
      const rank = getRankTitle(1100);
      const result = formatStatsString({
        wins: 7,
        losses: 3,
        mmr: 1100,
        rank,
        isPlacement: false,
      });
      expect(result).toContain(rank.title);
      expect(result).toContain("1100 MMR");
      expect(result).toContain("7W/3L 70%");
    });

    it("handles a zero-game record without dividing by zero", () => {
      expect(formatStatsString({ wins: 0, losses: 0 })).toContain("0W/0L 0%");
    });
  });

  describe("getMedal", () => {
    it("awards medals to the podium and padding to the rest", () => {
      // getMedal is now the shared commandUtils implementation, which also
      // awards 🏅 to positions 4-5 (the deathroll leaderboard itself renders
      // numbered lines, so this changes no user-visible output).
      expect(getMedal(0)).toBe("🥇");
      expect(getMedal(1)).toBe("🥈");
      expect(getMedal(2)).toBe("🥉");
      expect(getMedal(3)).toBe("🏅");
      expect(getMedal(4)).toBe("🏅");
      expect(getMedal(5)).toBe("  ");
    });
  });

  describe("getMultiplierName", () => {
    it("names the known doublings", () => {
      expect(getMultiplierName(2)).toBe("Double (2x)");
      expect(getMultiplierName(1024)).toContain("1024x");
    });

    it("falls back to a plain label for unknown multipliers", () => {
      expect(getMultiplierName(3)).toBe("3x");
      expect(getMultiplierName(2048)).toBe("2048x");
    });
  });
});
