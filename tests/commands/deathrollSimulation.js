/**
 * Deathroll MMR Simulation
 *
 * Standalone script to simulate deathroll games and visualize the MMR
 * distribution across rank tiers. Imports constants and functions
 * directly from deathrollUtils.js — single source of truth.
 *
 * Usage:
 *   node tests/commands/deathrollSimulation.js
 *   node tests/commands/deathrollSimulation.js --players 500 --games 30000 --trials 10
 *
 * This file is NOT a bot command — it lives in tests/ which is never
 * scanned by the command loader (commands/*\/*.js only).
 */

import { _testHelpers as h } from "../../commands/utility/deathrollUtils.js";

const {
    BASE_MMR, MIN_MMR, MAX_RD, MIN_RD, BASE_K,
    RD_DECREASE_PER_GAME, GRAVITY_STRENGTH, GRAVITY_RANGE, GRAVITY_CENTER,
    RANK_TIERS,
    calculateKFactor, mmrMultiplier,
    gravityGainScale, gravityLossScale, getRankTitle,
} = h;

// ─── Parse CLI Arguments ─────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? Number(args[idx + 1]) : defaultVal;
}

const PLAYER_COUNT = getArg("players", 1000);
const TOTAL_GAMES = getArg("games", 50000);
const TRIALS = getArg("trials", 5);
const DON_PROBABILITY = 0.5; // 50% chance to propose Double or Nothing

// ─── Simulation Engine ───────────────────────────────────────────────

function runSimulation() {
    const mmrs = new Float64Array(PLAYER_COUNT).fill(BASE_MMR);
    const rds = new Float64Array(PLAYER_COUNT).fill(MAX_RD);

    let donGames = 0;
    let highestMultiplier = 1;

    for (let g = 0; g < TOTAL_GAMES; g++) {
        // Pick two random different players
        const i = (Math.random() * PLAYER_COUNT) | 0;
        let j = (Math.random() * (PLAYER_COUNT - 1)) | 0;
        if (j >= i) j++;

        // Random winner (deathroll is pure luck)
        let winnerId = Math.random() < 0.5 ? i : j;
        let loserId = winnerId === i ? j : i;

        // Double or Nothing cascade
        let multiplier = 1;
        while (Math.random() < DON_PROBABILITY) {
            multiplier *= 2;
            donGames++;
            // Coin flip on each DoN round
            if (Math.random() < 0.5) {
                const tmp = winnerId;
                winnerId = loserId;
                loserId = tmp;
            }
        }
        if (multiplier > highestMultiplier) highestMultiplier = multiplier;

        // Calculate MMR changes with gravity
        const winnerK = calculateKFactor(rds[winnerId]);
        const loserK = calculateKFactor(rds[loserId]);
        const mmrMult = mmrMultiplier(multiplier);

        mmrs[winnerId] = Math.round(
            mmrs[winnerId] + winnerK * mmrMult * gravityGainScale(mmrs[winnerId])
        );
        rds[winnerId] = Math.max(MIN_RD, rds[winnerId] - RD_DECREASE_PER_GAME);

        mmrs[loserId] = Math.max(
            MIN_MMR,
            Math.round(mmrs[loserId] - loserK * mmrMult * gravityLossScale(mmrs[loserId]))
        );
        rds[loserId] = Math.max(MIN_RD, rds[loserId] - RD_DECREASE_PER_GAME);
    }

    // Collect results
    const tierDist = {};
    for (const tier of RANK_TIERS) tierDist[tier.title] = 0;

    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < PLAYER_COUNT; i++) {
        tierDist[getRankTitle(mmrs[i]).title]++;
        sum += mmrs[i];
        if (mmrs[i] < min) min = mmrs[i];
        if (mmrs[i] > max) max = mmrs[i];
    }

    const avg = Math.round(sum / PLAYER_COUNT);
    let variance = 0;
    for (let i = 0; i < PLAYER_COUNT; i++) variance += (mmrs[i] - avg) ** 2;
    const std = Math.round(Math.sqrt(variance / PLAYER_COUNT));

    return { avg, std, min, max, tierDist, donGames, highestMultiplier };
}

// ─── Run Trials & Print Results ──────────────────────────────────────

console.log("═".repeat(90));
console.log(
    `  DEATHROLL MMR SIMULATION — ${PLAYER_COUNT} players, ${TOTAL_GAMES} games, ` +
    `50% DoN (avg of ${TRIALS} trials)`
);
console.log(
    `  Config: BASE_K=${BASE_K}, GRAVITY_STRENGTH=${GRAVITY_STRENGTH}, ` +
    `GRAVITY_RANGE=${GRAVITY_RANGE}, GRAVITY_CENTER=${GRAVITY_CENTER}`
);
console.log("═".repeat(90));

const trials = [];
for (let t = 0; t < TRIALS; t++) {
    trials.push(runSimulation());
}

// Average tier distribution across trials
const avgTierDist = {};
for (const tier of RANK_TIERS) {
    avgTierDist[tier.title] = Math.round(
        trials.reduce((s, tr) => s + tr.tierDist[tier.title], 0) / TRIALS
    );
}

const avgAvg = Math.round(trials.reduce((s, t) => s + t.avg, 0) / TRIALS);
const avgStd = Math.round(trials.reduce((s, t) => s + t.std, 0) / TRIALS);
const avgMin = Math.round(trials.reduce((s, t) => s + t.min, 0) / TRIALS);
const avgMax = Math.round(trials.reduce((s, t) => s + t.max, 0) / TRIALS);

console.log(`\n  📈 Summary Statistics`);
console.log(`  ${"─".repeat(40)}`);
console.log(`  MMR Average:       ${avgAvg}`);
console.log(`  MMR Std Dev:       ${avgStd}`);
console.log(`  MMR Range:         ${avgMin} – ${avgMax}`);
console.log(`  MMR Spread:        ${avgMax - avgMin}`);

// Check targets
const duelistIsPeak = avgTierDist["Duelist"] >= avgTierDist["Roller"];
const hasKing = avgTierDist["Deathroll King"] > 0;
console.log(`  Duelist is peak:   ${duelistIsPeak ? "✓ YES" : "✗ NO"}`);
console.log(`  King reachable:    ${hasKing ? "✓ YES" : "✗ NO"}`);

console.log(`\n  🏆 Rank Distribution`);
console.log(`  ${"─".repeat(60)}`);

const maxCount = Math.max(...Object.values(avgTierDist), 1);
for (const tier of RANK_TIERS) {
    const count = avgTierDist[tier.title];
    const pct = ((count / PLAYER_COUNT) * 100).toFixed(1);
    const bar = "█".repeat(Math.round((count / maxCount) * 40));
    console.log(
        `    ${tier.emoji} ${tier.title.padEnd(16)} ` +
        `${String(count).padStart(5)} (${pct.padStart(5)}%) │ ${bar}`
    );
}

// Mirror symmetry check
console.log(`\n  🪞 Symmetry Check (mirror pairs around Duelist)`);
console.log(`  ${"─".repeat(40)}`);
const pairs = [
    ["Veteran", "Roller"],
    ["Champion", "Grave"],
    ["Diamond + King", "Cursed"],
];
const pairValues = [
    [avgTierDist["Veteran"], avgTierDist["Roller"]],
    [avgTierDist["Champion"], avgTierDist["Grave"]],
    [avgTierDist["Diamond"] + avgTierDist["Deathroll King"], avgTierDist["Cursed"]],
];
for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairValues[i];
    const ratio = Math.min(a, b) > 0
        ? (Math.min(a, b) / Math.max(a, b) * 100).toFixed(0)
        : "0";
    console.log(
        `    ${pairs[i][0].padEnd(14)} (${a}) vs ${pairs[i][1].padEnd(8)} (${b})  → ${ratio}% symmetric`
    );
}

console.log("\n" + "═".repeat(90));
