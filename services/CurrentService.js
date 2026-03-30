let user = null;
let message = null;
let startTime = null;
let endTime = null;

let models = new Set();
let modelTypes = new Set();
let steps = [];
let conversationIds = new Set();
let sessionId = null;

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
  /**
   * Track a conversation ID generated during an AI call.
   * @param {string} id
   */
  addConversationId(id) {
    if (id) conversationIds.add(id);
  },
  getConversationIds() {
    return Array.from(conversationIds);
  },
  clearConversationIds() {
    conversationIds = new Set();
  },
  /**
   * Add an ordered workflow step.
   * @param {{ model: string, type: string, label: string, duration: number, inputType: string, outputType: string }} step
   */
  addStep(step) {
    steps.push({
      ...step,
      index: steps.length,
      timestamp: new Date().toISOString(),
    });
  },
  getSteps() {
    return [...steps];
  },
  clearSteps() {
    steps = [];
  },
  /**
   * Set the session ID for the current processing run.
   * @param {string} id
   */
  setSessionId(id) {
    sessionId = id;
  },
  getSessionId() {
    return sessionId;
  },
  clearSessionId() {
    sessionId = null;
  },
};

export default CurrentService;
