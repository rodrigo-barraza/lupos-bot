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

  it("shows thinking with a live elapsed counter on ticks", () => {
    const tracker = makeTracker();
    tracker.handleEvent({ type: "thinking", content: "hmm" });
    vi.advanceTimersByTime(8100);
    expect(pushed.some((s) => s.startsWith("🤔 Thinking… ("))).toBe(true);
    const last = pushed[pushed.length - 1];
    expect(last).toMatch(/🤔 Thinking… \(\d+s\)/);
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
    // Announcement is held for the next open window (tick), then live
    // phase rendering resumes on the tick after.
    vi.advanceTimersByTime(4000);
    expect(pushed[pushed.length - 1]).toBe("💭 Thought for 8 seconds");
    vi.advanceTimersByTime(4000);
    expect(pushed[pushed.length - 1]).toBe("🌦️ Checking the sky… (8s)");
  });

  it("uses the generic label for unmapped tools", () => {
    const tracker = makeTracker();
    tracker.handleEvent({
      type: "tool_execution",
      status: "calling",
      tool: { name: "get_moon_phase" },
    });
    vi.advanceTimersByTime(4000);
    expect(pushed).toContain("🔧 Using get_moon_phase…");
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
    expect(pushed).toContain("⚠️ search_web failed, improvising…");
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
    expect(pushed[1]).toBe("🔧 Using tool_9…");
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
    const tracker = makeTracker("x".repeat(200));
    expect(pushed[0].length).toBeLessThanOrEqual(128);
  });
});
