import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatusTracker } from "../AgentStatusTracker.js";

describe("AgentStatusTracker", () => {
  let pushed: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    pushed = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeTracker(username = "rodrigo") {
    return new AgentStatusTracker({
      pushStatus: (status) => pushed.push(status),
      username,
    });
  }

  it("starts with a reading status", () => {
    makeTracker();
    expect(pushed).toEqual(["👀 Reading rodrigo's message…"]);
  });

  it("shows a steady thinking status with no ticking counter", () => {
    const tracker = makeTracker();
    tracker.handleEvent({ type: "thinking", content: "hmm" });
    vi.advanceTimersByTime(8100);
    expect(pushed).toContain("🤔 Thinking…");
    // The identical re-render dedupes — no counter churn on ticks.
    expect(pushed.filter((s) => s.startsWith("🤔")).length).toBe(1);
    expect(pushed.some((s) => s.includes("s)"))).toBe(false);
  });

  it("announces thought duration when thinking ends, then shows the tool", () => {
    const tracker = makeTracker();
    tracker.handleEvent({ type: "thinking" });
    vi.advanceTimersByTime(8000);
    tracker.handleEvent({
      type: "tool_execution",
      status: "calling",
      tool: { name: "get_weather" },
    });
    // The steady thinking status left the throttle window open, so the
    // announcement pushes immediately; the tool renders on the next tick.
    expect(pushed[pushed.length - 1]).toBe("💭 Thought for 8 seconds");
    vi.advanceTimersByTime(4000);
    expect(pushed[pushed.length - 1]).toBe("🌦️ Checking the sky…");
  });

  it("prefers prism's toolLabel for unmapped tools", () => {
    const tracker = makeTracker();
    tracker.handleEvent({
      type: "tool_execution",
      status: "calling",
      tool: { name: "search_spotify" },
      toolLabel: 'Searching Spotify for "phonk"',
    });
    vi.advanceTimersByTime(4000);
    expect(pushed).toContain('🔧 Searching Spotify for "phonk"…');
  });

  it("falls back to a humanized name for unmapped tools without a label", () => {
    const tracker = makeTracker();
    tracker.handleEvent({
      type: "tool_execution",
      status: "calling",
      tool: { name: "get_moon_phase" },
    });
    vi.advanceTimersByTime(4000);
    expect(pushed).toContain("🔧 Using Moon Phase…");
  });

  it("announces tool completion with the completed-tense label", () => {
    const tracker = makeTracker();
    tracker.handleEvent({
      type: "tool_execution",
      status: "calling",
      tool: { name: "search_spotify" },
      toolLabel: 'Searching Spotify for "phonk"',
    });
    vi.advanceTimersByTime(4100);
    tracker.handleEvent({
      type: "tool_execution",
      status: "done",
      tool: { name: "search_spotify", durationMilliseconds: 3200 },
      toolLabel: 'Searched Spotify for "phonk"',
    });
    vi.advanceTimersByTime(4000);
    expect(pushed).toContain('✅ Searched Spotify for "phonk" (3.2s)');
  });

  it("announces discovered tools with names from auto_enabled", () => {
    const tracker = makeTracker();
    tracker.handleEvent({
      type: "tool_execution",
      status: "calling",
      tool: { name: "discover_and_enable_tools" },
    });
    vi.advanceTimersByTime(4100);
    tracker.handleEvent({
      type: "tool_execution",
      status: "done",
      tool: {
        name: "discover_and_enable_tools",
        durationMilliseconds: 2100,
        result: { auto_enabled: ["trim_video", "get_weather"] },
      },
    });
    vi.advanceTimersByTime(4000);
    expect(pushed).toContain('🧰 Discovered "trim_video, get_weather" in 2.1s');
  });

  it("announces tool failures", () => {
    const tracker = makeTracker();
    tracker.handleEvent({
      type: "tool_execution",
      status: "calling",
      tool: { name: "search_web" },
    });
    vi.advanceTimersByTime(4100);
    tracker.handleEvent({
      type: "tool_execution",
      status: "error",
      tool: { name: "search_web" },
    });
    vi.advanceTimersByTime(4000);
    expect(pushed).toContain("⚠️ Web failed, improvising…");
  });

  it("switches to writing when reply chunks stream", () => {
    const tracker = makeTracker();
    vi.advanceTimersByTime(4100);
    tracker.handleEvent({ type: "chunk", content: "Hey" });
    expect(pushed).toContain("✍️ Writing a reply…");
  });

  it("builds a recap with thinking, tool count, and total duration", () => {
    const tracker = makeTracker();
    tracker.handleEvent({ type: "thinking" });
    vi.advanceTimersByTime(8000);
    tracker.handleEvent({
      type: "tool_execution",
      status: "calling",
      tool: { name: "get_weather" },
    });
    vi.advanceTimersByTime(3000);
    tracker.handleEvent({
      type: "tool_execution",
      status: "calling",
      tool: { name: "search_web" },
    });
    vi.advanceTimersByTime(10000);
    tracker.finishSuccess();
    expect(pushed[pushed.length - 1]).toBe(
      "💬 Replied to rodrigo — thought 8s, 2 tools, 21s total",
    );
  });

  it("omits recap segments that did not happen", () => {
    const tracker = makeTracker();
    vi.advanceTimersByTime(5000);
    tracker.finishSuccess();
    expect(pushed[pushed.length - 1]).toBe(
      "💬 Replied to rodrigo — 5s total",
    );
  });

  it("pushes an error status and stops ticking on finishError", () => {
    const tracker = makeTracker();
    tracker.finishError();
    expect(pushed[pushed.length - 1]).toBe("😵 That one broke my brain…");
    const count = pushed.length;
    tracker.handleEvent({ type: "thinking" });
    vi.advanceTimersByTime(20000);
    expect(pushed.length).toBe(count);
  });

  it("returns to idle on finishCancelled", () => {
    const tracker = makeTracker();
    tracker.finishCancelled();
    expect(pushed[pushed.length - 1]).toBe("Don't @ me...");
  });

  it("throttles rapid phase changes to one push per window", () => {
    const tracker = makeTracker();
    for (let i = 0; i < 10; i++) {
      tracker.handleEvent({
        type: "tool_execution",
        status: "calling",
        tool: { name: `tool_${i}` },
      });
    }
    // Initial reading push only — everything else was inside the window.
    expect(pushed.length).toBe(1);
    vi.advanceTimersByTime(4000);
    expect(pushed.length).toBe(2);
    expect(pushed[1]).toBe("🔧 Using Tool 9…");
  });

  it("never lets a throwing push sink break event handling", () => {
    const tracker = new AgentStatusTracker({
      pushStatus: () => {
        throw new Error("gateway hiccup");
      },
      username: "rodrigo",
    });
    expect(() => tracker.handleEvent({ type: "chunk" })).not.toThrow();
    expect(() => tracker.finishSuccess()).not.toThrow();
  });

  it("truncates statuses to Discord's 128-char cap", () => {
    makeTracker("x".repeat(200));
    expect(pushed[0].length).toBeLessThanOrEqual(128);
  });

  describe("idle mood hand-off", () => {
    function makeMoodTracker(
      fetchIdleStatus: () => Promise<string | null>,
      username = "rodrigo",
    ) {
      return new AgentStatusTracker({
        pushStatus: (status) => pushed.push(status),
        username,
        fetchIdleStatus,
      });
    }

    it("replaces the recap with the mood status after the idle delay", async () => {
      const tracker = makeMoodTracker(async () => "😤 Feeling very angry");
      vi.advanceTimersByTime(5000);
      tracker.finishSuccess();
      expect(pushed[pushed.length - 1]).toBe(
        "💬 Replied to rodrigo — 5s total",
      );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(pushed[pushed.length - 1]).toBe("😤 Feeling very angry");
    });

    it("also hands off after an error status", async () => {
      const tracker = makeMoodTracker(async () => "🥱 Feeling a bit tired");
      tracker.finishError();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(pushed[pushed.length - 1]).toBe("🥱 Feeling a bit tired");
    });

    it("keeps the recap when the mood fetch fails or returns null", async () => {
      const failing = makeMoodTracker(async () => {
        throw new Error("prism down");
      });
      failing.finishSuccess();
      const afterRecap = pushed[pushed.length - 1];
      await vi.advanceTimersByTimeAsync(10_000);
      expect(pushed[pushed.length - 1]).toBe(afterRecap);

      const empty = makeMoodTracker(async () => null);
      empty.finishSuccess();
      const recap = pushed[pushed.length - 1];
      await vi.advanceTimersByTimeAsync(10_000);
      expect(pushed[pushed.length - 1]).toBe(recap);
    });

    it("stands down when a newer tracker owns presence", async () => {
      const older = makeMoodTracker(async () => "😤 Feeling very angry");
      older.finishSuccess();
      // A new reply starts before the idle delay elapses.
      makeMoodTracker(async () => "🙂 Feeling joyful", "someone-else");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(pushed).not.toContain("😤 Feeling very angry");
      expect(pushed[pushed.length - 1]).toBe(
        "👀 Reading someone-else's message…",
      );
    });
  });
});
