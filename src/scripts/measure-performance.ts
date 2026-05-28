#!/usr/bin/env node
import { MongoClient } from "mongodb";
import fs from "fs";

async function main() {
  console.log("🔌 Hydrating env from vault_secrets_nas_new.json...");
  try {
    const secretsContent = fs.readFileSync("/home/rodrigo/development/vault_secrets_nas_new.json", "utf-8");
    const secrets = JSON.parse(secretsContent);
    for (const [key, value] of Object.entries(secrets)) {
      if (process.env[key] === undefined) process.env[key] = value as string;
    }
  } catch (err) {
    console.error("⚠️ Failed to load local vault secrets fallback:", err);
  }

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("❌ MONGO_URI is not set!");
    process.exit(1);
  }

  console.log("🔌 Connecting to MongoDB...");
  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db("lupos");
  const messagesCollection = db.collection("Messages");

  console.log("🔌 Ensuring compound indexes on Messages collection...");
  await messagesCollection.createIndex({ guildId: 1, createdTimestamp: -1 }, { background: true });
  await messagesCollection.createIndex({ guildId: 1, channelId: 1, createdTimestamp: -1 }, { background: true });
  await messagesCollection.createIndex({ guildId: 1, "mentions.users.id": 1, createdTimestamp: -1 }, { background: true });
  await messagesCollection.createIndex({ guildId: 1, "author.id": 1, createdTimestamp: -1 }, { background: true });
  console.log("🔌 Messages indexes ensured!");

  console.log("📊 Discovering test parameters from active messages...");
  
  // Discover an active guild and author
  const activeMessage = await messagesCollection.findOne({ guildId: { $exists: true }, "author.id": { $exists: true } });
  if (!activeMessage) {
    console.error("❌ No messages found in database to extract test parameters!");
    await mongoClient.close();
    process.exit(1);
  }

  const guildId = activeMessage.guildId;
  const authorId = activeMessage.author.id;
  const authorUsername = activeMessage.author.username;
  console.log(`   * Guild ID: ${guildId}`);
  console.log(`   * Author: ${authorUsername} (${authorId})`);

  // Discover an active mention
  const mentionMessage = await messagesCollection.findOne({ 
    guildId, 
    "mentions.users.0": { $exists: true } 
  });
  
  let targetUserMentionId = authorId;
  let targetUserMentionUsername = authorUsername;

  if (mentionMessage && mentionMessage.mentions && mentionMessage.mentions.users.length > 0) {
    targetUserMentionId = mentionMessage.mentions.users[0].id;
    targetUserMentionUsername = mentionMessage.mentions.users[0].username;
  }
  console.log(`   * Target Mention User: ${targetUserMentionUsername} (${targetUserMentionId})`);
  console.log();

  // One year lookback
  const unixStartDate = Date.now() - 365 * 24 * 60 * 60 * 1000;

  console.log("═══════════════════════════════════════════════════════════");
  console.log("⏱️  BENCHMARK 1: /mentions Command Query");
  console.log("═══════════════════════════════════════════════════════════");
  
  const mentionsFilter = {
    createdTimestamp: { $gte: unixStartDate },
    guildId,
    "mentions.users": {
      $elemMatch: { id: targetUserMentionId }
    }
  };

  // Scenario A: Without Index (COLLSCAN)
  console.log("⏳ Running query WITHOUT index (forcing COLLSCAN via natural hint)...");
  const explainCollscanMentions = await messagesCollection
    .find(mentionsFilter)
    .hint({ $natural: 1 })
    .explain("executionStats");

  const collscanMentionsStats = explainCollscanMentions.executionStats;
  console.log(`   * Execution Time: ${collscanMentionsStats.executionTimeMillis} ms`);
  console.log(`   * Docs Examined: ${collscanMentionsStats.totalDocsExamined}`);
  console.log(`   * Keys Examined: ${collscanMentionsStats.totalKeysExamined}`);
  console.log(`   * Stage: COLLSCAN`);

  // Scenario B: With Index (IXSCAN)
  console.log("\n⚡ Running query WITH index (IXSCAN on mentions.users.id)...");
  const explainIxscanMentions = await messagesCollection
    .find(mentionsFilter)
    .hint({ guildId: 1, "mentions.users.id": 1, createdTimestamp: -1 })
    .explain("executionStats");

  const ixscanMentionsStats = explainIxscanMentions.executionStats;
  console.log(`   * Execution Time: ${ixscanMentionsStats.executionTimeMillis} ms`);
  console.log(`   * Docs Examined: ${ixscanMentionsStats.totalDocsExamined}`);
  console.log(`   * Keys Examined: ${ixscanMentionsStats.totalKeysExamined}`);
  console.log(`   * Stage: IXSCAN`);

  const mentionsSpeedup = collscanMentionsStats.executionTimeMillis / Math.max(1, ixscanMentionsStats.executionTimeMillis);
  console.log(`\n🎉 Speedup: ${mentionsSpeedup.toFixed(1)}x faster execution time!`);
  console.log(`📉 Documents Examined reduced by: ${(collscanMentionsStats.totalDocsExamined - ixscanMentionsStats.totalDocsExamined).toLocaleString()} docs!`);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("⏱️  BENCHMARK 2: Heatmap/Wordcloud User Activity Query");
  console.log("═══════════════════════════════════════════════════════════");
  
  const userActivityFilter = {
    createdTimestamp: { $gte: unixStartDate },
    guildId,
    "author.id": authorId,
    "author.bot": { $ne: true }
  };

  // Scenario A: Without Index (COLLSCAN)
  console.log("⏳ Running query WITHOUT index (forcing COLLSCAN via natural hint)...");
  const explainCollscanUser = await messagesCollection
    .find(userActivityFilter)
    .hint({ $natural: 1 })
    .explain("executionStats");

  const collscanUserStats = explainCollscanUser.executionStats;
  console.log(`   * Execution Time: ${collscanUserStats.executionTimeMillis} ms`);
  console.log(`   * Docs Examined: ${collscanUserStats.totalDocsExamined}`);
  console.log(`   * Keys Examined: ${collscanUserStats.totalKeysExamined}`);
  console.log(`   * Stage: COLLSCAN`);

  // Scenario B: With Index (IXSCAN)
  console.log("\n⚡ Running query WITH index (IXSCAN on author.id)...");
  const explainIxscanUser = await messagesCollection
    .find(userActivityFilter)
    .hint({ guildId: 1, "author.id": 1, createdTimestamp: -1 })
    .explain("executionStats");

  const ixscanUserStats = explainIxscanUser.executionStats;
  console.log(`   * Execution Time: ${ixscanUserStats.executionTimeMillis} ms`);
  console.log(`   * Docs Examined: ${ixscanUserStats.totalDocsExamined}`);
  console.log(`   * Keys Examined: ${ixscanUserStats.totalKeysExamined}`);
  console.log(`   * Stage: IXSCAN`);

  const userSpeedup = collscanUserStats.executionTimeMillis / Math.max(1, ixscanUserStats.executionTimeMillis);
  console.log(`\n🎉 Speedup: ${userSpeedup.toFixed(1)}x faster execution time!`);
  console.log(`📉 Documents Examined reduced by: ${(collscanUserStats.totalDocsExamined - ixscanUserStats.totalDocsExamined).toLocaleString()} docs!`);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("⏱️  BENCHMARK 3: Wordcloud Scoping Fix (Unscoped vs Scoped)");
  console.log("═══════════════════════════════════════════════════════════");

  const unscopedFilter = {
    "author.id": authorId,
    createdTimestamp: { $gte: unixStartDate }
  };

  const scopedFilter = {
    guildId,
    "author.id": authorId,
    createdTimestamp: { $gte: unixStartDate }
  };

  // Unscoped
  console.log("⏳ Running UNSCOPED query (the security & performance bug)...");
  const explainUnscoped = await messagesCollection
    .find(unscopedFilter)
    .hint({ $natural: 1 })
    .explain("executionStats");

  const unscopedStats = explainUnscoped.executionStats;
  console.log(`   * Execution Time: ${unscopedStats.executionTimeMillis} ms`);
  console.log(`   * Docs Examined: ${unscopedStats.totalDocsExamined}`);
  console.log(`   * Keys Examined: ${unscopedStats.totalKeysExamined}`);
  console.log(`   * Stage: COLLSCAN`);

  // Scoped with Index
  console.log("\n⚡ Running SCOPED query with compound index...");
  const explainScoped = await messagesCollection
    .find(scopedFilter)
    .hint({ guildId: 1, "author.id": 1, createdTimestamp: -1 })
    .explain("executionStats");

  const scopedStats = explainScoped.executionStats;
  console.log(`   * Execution Time: ${scopedStats.executionTimeMillis} ms`);
  console.log(`   * Docs Examined: ${scopedStats.totalDocsExamined}`);
  console.log(`   * Keys Examined: ${scopedStats.totalKeysExamined}`);
  console.log(`   * Stage: IXSCAN`);

  const scopingSpeedup = unscopedStats.executionTimeMillis / Math.max(1, scopedStats.executionTimeMillis);
  console.log(`\n🎉 Speedup: ${scopingSpeedup.toFixed(1)}x faster execution time!`);
  console.log(`📉 Documents Examined reduced by: ${(unscopedStats.totalDocsExamined - scopedStats.totalDocsExamined).toLocaleString()} docs!`);
  console.log("═══════════════════════════════════════════════════════════\n");

  await mongoClient.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
