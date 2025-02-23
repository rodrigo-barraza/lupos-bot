const express = require('express');
const router = new express.Router();
const WebHookService = require('./WebHookService/WebHookService');

const routes = () => {
    WebHookService(router);
    return router;
};

module.exports = routes;
