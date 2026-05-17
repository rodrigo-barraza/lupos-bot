import { MongoClient } from "mongodb";
import LogFormatter from "#root/formatters/LogFormatter.js";
import { MONGO_DB_NAME } from "#root/constants.js";

const clients = new Map();

export default class MongoService {
  static async createClient(name: any, uri: any) {
    try {
      const client = new MongoClient(uri);
      await client.connect();
      clients.set(name, client);
      console.log(...LogFormatter.mongoConnectionSuccess(name));
      return client;
    } catch (error: any) {
      console.error(...LogFormatter.mongoConnectionError(name, error));
      throw error;
    }
  }

  static getClient(name: any) {
    return clients.get(name);
  }

  /**
   * Convenience: returns the Lupos database from a named client.
   * Eliminates the repeated `mongoClient.db(MONGO_DB_NAME)` pattern.


   */
  static getDb(name: any) {
    const client = clients.get(name);
    if (!client) throw new Error(`MongoService: no client named "${name}"`);
    return client.db(MONGO_DB_NAME);
  }

  static closeClient(name: any) {
    const client = clients.get(name);
    if (client) {
      client.close();
      clients.delete(name);
    }
  }
}
