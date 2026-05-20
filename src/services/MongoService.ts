import { MongoClient, Db } from "mongodb";
import LogFormatter from "#root/formatters/LogFormatter.js";
import { MONGO_DB_NAME } from "#root/constants.js";

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
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(...LogFormatter.mongoConnectionError(name, err));
      throw err;
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

  static closeClient(name: string): void {
    const client = clients.get(name);
    if (client) {
      client.close();
      clients.delete(name);
    }
  }
}
