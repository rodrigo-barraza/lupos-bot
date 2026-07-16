// AgentStatusTracker — turns the live /agent SSE event stream into Discord
// presence statuses ("🤔 Thinking… (8s)", "✂️ Clipping a video…", …) so the
// community can watch Lupos work instead of a static "Replying to X...".
//
// Presence pushes ride the gateway's rate-limited presence-update command,
// so updates are throttled to one per THROTTLE_MS with latest-state-wins: a
// background tick re-renders the current phase (with a live elapsed
// counter) and completed-phase announcements ("💭 Thought for 8 seconds")
// stick until the next event supersedes them.

import type { PrismSseEvent } from "#root/types/prism.js";

const THROTTLE_MS = 4000;
/** Discord custom statuses cap at 128 characters. */
const STATUS_MAX_CHARS = 128;
/** How long the final recap/error status stays before the idle status
 * (current mood) takes over. */
const IDLE_STATUS_DELAY_MS = 10_000;

const DISCOVERY_TOOLS = new Set([
  "discover_and_enable_tools",
  "search_tools",
  "enable_tools",
]);

/** Friendly labels for flagship tools; anything else gets the generic 🔧. */
const TOOL_STATUS_LABELS: Record<string, string> = {
  generate_image: "🎨 Drawing something…",
  generate_audio: "🎵 Cooking up a track…",
  remix_audio: "🎛️ Remixing audio…",
  synthesize_speech: "🎙️ Recording a voice line…",
  synthesize_speech_local: "🎙️ Recording a voice line…",
  trim_video: "✂️ Clipping a video…",
  download_video: "📥 Grabbing a video…",
  convert_video_to_gif: "🎞️ Making a GIF…",
  get_emoji_combination: "🧪 Mixing emojis…",
  search_web: "🔎 Searching the web…",
  search_news: "🗞️ Scanning the news…",
  search_images: "🔎 Hunting for images…",
  search_videos: "🔎 Hunting for videos…",
  read_url: "📖 Reading a page…",
  read_web_page: "📖 Reading a page…",
  search_discord_messages: "📜 Digging through old messages…",
  search_reddit: "👽 Trawling Reddit…",
  search_youtube: "📺 Scouring YouTube…",
  get_weather: "🌦️ Checking the sky…",
  think: "🤔 Thinking…",
};

type Phase =
  | { kind: "reading"; startedAt: number }
  | { kind: "thinking"; startedAt: number }
  | { kind: "tool"; startedAt: number; toolName: string }
  | { kind: "writing"; startedAt: number };

export class AgentStatusTracker {
  /**
   * Monotonic id of the most recently constructed tracker. A finished
   * tracker's delayed idle-status push only fires while it is still the
   * newest one — a new reply takes presence ownership and cancels it.
   */
  private static currentEpoch = 0;

  private readonly epoch: number;
  private readonly pushStatus: (status: string) => void;
  private readonly fetchIdleStatus?: () => Promise<string | null>;
  private readonly username: string;
  private readonly startedAt: number;

  private phase: Phase;
  private lastPushedAt = 0;
  private lastPushedText = "";
  private tickTimer: NodeJS.Timeout | null = null;
  /**
   * Completed-phase one-shot ("💭 Thought for 8 seconds", "✅ … took 3.2s").
   * Held until the throttle window opens (usually the next tick), shown
   * once, then live phase rendering resumes. Latest announcement wins.
   */
  private pendingAnnouncement: string | null = null;

  /** Total whole seconds spent in thinking phases (may span rounds). */
  private thinkingSeconds = 0;
  private toolCallCount = 0;
  private finished = false;

  constructor({
    pushStatus,
    username,
    fetchIdleStatus,
  }: {
    /** Sink for status lines — wire to DiscordUtilityService.setUserActivity. */
    pushStatus: (status: string) => void;
    username: string;
    /**
     * Resolves the idle status (Lupos's current mood) shown
     * IDLE_STATUS_DELAY_MS after the final recap/error status. Return
     * null to keep the final status.
     */
    fetchIdleStatus?: () => Promise<string | null>;
  }) {
    this.epoch = ++AgentStatusTracker.currentEpoch;
    this.pushStatus = pushStatus;
    this.fetchIdleStatus = fetchIdleStatus;
    this.username = username;
    this.startedAt = Date.now();
    this.phase = { kind: "reading", startedAt: this.startedAt };
    this.push(this.render(), true);
    // Every throttle window: flush a held announcement if one is waiting,
    // otherwise re-render the current phase so long phases get a live
    // elapsed counter.
    this.tickTimer = setInterval(() => this.tick(), THROTTLE_MS);
    this.tickTimer.unref?.();
  }

  private tick(): void {
    if (this.pendingAnnouncement) {
      const announcement = this.pendingAnnouncement;
      this.pendingAnnouncement = null;
      this.push(announcement);
      return;
    }
    this.push(this.render());
  }

  /** Queue a completed-phase one-shot; shows immediately if the window is open. */
  private announce(text: string): void {
    const now = Date.now();
    if (now - this.lastPushedAt >= THROTTLE_MS) {
      this.push(text);
      return;
    }
    this.pendingAnnouncement = text;
  }

  /** Feed one SSE event from the /agent stream. */
  handleEvent(event: PrismSseEvent): void {
    if (this.finished) return;
    switch (event.type) {
      case "thinking":
        if (this.phase.kind !== "thinking") {
          this.setPhase({ kind: "thinking", startedAt: Date.now() });
        }
        break;
      case "tool_execution":
        this.handleToolExecution(event);
        break;
      case "chunk":
        this.closeThinkingRound();
        if (this.phase.kind !== "writing") {
          this.setPhase({ kind: "writing", startedAt: Date.now() });
        }
        break;
      default:
        // status/usage/todo/etc. — no presence change.
        break;
    }
  }

  /** Reply sent: push the persistent recap and stop ticking. */
  finishSuccess(): void {
    this.finish(this.buildRecap());
  }

  /** Agent call failed or produced nothing. */
  finishError(): void {
    this.finish("😵 That one broke my brain…");
  }

  /** Reply abandoned (e.g. trigger message deleted) — back to idle. */
  finishCancelled(): void {
    this.finish("Don't @ me...");
  }

  private handleToolExecution(event: PrismSseEvent): void {
    const toolName = event.tool?.name || "a tool";
    if (event.status === "calling") {
      this.closeThinkingRound();
      this.toolCallCount += 1;
      this.setPhase({ kind: "tool", startedAt: Date.now(), toolName });
      return;
    }

    if (event.status !== "done" && event.status !== "error") return;
    const seconds = event.tool?.durationMilliseconds
      ? Math.round(event.tool.durationMilliseconds / 100) / 10
      : null;

    if (event.status === "error") {
      this.announce(`⚠️ ${toolName} failed, improvising…`);
      return;
    }
    if (DISCOVERY_TOOLS.has(toolName)) {
      const result = event.tool?.result as
        | { auto_enabled?: string[] }
        | null
        | undefined;
      const discovered = result?.auto_enabled?.slice(0, 3).join(", ");
      this.announce(
        discovered
          ? `🧰 Discovered "${discovered}"${seconds ? ` in ${seconds}s` : ""}`
          : `🧰 Rummaged through the toolbox${seconds ? ` for ${seconds}s` : ""}`,
      );
      return;
    }
    this.announce(`✅ ${toolName} took ${seconds ?? "?"}s`);
  }

  /** Fold a finished thinking round into the running total. */
  private closeThinkingRound(): void {
    if (this.phase.kind !== "thinking") return;
    const seconds = Math.round((Date.now() - this.phase.startedAt) / 1000);
    this.thinkingSeconds += seconds;
    if (seconds >= 1) {
      this.announce(
        `💭 Thought for ${seconds} second${seconds === 1 ? "" : "s"}`,
      );
    }
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.push(this.render());
  }

  private render(): string {
    switch (this.phase.kind) {
      case "reading":
        return `👀 Reading ${this.username}'s message…`;
      case "thinking":
        return `🤔 Thinking… (${this.elapsedSeconds(this.phase.startedAt)}s)`;
      case "tool": {
        const label =
          TOOL_STATUS_LABELS[this.phase.toolName] ||
          (DISCOVERY_TOOLS.has(this.phase.toolName)
            ? "🧰 Discovering tools…"
            : `🔧 Using ${this.phase.toolName}…`);
        const elapsed = this.elapsedSeconds(this.phase.startedAt);
        return elapsed >= 5 ? `${label} (${elapsed}s)` : label;
      }
      case "writing":
        return "✍️ Writing a reply…";
    }
  }

  private buildRecap(): string {
    this.closeThinkingRound();
    const totalSeconds = Math.round((Date.now() - this.startedAt) / 1000);
    const segments: string[] = [];
    if (this.thinkingSeconds >= 1) {
      segments.push(`thought ${this.thinkingSeconds}s`);
    }
    if (this.toolCallCount > 0) {
      segments.push(
        `${this.toolCallCount} tool${this.toolCallCount === 1 ? "" : "s"}`,
      );
    }
    segments.push(`${totalSeconds}s total`);
    return `💬 Replied to ${this.username} — ${segments.join(", ")}`;
  }

  private finish(status: string): void {
    if (this.finished) return;
    this.finished = true;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.push(status, true);
    this.scheduleIdleStatus();
  }

  /** After the final status has had its moment, hand presence to the mood. */
  private scheduleIdleStatus(): void {
    if (!this.fetchIdleStatus) return;
    const timer = setTimeout(async () => {
      // A newer reply owns presence now — stand down.
      if (AgentStatusTracker.currentEpoch !== this.epoch) return;
      let idleStatus: string | null;
      try {
        idleStatus = await this.fetchIdleStatus!();
      } catch {
        return; // prism down — keep the recap.
      }
      if (!idleStatus) return;
      if (AgentStatusTracker.currentEpoch !== this.epoch) return;
      this.push(idleStatus, true);
    }, IDLE_STATUS_DELAY_MS);
    timer.unref?.();
  }

  private elapsedSeconds(since: number): number {
    return Math.round((Date.now() - since) / 1000);
  }

  private push(status: string, force = false): void {
    const now = Date.now();
    const truncated =
      status.length > STATUS_MAX_CHARS
        ? `${status.slice(0, STATUS_MAX_CHARS - 1)}…`
        : status;
    if (!force) {
      if (now - this.lastPushedAt < THROTTLE_MS) return;
      if (truncated === this.lastPushedText) return;
    }
    this.lastPushedAt = now;
    this.lastPushedText = truncated;
    try {
      this.pushStatus(truncated);
    } catch {
      // Presence is cosmetic — never let it break the reply flow.
    }
  }
}
