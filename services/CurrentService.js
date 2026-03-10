let user = null;
let message = null;
let startTime = null;
let endTime = null;

let models = new Set();
let modelTypes = new Set();

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
}

export default CurrentService;