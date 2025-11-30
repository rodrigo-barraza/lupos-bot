const BigNumber = require('bignumber.js');

let user = null;
let message = null;
let startTime = null;
let endTime = null;

let textTotalInputTokens = null;
let textTotalInputCost = null;

let textTotalOutputTokens = null;
let textTotalOutputCost = null;

let models = new Set();
let modelTypes = new Set();

let textTotalCost = null;

const CurrentService = {
    setUser(newUser) {
        user = newUser;
    },
    getUser() {
        return user;
    },
    setMessage(newMessage) {
        message = newMessage;
    },
    getMessage() {
        return message;
    },
    setStartTime(newStartTime) {
        startTime = newStartTime;
    },
    getStartTime() {
        return startTime;
    },
    setEndTime(newEndTime) {
        endTime = newEndTime;
    },
    getEndTime() {
        return endTime;
    },
    addToTextTotalInputTokens(amount) {
        if (textTotalInputTokens === null) {
            textTotalInputTokens = 0;
        }
        textTotalInputTokens += amount;
    },
    clearTextTotalInputTokens() {
        textTotalInputTokens = null;
    },
    getTextTotalInputTokens() {
        return textTotalInputTokens;
    },
    addToTextTotalInputCost(amount) {
        if (textTotalInputCost === null) {
            textTotalInputCost = new BigNumber(0);
        }
        textTotalInputCost = textTotalInputCost.plus(amount);
    },
    clearTextTotalInputCost() {
        textTotalInputCost = null;
    },
    getTextTotalInputCost() {
        return textTotalInputCost ? textTotalInputCost.toFixed(10) : null;
    },
    addToTextTotalOutputTokens(amount) {
        if (textTotalOutputTokens === null) {
            textTotalOutputTokens = 0;
        }
        textTotalOutputTokens += amount;
    },
    clearTextTotalOutputTokens() {
        textTotalOutputTokens = null;
    },
    getTextTotalOutputTokens() {
        return textTotalOutputTokens;
    },
    addToTextTotalOutputCost(amount) {
        if (textTotalOutputCost === null) {
            textTotalOutputCost = new BigNumber(0);
        }
        textTotalOutputCost = textTotalOutputCost.plus(amount);
    },
    clearTextTotalOutputCost() {
        textTotalOutputCost = null;
    },
    getTextTotalOutputCost() {
        return textTotalOutputCost ? textTotalOutputCost.toFixed(10) : null;
    },
    addModel(model) {
        models.add(model);
    },
    getModels() {
        return Array.from(models);
    },
    clearModels() {
        models = new Set();
    },
    addModelType(modelType) {
        modelTypes.add(modelType);
    },
    getModelTypes() {
        return Array.from(modelTypes);
    },
    clearModelTypes() {
        modelTypes = new Set();
    },
    addToTextTotalCost(amount) {
        if (textTotalCost === null) {
            textTotalCost = new BigNumber(0);
        }
        textTotalCost = textTotalCost.plus(amount);
    },
    clearTextTotalCost() {
        textTotalCost = null;
    },
    getTextTotalCost() {
        return textTotalCost ? textTotalCost.toFixed(10) : null;
    },
}

module.exports = CurrentService
