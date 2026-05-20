let user: unknown = null;
let message: unknown = null;
let startTime: unknown = null;
let endTime: unknown = null;
let traceId: string | null = null;

let models = new Set<unknown>();
let modelTypes = new Set<unknown>();

const CurrentService = {
  setUser(newUser: unknown): void {
    user = newUser;
  },
  getUser(): unknown {
    return user;
  },
  setMessage(newMessage: unknown): void {
    message = newMessage;
  },
  getMessage(): unknown {
    return message;
  },
  setStartTime(newStartTime: unknown): void {
    startTime = newStartTime;
  },
  getStartTime(): unknown {
    return startTime;
  },
  setEndTime(newEndTime: unknown): void {
    endTime = newEndTime;
  },
  getEndTime(): unknown {
    return endTime;
  },
  addModel(model: unknown): void {
    models.add(model);
  },
  getModels(): unknown[] {
    return Array.from(models);
  },
  clearModels(): void {
    models = new Set<unknown>();
  },
  addModelType(modelType: unknown): void {
    modelTypes.add(modelType);
  },
  getModelTypes(): unknown[] {
    return Array.from(modelTypes);
  },
  clearModelTypes(): void {
    modelTypes = new Set<unknown>();
  },
  setTraceId(newTraceId: string | null): void {
    traceId = newTraceId;
  },
  getTraceId(): string | null {
    return traceId;
  },
  clearTraceId(): void {
    traceId = null;
  },
};

export default CurrentService;
