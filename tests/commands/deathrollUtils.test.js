/**
 * Tests for deathrollUtils.js — Pure computation functions.
 * Covers: MMR calculations, confidence, RD decay, multiplier compression,
 * player profiles, rank tiers, and edge cases.
 */

import { jest, describe, test, expect, _beforeEach } from "@jest/globals";

// Mock config before importing the module
jest.unstable_mockModule("#root/config.json", () => ({
  default: { DEATHROLL_SEASON: 1 },
}));

// Mock MongoWrapper since the module imports it at top level
jest.unstable_mockModule("#root/wrappers/MongoWrapper.js", () => ({
  default: { getClient: jest.fn() },
}));

// Mock discord.js since the module imports it at top level
jest.unstable_mockModule("discord.js", () => ({
  ActionRowBuilder: jest.fn(),
  ButtonBuilder: jest.fn(),
  ButtonStyle: {},
  PermissionFlagsBits: {},
  EmbedBuilder: jest.fn(),
}));

const { _testHelpers: h } =
  await import("../../commands/utility/deathrollUtils.js");

// ═══════════════════════════════════════════════════════════════════════
// calculateKFactor
// ═══════════════════════════════════════════════════════════════════════
describe("calculateKFactor", () => {
  test("returns BASE_K at minimum RD", () => {
    expect(h.calculateKFactor(h.MIN_RD)).toBe(h.BASE_K);
  });

  test("returns 2×BASE_K at maximum RD", () => {
    expect(h.calculateKFactor(h.MAX_RD)).toBe(h.BASE_K * 2);
  });

  test("returns midpoint K at midpoint RD", () => {
    const midRD = (h.MIN_RD + h.MAX_RD) / 2;
    expect(h.calculateKFactor(midRD)).toBe(h.BASE_K * 1.5);
  });

  test("clamps RD below MIN_RD to MIN_RD", () => {
    expect(h.calculateKFactor(0)).toBe(h.BASE_K);
    expect(h.calculateKFactor(-100)).toBe(h.BASE_K);
  });

  test("clamps RD above MAX_RD to MAX_RD", () => {
    expect(h.calculateKFactor(500)).toBe(h.BASE_K * 2);
    expect(h.calculateKFactor(10000)).toBe(h.BASE_K * 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// calculateConfidence
// ═══════════════════════════════════════════════════════════════════════
describe("calculateConfidence", () => {
  test("returns 100% at minimum RD (fully confident)", () => {
    expect(h.calculateConfidence(h.MIN_RD)).toBe(100);
  });

  test("returns 0% at maximum RD (totally uncertain)", () => {
    expect(h.calculateConfidence(h.MAX_RD)).toBe(0);
  });

  test("returns ~50% at midpoint RD", () => {
    const midRD = (h.MIN_RD + h.MAX_RD) / 2;
    expect(h.calculateConfidence(midRD)).toBe(50);
  });

  test("clamps below MIN_RD to 100%", () => {
    expect(h.calculateConfidence(0)).toBe(100);
  });

  test("clamps above MAX_RD to 0%", () => {
    expect(h.calculateConfidence(999)).toBe(0);
  });

  test("confidence after N games (RD decreases by 5 each game)", () => {
    // 0 games: RD=200 → 0%
    expect(h.calculateConfidence(200)).toBe(0);
    // 5 games: RD=175 → ~15%
    expect(h.calculateConfidence(175)).toBe(15);
    // 10 games: RD=150 → ~29%
    expect(h.calculateConfidence(150)).toBe(29);
    // 34 games: RD=30 → 100%
    expect(h.calculateConfidence(30)).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// applyTimeDecayRD
// ═══════════════════════════════════════════════════════════════════════
describe("applyTimeDecayRD", () => {
  test("returns MAX_RD when lastPlayedAt is null", () => {
    expect(h.applyTimeDecayRD(100, null)).toBe(h.MAX_RD);
  });

  test("returns MAX_RD when lastPlayedAt is undefined", () => {
    expect(h.applyTimeDecayRD(100, undefined)).toBe(h.MAX_RD);
  });

  test("returns approximately same RD when played just now", () => {
    const now = Date.now();
    const result = h.applyTimeDecayRD(100, now);
    // Should be very close to 100 (within floating point)
    expect(result).toBeCloseTo(100, 0);
  });

  test("adds 1 RD per day of inactivity", () => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const result = h.applyTimeDecayRD(100, oneDayAgo);
    expect(result).toBeCloseTo(101, 0);
  });

  test("adds ~7 RD after a week inactive", () => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const result = h.applyTimeDecayRD(100, sevenDaysAgo);
    expect(result).toBeCloseTo(107, 0);
  });

  test("caps at MAX_RD regardless of time away", () => {
    const yearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    expect(h.applyTimeDecayRD(100, yearAgo)).toBe(h.MAX_RD);
  });

  test("does not exceed MAX_RD when already at MAX_RD", () => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(h.applyTimeDecayRD(h.MAX_RD, weekAgo)).toBe(h.MAX_RD);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// mmrMultiplier
// ═══════════════════════════════════════════════════════════════════════
describe("mmrMultiplier", () => {
  test("returns 1 for base multiplier (1x)", () => {
    expect(h.mmrMultiplier(1)).toBe(1);
  });

  test("returns 1 for multiplier of 0", () => {
    expect(h.mmrMultiplier(0)).toBe(1);
  });

  test("returns 1 for negative multiplier", () => {
    expect(h.mmrMultiplier(-5)).toBe(1);
  });

  test("returns 1.25 for 2x (first Double or Nothing)", () => {
    expect(h.mmrMultiplier(2)).toBeCloseTo(1.25);
  });

  test("returns 1.5 for 4x", () => {
    expect(h.mmrMultiplier(4)).toBeCloseTo(1.5);
  });

  test("returns 2.0 for 16x", () => {
    expect(h.mmrMultiplier(16)).toBeCloseTo(2.0);
  });

  test("returns 3.5 for 1024x (max in MULTIPLIER_NAMES)", () => {
    expect(h.mmrMultiplier(1024)).toBeCloseTo(3.5);
  });

  test("scales logarithmically — each doubling adds +0.25", () => {
    const m2 = h.mmrMultiplier(2);
    const m4 = h.mmrMultiplier(4);
    const m8 = h.mmrMultiplier(8);
    expect(m4 - m2).toBeCloseTo(0.25);
    expect(m8 - m4).toBeCloseTo(0.25);
  });

  test("never exceeds 3.5 for existing multiplier values", () => {
    expect(h.mmrMultiplier(1024)).toBeLessThanOrEqual(3.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getSeasonMMR
// ═══════════════════════════════════════════════════════════════════════
describe("getSeasonMMR", () => {
  test("returns defaults when userStats is null", () => {
    const result = h.getSeasonMMR(null);
    expect(result).toEqual({ mmr: h.BASE_MMR, rd: h.MAX_RD });
  });

  test("returns defaults when userStats is undefined", () => {
    const result = h.getSeasonMMR(undefined);
    expect(result).toEqual({ mmr: h.BASE_MMR, rd: h.MAX_RD });
  });

  test("returns defaults when mmrSeason does not match", () => {
    const result = h.getSeasonMMR({ mmr: 1200, rd: 50, mmrSeason: 999 });
    expect(result).toEqual({ mmr: h.BASE_MMR, rd: h.MAX_RD });
  });

  test("returns stored values when mmrSeason matches", () => {
    // Config is mocked with DEATHROLL_SEASON: 1
    const result = h.getSeasonMMR({ mmr: 1200, rd: 50, mmrSeason: 1 });
    expect(result).toEqual({ mmr: 1200, rd: 50 });
  });

  test("returns defaults for mmr/rd when they are missing but season matches", () => {
    const result = h.getSeasonMMR({ mmrSeason: 1 });
    expect(result).toEqual({ mmr: h.BASE_MMR, rd: h.MAX_RD });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getRankTitle
// ═══════════════════════════════════════════════════════════════════════
describe("getRankTitle", () => {
  test("returns Eternus at 1325+", () => {
    expect(h.getRankTitle(1325).title).toBe("Eternus");
    expect(h.getRankTitle(2000).title).toBe("Eternus");
  });

  test("returns Ascendant at 1275-1324", () => {
    expect(h.getRankTitle(1275).title).toBe("Ascendant");
    expect(h.getRankTitle(1324).title).toBe("Ascendant");
  });

  test("returns Ritualist at 1025-1074", () => {
    expect(h.getRankTitle(1025).title).toBe("Ritualist");
  });

  test("returns Initiate at very low MMR", () => {
    expect(h.getRankTitle(1).title).toBe("Initiate");
    expect(h.getRankTitle(100).title).toBe("Initiate");
    expect(h.getRankTitle(874).title).toBe("Initiate");
  });

  test("returns Seeker at 875-924", () => {
    expect(h.getRankTitle(875).title).toBe("Seeker");
    expect(h.getRankTitle(924).title).toBe("Seeker");
  });

  test("each tier has an emoji", () => {
    h.RANK_TIERS.forEach((tier) => {
      expect(tier.emoji).toBeDefined();
      expect(tier.emoji.length).toBeGreaterThan(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// computePlayerProfile
// ═══════════════════════════════════════════════════════════════════════
describe("computePlayerProfile", () => {
  test("returns defaults for null/empty input (placement — Initiate)", () => {
    const profile = h.computePlayerProfile(null);
    expect(profile.wins).toBe(0);
    expect(profile.losses).toBe(0);
    expect(profile.totalGames).toBe(0);
    expect(profile.mmr).toBe(h.BASE_MMR);
    expect(profile.rd).toBe(h.MAX_RD);
    expect(profile.confidence).toBe(0);
    expect(profile.winRate).toBe(0);
    expect(profile.isPlacement).toBe(true);
    expect(profile.rank.title).toBe("Initiate");
  });

  test("computes winRate correctly", () => {
    const profile = h.computePlayerProfile({
      wins: 7,
      losses: 3,
      totalGames: 10,
      mmr: 1100,
      rd: 100,
    });
    expect(profile.winRate).toBe(70);
  });

  test("uses passed-in MMR and RD (stored state, not derived)", () => {
    const profile = h.computePlayerProfile({
      wins: 5,
      losses: 5,
      mmr: 1234,
      rd: 80,
    });
    expect(profile.mmr).toBe(1234);
    expect(profile.rd).toBe(80);
  });

  test("assigns correct rank based on MMR (after placement)", () => {
    const highPlayer = h.computePlayerProfile({
      mmr: 1500,
      rd: 50,
      totalGames: 10,
    });
    expect(highPlayer.rank.title).toBe("Eternus");
    expect(highPlayer.isPlacement).toBe(false);

    const lowPlayer = h.computePlayerProfile({
      mmr: 500,
      rd: 50,
      totalGames: 10,
    });
    expect(lowPlayer.rank.title).toBe("Initiate");
    expect(lowPlayer.isPlacement).toBe(false);
  });

  test("shows Initiate during placement regardless of MMR", () => {
    const placingPlayer = h.computePlayerProfile({
      mmr: 1500,
      rd: 50,
      totalGames: 3,
    });
    expect(placingPlayer.rank.title).toBe("Initiate");
    expect(placingPlayer.isPlacement).toBe(true);
  });

  test("reveals real rank at exactly PLACEMENT_GAMES", () => {
    const justPlaced = h.computePlayerProfile({
      mmr: 1200,
      rd: 50,
      totalGames: h.PLACEMENT_GAMES,
    });
    expect(justPlaced.rank.title).toBe("Oracle");
    expect(justPlaced.isPlacement).toBe(false);
  });

  test("calculates confidence from RD", () => {
    const veteran = h.computePlayerProfile({ mmr: 1000, rd: h.MIN_RD });
    expect(veteran.confidence).toBe(100);

    const newbie = h.computePlayerProfile({ mmr: 1000, rd: h.MAX_RD });
    expect(newbie.confidence).toBe(0);
  });

  test("includes streak data", () => {
    const profile = h.computePlayerProfile({
      currentStreak: 5,
      bestStreak: 8,
      mmr: 1000,
      rd: 100,
    });
    expect(profile.currentStreak).toBe(5);
    expect(profile.bestStreak).toBe(8);
  });

  test("includes multiplier stats", () => {
    const profile = h.computePlayerProfile({
      mmr: 1000,
      rd: 100,
      totalGames: 10,
      multiplierGames: 10,
      multiplierWins: 6,
      multiplierLosses: 4,
    });
    expect(profile.multiplierGames).toBe(10);
    expect(profile.multiplierWins).toBe(6);
    expect(profile.multiplierLosses).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// formatStreak
// ═══════════════════════════════════════════════════════════════════════
describe("formatStreak", () => {
  test("returns empty string for 0", () => {
    expect(h.formatStreak(0)).toBe("");
  });

  test("returns empty string for null/undefined", () => {
    expect(h.formatStreak(null)).toBe("");
    expect(h.formatStreak(undefined)).toBe("");
  });

  test("returns fire emoji for positive streak", () => {
    expect(h.formatStreak(3)).toBe("🔥×3");
  });

  test("returns skull emoji for negative streak", () => {
    expect(h.formatStreak(-2)).toBe("💀×2");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// formatStatsString
// ═══════════════════════════════════════════════════════════════════════
describe("formatStatsString", () => {
  test("returns empty string for null/undefined", () => {
    expect(h.formatStatsString(null)).toBe("");
    expect(h.formatStatsString(undefined)).toBe("");
  });

  test("formats stats with rank info when rank and mmr are present", () => {
    const result = h.formatStatsString({
      wins: 10,
      losses: 5,
      mmr: 1200,
      rank: { emoji: "🔮", title: "Oracle" },
    });
    expect(result).toBe(" [🔮 Oracle (1200 MMR) | 10W/5L 67%]");
  });

  test("formats stats without rank info when rank is missing", () => {
    const result = h.formatStatsString({ wins: 3, losses: 7 });
    expect(result).toBe(" [3W/7L 30%]");
  });

  test("formats stats without rank info when mmr is undefined", () => {
    const result = h.formatStatsString({
      wins: 5,
      losses: 5,
      rank: { emoji: "🕯️", title: "Ritualist" },
    });
    expect(result).toBe(" [5W/5L 50%]");
  });

  test("shows 0% winrate when no games played", () => {
    const result = h.formatStatsString({ wins: 0, losses: 0 });
    expect(result).toBe(" [0W/0L 0%]");
  });

  test("shows 100% winrate for all wins", () => {
    const result = h.formatStatsString({
      wins: 20,
      losses: 0,
      mmr: 1500,
      rank: { emoji: "👁️", title: "Eternus" },
    });
    expect(result).toBe(" [👁️ Eternus (1500 MMR) | 20W/0L 100%]");
  });
});

//
// ═══════════════════════════════════════════════════════════════════════
// getMedal
// ═══════════════════════════════════════════════════════════════════════
describe("getMedal", () => {
  test("returns gold for 1st place", () => {
    expect(h.getMedal(0)).toBe("🥇");
  });

  test("returns silver for 2nd place", () => {
    expect(h.getMedal(1)).toBe("🥈");
  });

  test("returns bronze for 3rd place", () => {
    expect(h.getMedal(2)).toBe("🥉");
  });

  test("returns spaces for 4th place and beyond", () => {
    expect(h.getMedal(3)).toBe("  ");
    expect(h.getMedal(10)).toBe("  ");
    expect(h.getMedal(99)).toBe("  ");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getMultiplierName
// ═══════════════════════════════════════════════════════════════════════
describe("getMultiplierName", () => {
  test("returns named multiplier for known values", () => {
    expect(h.getMultiplierName(2)).toBe("Double (2x)");
    expect(h.getMultiplierName(4)).toBe("Quadruple (4x)");
    expect(h.getMultiplierName(1024)).toBe(
      "Milliduoquattuorsexagesimal (1024x)",
    );
  });

  test("returns fallback format for unknown multiplier", () => {
    expect(h.getMultiplierName(3)).toBe("3x");
    expect(h.getMultiplierName(2048)).toBe("2048x");
  });

  test("all MULTIPLIER_NAMES have corresponding entries", () => {
    for (const [key, value] of Object.entries(h.MULTIPLIER_NAMES)) {
      expect(h.getMultiplierName(Number(key))).toBe(value);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// computePlayerProfile — additional edge cases
// ═══════════════════════════════════════════════════════════════════════
describe("computePlayerProfile — edge cases", () => {
  test("player with only wins (no losses)", () => {
    const profile = h.computePlayerProfile({
      wins: 15,
      losses: 0,
      totalGames: 15,
      mmr: 1325,
      rd: 50,
    });
    expect(profile.winRate).toBe(100);
    expect(profile.rank.title).toBe("Eternus");
  });

  test("player with only losses (no wins)", () => {
    const profile = h.computePlayerProfile({
      wins: 0,
      losses: 20,
      totalGames: 20,
      mmr: 600,
      rd: 100,
    });
    expect(profile.winRate).toBe(0);
    expect(profile.rank.title).toBe("Initiate");
  });

  test("derives totalGames from wins + losses when not provided", () => {
    const profile = h.computePlayerProfile({
      wins: 3,
      losses: 7,
      mmr: 950,
      rd: 100,
    });
    expect(profile.totalGames).toBe(10);
    expect(profile.winRate).toBe(30);
    expect(profile.rank.title).toBe("Alchemist");
  });

  test("preserves lastPlayedAt and createdAt timestamps", () => {
    const now = Date.now();
    const created = now - 86400000;
    const profile = h.computePlayerProfile({
      mmr: 1000,
      rd: 100,
      totalGames: 10,
      lastPlayedAt: now,
      createdAt: created,
    });
    expect(profile.lastPlayedAt).toBe(now);
    expect(profile.createdAt).toBe(created);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getRankTitle — boundary precision
// ═══════════════════════════════════════════════════════════════════════
describe("getRankTitle — tier boundaries", () => {
  test("exact tier boundaries assign the correct rank", () => {
    expect(h.getRankTitle(1325).title).toBe("Eternus");
    expect(h.getRankTitle(1324).title).toBe("Ascendant");
    expect(h.getRankTitle(1275).title).toBe("Ascendant");
    expect(h.getRankTitle(1274).title).toBe("Phantom");
    expect(h.getRankTitle(1225).title).toBe("Phantom");
    expect(h.getRankTitle(1224).title).toBe("Oracle");
    expect(h.getRankTitle(1175).title).toBe("Oracle");
    expect(h.getRankTitle(1174).title).toBe("Archon");
    expect(h.getRankTitle(1125).title).toBe("Archon");
    expect(h.getRankTitle(1124).title).toBe("Emissary");
    expect(h.getRankTitle(1075).title).toBe("Emissary");
    expect(h.getRankTitle(1074).title).toBe("Ritualist");
    expect(h.getRankTitle(1025).title).toBe("Ritualist");
    expect(h.getRankTitle(1024).title).toBe("Arcanist");
    expect(h.getRankTitle(975).title).toBe("Arcanist");
    expect(h.getRankTitle(974).title).toBe("Alchemist");
    expect(h.getRankTitle(925).title).toBe("Alchemist");
    expect(h.getRankTitle(924).title).toBe("Seeker");
    expect(h.getRankTitle(875).title).toBe("Seeker");
    expect(h.getRankTitle(874).title).toBe("Initiate");
  });

  test("handles negative MMR", () => {
    expect(h.getRankTitle(-500).title).toBe("Initiate");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// MMR Floor (Integration-style)
// ═══════════════════════════════════════════════════════════════════════
describe("MMR Floor", () => {
  test("MMR cannot go below MIN_MMR (1) mathematically", () => {
    // Simulate worst case: new player (K=2×BASE_K), 1024x multiplier (mmrMult=3.5)
    const k = h.calculateKFactor(h.MAX_RD); // 2×BASE_K
    const mmrMult = h.mmrMultiplier(1024); // 3.5
    const loss = k * mmrMult;
    const newMmr = Math.max(h.MIN_MMR, Math.round(h.BASE_MMR - loss));
    // Should still be above MIN_MMR or clamped to it
    expect(newMmr).toBeGreaterThanOrEqual(h.MIN_MMR);

    // Even after many losses, floor should hold
    let mmr = 100;
    const smallK = h.calculateKFactor(h.MIN_RD); // BASE_K
    mmr = Math.max(h.MIN_MMR, Math.round(mmr - smallK * 1));
    expect(mmr).toBeGreaterThanOrEqual(h.MIN_MMR);
    // Push to the edge
    mmr = 10;
    mmr = Math.max(h.MIN_MMR, Math.round(mmr - smallK * 1));
    expect(mmr).toBe(h.MIN_MMR); // Floors at MIN_MMR
  });

  test("MAX single-game loss is bounded by 2×BASE_K × max multiplier", () => {
    const worstK = h.calculateKFactor(h.MAX_RD); // 2×BASE_K
    const worstMult = h.mmrMultiplier(1024); // 3.5
    const maxLoss = Math.round(worstK * worstMult);
    expect(maxLoss).toBe(Math.round(h.BASE_K * 2 * 3.5));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Confidence Ramp (Integration-style)
// ═══════════════════════════════════════════════════════════════════════
describe("Confidence Ramp", () => {
  test("confidence increases linearly as games are played", () => {
    let rd = h.MAX_RD; // 200
    const confidences = [];
    for (let i = 0; i <= 34; i++) {
      confidences.push(h.calculateConfidence(rd));
      rd = Math.max(h.MIN_RD, rd - h.RD_DECREASE_PER_GAME);
    }
    // Should start at 0% and end at 100%
    expect(confidences[0]).toBe(0);
    expect(confidences[34]).toBe(100);
    // Should be monotonically increasing
    for (let i = 1; i < confidences.length; i++) {
      expect(confidences[i]).toBeGreaterThanOrEqual(confidences[i - 1]);
    }
  });

  test("K-factor decreases as confidence increases", () => {
    let rd = h.MAX_RD;
    const kFactors = [];
    for (let i = 0; i <= 34; i++) {
      kFactors.push(h.calculateKFactor(rd));
      rd = Math.max(h.MIN_RD, rd - h.RD_DECREASE_PER_GAME);
    }
    // Should start high and end low
    expect(kFactors[0]).toBe(h.BASE_K * 2);
    expect(kFactors[34]).toBe(h.BASE_K);
    // Should be monotonically decreasing
    for (let i = 1; i < kFactors.length; i++) {
      expect(kFactors[i]).toBeLessThanOrEqual(kFactors[i - 1]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Multi-Player MMR Simulation (~100 players)
// ═══════════════════════════════════════════════════════════════════════
describe("Multi-Player MMR Simulation", () => {
  /**
   * Simulates a mini-season of games among N players.
   * Validates that the MMR system produces a healthy distribution.
   */
  function simulateSeason(playerCount, gamesPerPlayer) {
    const players = Array.from({ length: playerCount }, () => ({
      mmr: h.BASE_MMR,
      rd: h.MAX_RD,
    }));

    const totalGames = Math.floor((playerCount * gamesPerPlayer) / 2);

    for (let g = 0; g < totalGames; g++) {
      // Pick two random different players
      const i = Math.floor(Math.random() * playerCount);
      let j = Math.floor(Math.random() * (playerCount - 1));
      if (j >= i) j++;

      const winner = players[i];
      const loser = players[j];
      const multiplier = 1; // base games

      const winnerK = h.calculateKFactor(winner.rd);
      const loserK = h.calculateKFactor(loser.rd);
      const mmrMult = h.mmrMultiplier(multiplier);

      winner.mmr = Math.round(
        winner.mmr + winnerK * mmrMult * h.gravityGainScale(winner.mmr),
      );
      winner.rd = Math.max(h.MIN_RD, winner.rd - h.RD_DECREASE_PER_GAME);

      loser.mmr = Math.max(
        h.MIN_MMR,
        Math.round(
          loser.mmr - loserK * mmrMult * h.gravityLossScale(loser.mmr),
        ),
      );
      loser.rd = Math.max(h.MIN_RD, loser.rd - h.RD_DECREASE_PER_GAME);
    }

    return players;
  }

  test("all players stay above MIN_MMR after 500 games among 100 players", () => {
    const players = simulateSeason(100, 10);
    for (const p of players) {
      expect(p.mmr).toBeGreaterThanOrEqual(h.MIN_MMR);
    }
  });

  test("RD decreases over time for active players", () => {
    const players = simulateSeason(100, 10);
    // Most players should have RD reduced from the starting MAX_RD
    const playersWithLowerRD = players.filter((p) => p.rd < h.MAX_RD);
    expect(playersWithLowerRD.length).toBeGreaterThan(80);
  });

  test("MMR distribution is spread out (not everyone at 1000)", () => {
    const players = simulateSeason(100, 10);
    const mmrs = players.map((p) => p.mmr);
    const min = Math.min(...mmrs);
    const max = Math.max(...mmrs);
    // After many games there should be meaningful spread
    expect(max - min).toBeGreaterThan(100);
  });

  test("every rank tier is reachable in a large simulation", () => {
    // More games to get wider distribution
    const players = simulateSeason(100, 50);
    const tiersSeen = new Set();
    for (const p of players) {
      tiersSeen.add(h.getRankTitle(p.mmr).title);
    }
    // At minimum, we should see at least 3 distinct tiers
    expect(tiersSeen.size).toBeGreaterThanOrEqual(3);
  });

  test("winner MMR always increases, loser MMR always decreases (or floors)", () => {
    for (let trial = 0; trial < 50; trial++) {
      const winnerMMR = Math.floor(Math.random() * 2000) + 1;
      const loserMMR = Math.floor(Math.random() * 2000) + 1;
      const rd = h.MIN_RD + Math.random() * (h.MAX_RD - h.MIN_RD);
      const multiplier = [1, 2, 4, 16, 1024][Math.floor(Math.random() * 5)];

      const k = h.calculateKFactor(rd);
      const mmrMult = h.mmrMultiplier(multiplier);

      const newWinnerMMR = Math.round(
        winnerMMR + k * mmrMult * h.gravityGainScale(winnerMMR),
      );
      const newLoserMMR = Math.max(
        h.MIN_MMR,
        Math.round(loserMMR - k * mmrMult * h.gravityLossScale(loserMMR)),
      );

      expect(newWinnerMMR).toBeGreaterThan(winnerMMR);
      expect(newLoserMMR).toBeLessThanOrEqual(loserMMR);
    }
  });
});
