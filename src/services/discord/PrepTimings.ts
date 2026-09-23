// ============================================================
// PrepTimings — where a turn's time goes before the model is called
// ============================================================
// One per accepted trigger, created when it passes the gates and carried
// through the queue, the history extraction and the prompt build. Right
// before the /agent call it prints ONE structured line:
//
//   ⏱️ [prep] <messageId> fetch=1290 queue=0 links=410 media=620
//      envelopes=12 extract=640 dossier=3 refs=0 avatars=0 emoji=0
//      prompt=9 total=1950 sinceTrigger=2011
//
// Stages are milliseconds in the order they finished; nested stages
// (links/media/envelopes inside extract, dossier/refs/avatars/emoji
// inside prompt) overlap their parent. `total` runs from acceptance to
// the /agent call; `sinceTrigger` from the message's Discord timestamp
// (so it includes gateway delivery and the gates before acceptance).
// ============================================================

export default class PrepTimings {
  private readonly startedAt = performance.now();
  private readonly stages: [string, number][] = [];
  private enqueuedAt: number | null = null;
  private readonly triggerCreatedAtMs: number | undefined;

  constructor(triggerCreatedAtMs?: number) {
    this.triggerCreatedAtMs = triggerCreatedAtMs;
  }

  /** Record a finished stage's duration. */
  record(stage: string, milliseconds: number): void {
    this.stages.push([stage, Math.round(milliseconds)]);
  }

  /** Run `work` and record how long it took (also when it throws). */
  async time<T>(stage: string, work: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await work();
    } finally {
      this.record(stage, performance.now() - start);
    }
  }

  /** The turn just joined the reply queue. */
  markEnqueued(): void {
    this.enqueuedAt = performance.now();
  }

  /** The queue reached the turn: record how long it waited. */
  recordQueueWait(): void {
    if (this.enqueuedAt === null) return;
    this.record("queue", performance.now() - this.enqueuedAt);
    this.enqueuedAt = null;
  }

  /** The structured log line (see header). */
  line(messageId: string): string {
    const stages = this.stages.map(([stage, ms]) => `${stage}=${ms}`);
    stages.push(`total=${Math.round(performance.now() - this.startedAt)}`);
    if (this.triggerCreatedAtMs) {
      stages.push(`sinceTrigger=${Date.now() - this.triggerCreatedAtMs}`);
    }
    return `⏱️ [prep] ${messageId} ${stages.join(" ")}`;
  }
}
