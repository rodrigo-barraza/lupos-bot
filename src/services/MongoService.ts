import { MongoClient, Db } from "mongodb";
import LogFormatter from "#root/formatters/LogFormatter.ts";
import { MONGO_DB_NAME } from "#root/constants.ts";

const clients = new Map<string, MongoClient>();

export default class MongoService {
  static async createClient(name: string, uri: string): Promise<MongoClient> {
    try {
      const client = new MongoClient(uri);
      await client.connect();
      clients.set(name, client);
      console.log(...LogFormatter.mongoConnectionSuccess(name));
      return client;
    } catch (error: unknown) {
      const typedError =
        error instanceof Error ? error : new Error(String(error));
      console.error(...LogFormatter.mongoConnectionError(name, typedError));
      throw typedError;
    }
  }

  static getClient(name: string): MongoClient | undefined {
    return clients.get(name);
  }

  /**
   * Convenience: returns the Lupos database from a named client.
   * Eliminates the repeated `mongoClient.db(MONGO_DB_NAME)` pattern.
   */
  static getDb(name: string): Db {
    const client = clients.get(name);
    if (!client) throw new Error(`MongoService: no client named "${name}"`);
    return client.db(MONGO_DB_NAME);
  }

  static async closeClient(name: string): Promise<void> {
    const client = clients.get(name);
    if (client) {
      await client.close();
      clients.delete(name);
    }
  }

  /**
   * Close every registered client. Used by graceful shutdown so no
   * connection is missed regardless of what name it was registered under.
   */
  static async closeAll(): Promise<void> {
    for (const [name, client] of clients) {
      try {
        await client.close();
        console.log(`  ✓ MongoDB client "${name}" closed`);
      } catch (error: unknown) {
        console.warn(
          `  ⚠️ Failed to close MongoDB client "${name}": ${(error as Error).message}`,
        );
      }
    }
    clients.clear();
  }
}
