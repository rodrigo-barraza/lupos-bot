import { MongoClient } from "mongodb";
import LogFormatter from "#root/formatters/LogFormatter.js";

const clients = new Map();

export default class MongoService {
  static async createClient(name, uri) {
    try {
      const client = new MongoClient(uri);
      await client.connect();
      clients.set(name, client);
      console.log(...LogFormatter.mongoConnectionSuccess(name));
      return client;
    } catch (error) {
      console.error(...LogFormatter.mongoConnectionError(name, error));
      throw error;
    }
  }

  static getClient(name) {
    return clients.get(name);
  }

  static closeClient(name) {
    const client = clients.get(name);
    if (client) {
      client.close();
      clients.delete(name);
    }
  }
}
