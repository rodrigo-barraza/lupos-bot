let user: any = null;
let message: any = null;
let startTime: any = null;
let endTime: any = null;
let traceId: any = null;

let models = new Set();
let modelTypes = new Set();


const CurrentService = {
  setUser(newUser: any) {
    user = newUser;
  },
  getUser() {
    return user;
  },
  setMessage(newMessage: any) {
    message = newMessage;
  },
  getMessage() {
    return message;
  },
  setStartTime(newStartTime: any) {
    startTime = newStartTime;
  },
  getStartTime() {
    return startTime;
  },
  setEndTime(newEndTime: any) {
    endTime = newEndTime;
  },
  getEndTime() {
    return endTime;
  },
  addModel(model: any) {
    models.add(model);
  },
  getModels() {
    return Array.from(models);
  },
  clearModels() {
    models = new Set();
  },
  addModelType(modelType: any) {
    modelTypes.add(modelType);
  },
  getModelTypes() {
    return Array.from(modelTypes);
  },
  clearModelTypes() {
    modelTypes = new Set();
  },
  setTraceId(newTraceId: any) {
    traceId = newTraceId;
  },
  getTraceId() {
    return traceId;
  },
  clearTraceId() {
    traceId = null;
  },

};

export default CurrentService;
