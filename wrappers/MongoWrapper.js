const { MongoClient } = require('mongodb');
const LogFormatter = require('../formatters/LogFormatter.js');

let clients = new Map();

const MongoWrapper = {
  async createClient (name, uri) {
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
  },
  getClient (name) {
    return clients.get(name);
  },
  closeClient (name) {
    const client = clients.get(name);
    if (client) {
      client.close();
      clients.delete(name);
    }
  },
};

module.exports = MongoWrapper;
