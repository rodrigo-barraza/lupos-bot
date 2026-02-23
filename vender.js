'use strict';

// Environment setup
import 'dotenv/config';
process.env.NODE_NO_WARNINGS = 'stream/web';

// Dependencies
// import { MongoClient } from 'mongodb';
import config from './config.json' with { type: 'json' };
// const UtilityLibrary = require('./libraries/UtilityLibrary.js');
import DiscordService from './services/DiscordService.js';
import LogFormatter from './formatters/LogFormatter.js';
// const MongoWrapper = require('./wrappers/MongoWrapper.js');

import express from 'express';
import bodyParser from 'body-parser';
const app = express();
import services from './services/services.js';

// Parse command line arguments
const args = process.argv.slice(2);
const mode = args.find(arg => arg.startsWith('mode='))?.split('=')[1];

function main() {
    try {
        console.log("Initializing Sticker Vending Machine...");
        DiscordService.initializeBotLupos();


        // DISCORD REPORTING: LUPOS

        // API SERVER
        app.use(bodyParser.json());
        app.use(bodyParser.urlencoded({ extended: true }));
        app.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
            res.setHeader('Access-Control-Allow-Headers', '*');
            res.setHeader('Access-Control-Allow-Credentials', true);
            next();
        });
        app.use('/', services());
        app.listen(config.SERVER_PORT, () => {
            console.log(`Server listening on port ${config.SERVER_PORT}`);
        });

        // HOME ASSISTANT
    } catch (error) {
        console.log(LogFormatter.errorInitialization(error));
        // UtilityLibrary.consoleInfoColor([[`Initialization failed: \n${error}`, { bold: true, color: 'red' }]]);
        // process.exit(1);
    }
}

main();
