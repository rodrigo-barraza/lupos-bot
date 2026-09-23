vi.mock("#root/services/PrismService.ts", () => ({
  default: { generateText: vi.fn() },
}));

const PrismService = (await import("#root/services/PrismService.ts")).default;
const {
  AMBIENT_LIMITS,
  AMBIENT_CLASSIFIER_SYSTEM_PROMPT,
  ambientBudgetBlocker,
  ambientClassifierCandidates,
  botSpokeRecently,
  buildClassifierTranscript,
  classifyInterjection,
  evaluateAmbientInterjection,
  hasAmbientSubstance,
  parseInterjectionVerdict,
  recentMessagesBefore,
  recordAmbientInterjection,
  resetAmbientState,
  resolveAmbientClassifierModel,
} = await import("../AmbientInterjection.ts");
const config = (await import("#root/config.ts")).default;

import type { Message } from "discord.js";

const BOT_ID = "900000000000000001";
const CHANNEL_ID = "500000000000000001";
const MINUTE = 60 * 1000;
const NOON = Date.UTC(2026, 8, 22, 12, 0, 0);

let nextId = 100_000_000_000_000_000n;

function chatMessage(
  content: string,
  {
    authorId = "800000000000000001",
    name = "alice",
    bot = false,
  }: { authorId?: string; name?: string; bot?: boolean } = {},
) {
  nextId += 1n;
  return {
    id: String(nextId),
    content,
    cleanContent: content,
    channelId: CHANNEL_ID,
    author: { id: authorId, username: name, bot },
    member: { displayName: name },
    attachments: new Map(),
    stickers: new Map(),
    webhookId: null,
    system: false,
  } as unknown as Message;
}

/** A candidate whose channel cache holds `history` (oldest first). */
function candidateAfter(history: Message[], content: string) {
  const candidate = chatMessage(content, { authorId: "800000000000000002", name: "bob" });
  const cache = new Map(history.map((historyMessage) => [historyMessage.id, historyMessage]));
  cache.set(candidate.id, candidate);
  const fetch = vi.fn(async () => new Map());
  (candidate as unknown as { channel: unknown }).channel = {
    messages: { cache, fetch },
  };
  return { candidate, fetch };
}

function chatter(count: number, { lastFromBot = false } = {}) {
  const history: Message[] = [];
  for (let i = 0; i < count; i++) {
    const fromBot = lastFromBot && i === count - 1;
    history.push(
      chatMessage(`message number ${i} about the raid tonight`, fromBot
        ? { authorId: BOT_ID, name: "Lupos", bot: true }
        : { authorId: `8000000000000000${10 + (i % 3)}`, name: `user${i % 3}` }),
    );
  }
  return history;
}

function classifierReplies(text: string) {
  vi.mocked(PrismService.generateText).mockResolvedValue({
    text,
    model: "m",
    provider: "p",
  } as never);
}

beforeEach(() => {
  resetAmbientState();
  vi.mocked(PrismService.generateText).mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ambient limits", () => {
  it("ship the brief's numbers", () => {
    expect(AMBIENT_LIMITS.cooldownMs).toBe(20 * MINUTE);
    expect(AMBIENT_LIMITS.dailyCapPerChannel).toBe(12);
    expect(AMBIENT_LIMITS.scoreThreshold).toBe(0.7);
  });
});

describe("hasAmbientSubstance", () => {
  it.each([
    "does anyone know when the raid starts",
    "honestly that boss fight was brutal lol",
  ])("has substance: %s", (text) => {
    expect(hasAmbientSubstance(text)).toBe(true);
  });

  it.each([
    "lol",
    "ok sure",
    "😂😂😂 😂😂 😂😂",
    "<:kek:123456789012345678> <:kek:123456789012345678> <@123456789012345678>",
    "https://tenor.com/view/some-long-gif-name-123",
    "!play never gonna give you up",
    "/roll 100 for the loot",
    "",
    null,
  ])("too thin: %s", (text) => {
    expect(hasAmbientSubstance(text)).toBe(false);
  });
});

describe("botSpokeRecently", () => {
  it("is true when he wrote one of the last 5 messages", () => {
    expect(botSpokeRecently(chatter(8, { lastFromBot: true }), BOT_ID)).toBe(true);
  });

  it("is false when his last message is further back", () => {
    const history = [...chatter(1, { lastFromBot: true }), ...chatter(5)];
    expect(botSpokeRecently(history, BOT_ID)).toBe(false);
  });
});

describe("recentMessagesBefore", () => {
  it("reads the channel cache (oldest first, candidate excluded) when it holds enough", async () => {
    const history = chatter(15);
    const { candidate, fetch } = candidateAfter(history, "what time is the raid again folks");
    const recent = await recentMessagesBefore(candidate, 12);
    expect(recent.map((recentMessage) => recentMessage.id)).toEqual(
      history.slice(-12).map((historyMessage) => historyMessage.id),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches when the cache is thin", async () => {
    const { candidate, fetch } = candidateAfter(chatter(2), "what time is the raid again folks");
    await recentMessagesBefore(candidate, 12);
    expect(fetch).toHaveBeenCalledWith({ limit: 12, before: candidate.id });
  });
});

describe("channel budget", () => {
  it("enforces a 20-minute cooldown between ambient turns", () => {
    recordAmbientInterjection(CHANNEL_ID, NOON);
    expect(ambientBudgetBlocker(CHANNEL_ID, NOON + 19 * MINUTE)).toBe("cooldown");
    expect(ambientBudgetBlocker(CHANNEL_ID, NOON + 20 * MINUTE)).toBeNull();
    expect(ambientBudgetBlocker("another-channel", NOON + MINUTE)).toBeNull();
  });

  it("caps a channel at 12 ambient turns per UTC day", () => {
    let now = NOON - 11 * 21 * MINUTE;
    for (let i = 0; i < 12; i++) {
      expect(ambientBudgetBlocker(CHANNEL_ID, now)).toBeNull();
      recordAmbientInterjection(CHANNEL_ID, now);
      now += 21 * MINUTE;
    }
    expect(ambientBudgetBlocker(CHANNEL_ID, now)).toBe("daily cap");
    expect(ambientBudgetBlocker(CHANNEL_ID, Date.UTC(2026, 8, 23, 0, 30))).toBeNull();
  });
});

describe("resolveAmbientClassifierModel", () => {
  const configured = {
    LANGUAGE_MODEL_TYPE: "GOOGLE",
    GOOGLE_LANGUAGE_MODEL_FAST: "gemini-3.6-flash",
    LANGUAGE_MODEL_OPENAI_LOW: "gpt-4.1-nano",
    FAST_LANGUAGE_MODEL_OPENAI: "gpt-4o",
    ANTHROPIC_LANGUAGE_MODEL_FAST: "claude-haiku-4-5-20251001",
    FAST_LANGUAGE_MODEL_LOCAL: "local-model",
    AMBIENT_CLASSIFIER_MODEL_TYPE: undefined,
    AMBIENT_CLASSIFIER_MODEL: undefined,
  };

  it("defaults to the cheapest configured model (OpenAI's low tier)", () => {
    expect(resolveAmbientClassifierModel(configured)).toEqual({
      type: "OPENAI",
      model: "gpt-4.1-nano",
    });
  });

  it("falls back to the main provider's fast model", () => {
    expect(
      resolveAmbientClassifierModel({ ...configured, LANGUAGE_MODEL_OPENAI_LOW: undefined }),
    ).toEqual({ type: "GOOGLE", model: "gemini-3.6-flash" });
  });

  it("honours explicit overrides", () => {
    expect(
      resolveAmbientClassifierModel({ ...configured, AMBIENT_CLASSIFIER_MODEL_TYPE: "ANTHROPIC" }),
    ).toEqual({ type: "ANTHROPIC", model: "claude-haiku-4-5-20251001" });
    expect(
      resolveAmbientClassifierModel({
        ...configured,
        AMBIENT_CLASSIFIER_MODEL_TYPE: "GOOGLE",
        AMBIENT_CLASSIFIER_MODEL: "gemini-3.5-flash-lite",
      }),
    ).toEqual({ type: "GOOGLE", model: "gemini-3.5-flash-lite" });
  });

  it("is null when nothing usable is configured", () => {
    expect(
      resolveAmbientClassifierModel({
        ...configured,
        LANGUAGE_MODEL_TYPE: undefined,
        LANGUAGE_MODEL_OPENAI_LOW: undefined,
      }),
    ).toBeNull();
  });
});

describe("ambientClassifierCandidates", () => {
  it("tries the cheapest model first, then the main provider's fast model", () => {
    expect(
      ambientClassifierCandidates({
        LANGUAGE_MODEL_TYPE: "GOOGLE",
        GOOGLE_LANGUAGE_MODEL_FAST: "gemini-3.6-flash",
        LANGUAGE_MODEL_OPENAI_LOW: "gpt-4.1-nano",
        FAST_LANGUAGE_MODEL_OPENAI: "gpt-4o",
        ANTHROPIC_LANGUAGE_MODEL_FAST: undefined,
        FAST_LANGUAGE_MODEL_LOCAL: undefined,
        AMBIENT_CLASSIFIER_MODEL_TYPE: undefined,
        AMBIENT_CLASSIFIER_MODEL: undefined,
      }),
    ).toEqual([
      { type: "OPENAI", model: "gpt-4.1-nano" },
      { type: "GOOGLE", model: "gemini-3.6-flash" },
    ]);
  });

  it("lists a model once when the cheapest is the main fast model", () => {
    expect(
      ambientClassifierCandidates({
        LANGUAGE_MODEL_TYPE: "GOOGLE",
        GOOGLE_LANGUAGE_MODEL_FAST: "gemini-3.6-flash",
        LANGUAGE_MODEL_OPENAI_LOW: undefined,
        FAST_LANGUAGE_MODEL_OPENAI: undefined,
        ANTHROPIC_LANGUAGE_MODEL_FAST: undefined,
        FAST_LANGUAGE_MODEL_LOCAL: undefined,
        AMBIENT_CLASSIFIER_MODEL_TYPE: undefined,
        AMBIENT_CLASSIFIER_MODEL: undefined,
      }),
    ).toEqual([{ type: "GOOGLE", model: "gemini-3.6-flash" }]);
  });
});

describe("classifyInterjection — model fallback", () => {
  const saved = {
    LANGUAGE_MODEL_TYPE: config.LANGUAGE_MODEL_TYPE,
    GOOGLE_LANGUAGE_MODEL_FAST: config.GOOGLE_LANGUAGE_MODEL_FAST,
    LANGUAGE_MODEL_OPENAI_LOW: config.LANGUAGE_MODEL_OPENAI_LOW,
  };

  beforeEach(() => {
    config.LANGUAGE_MODEL_TYPE = "GOOGLE";
    config.GOOGLE_LANGUAGE_MODEL_FAST = "gemini-3.6-flash";
    config.LANGUAGE_MODEL_OPENAI_LOW = "gpt-4.1-nano";
  });

  afterEach(() => {
    Object.assign(config, saved);
  });

  function input() {
    const { candidate } = candidateAfter(chatter(3), "who do you all think wins the finals tonight");
    return { candidate, recentMessages: chatter(3), botUserId: BOT_ID };
  }

  function modelsCalled() {
    return vi
      .mocked(PrismService.generateText)
      .mock.calls.map((call) => `${call[0].type}/${call[0].model}`);
  }

  it("falls back when the cheapest model's call fails, and skips it for an hour", async () => {
    vi.mocked(PrismService.generateText).mockImplementation(async (request) => {
      if (request.model === "gpt-4.1-nano") throw new Error("model retired");
      return { text: '{"interject": true, "score": 0.8}' } as never;
    });
    expect(await classifyInterjection({ ...input(), nowMs: NOON })).toEqual({
      interject: true,
      score: 0.8,
    });
    expect(modelsCalled()).toEqual(["OPENAI/gpt-4.1-nano", "GOOGLE/gemini-3.6-flash"]);

    await classifyInterjection({ ...input(), nowMs: NOON + 30 * MINUTE });
    expect(modelsCalled().slice(2)).toEqual(["GOOGLE/gemini-3.6-flash"]);

    await classifyInterjection({ ...input(), nowMs: NOON + 61 * MINUTE });
    expect(modelsCalled().slice(3)).toEqual(["OPENAI/gpt-4.1-nano", "GOOGLE/gemini-3.6-flash"]);
  });

  it("does not fall back on a junk answer — the model is up, the answer is silence", async () => {
    classifierReplies("maybe?");
    expect(await classifyInterjection({ ...input(), nowMs: NOON })).toBeNull();
    expect(modelsCalled()).toEqual(["OPENAI/gpt-4.1-nano"]);
  });

  it("is silent when every model fails", async () => {
    vi.mocked(PrismService.generateText).mockRejectedValue(new Error("Prism down"));
    expect(await classifyInterjection({ ...input(), nowMs: NOON })).toBeNull();
    expect(modelsCalled()).toHaveLength(2);
  });
});

describe("parseInterjectionVerdict", () => {
  it("reads strict JSON (and tolerates a code fence)", () => {
    expect(parseInterjectionVerdict('{"interject": true, "score": 0.82}')).toEqual({
      interject: true,
      score: 0.82,
    });
    expect(parseInterjectionVerdict('```json\n{"interject":false,"score":0.1}\n```')).toEqual({
      interject: false,
      score: 0.1,
    });
  });

  it.each([
    "yes",
    '{"interject": "true", "score": 0.9}',
    '{"interject": true}',
    '{"interject": true, "score": 1.5}',
    '{"interject": true, "score": -0.1}',
    '[{"interject": true, "score": 0.9}]',
    "",
    null,
  ])("rejects %s", (text) => {
    expect(parseInterjectionVerdict(text)).toBeNull();
  });
});

describe("buildClassifierTranscript", () => {
  it("labels Lupos and marks the candidate last", () => {
    const history = [
      chatMessage("anyone up for the raid", { name: "alice" }),
      chatMessage("i am, ready in 5", { authorId: BOT_ID, name: "Lupos", bot: true }),
    ];
    const candidate = chatMessage("what does everyone think of the new patch", { name: "bob" });
    const transcript = buildClassifierTranscript(history, candidate, BOT_ID);
    expect(transcript).toContain("[alice]: anyone up for the raid");
    expect(transcript).toContain("[Lupos (him)]: i am, ready in 5");
    expect(transcript.trim().endsWith(">>> [bob]: what does everyone think of the new patch")).toBe(true);
  });
});

describe("evaluateAmbientInterjection", () => {
  beforeEach(() => {
    config.LANGUAGE_MODEL_OPENAI_LOW = "gpt-4.1-nano";
  });

  it("interjects on a confident yes, via a JSON-mode, thinking-off classifier call", async () => {
    classifierReplies('{"interject": true, "score": 0.9}');
    const { candidate } = candidateAfter(chatter(12), "who do you all think wins the finals tonight");
    expect(await evaluateAmbientInterjection(candidate, BOT_ID, NOON)).toEqual({
      interject: true,
      score: 0.9,
    });
    const request = vi.mocked(PrismService.generateText).mock.calls[0][0];
    expect(request).toMatchObject({
      type: "OPENAI",
      model: "gpt-4.1-nano",
      systemPrompt: AMBIENT_CLASSIFIER_SYSTEM_PROMPT,
      flatOptions: { thinkingEnabled: false, responseFormat: "json_object" },
    });
    expect(request.messages[0].content).toContain(
      ">>> [bob]: who do you all think wins the finals tonight",
    );
  });

  it("stays silent below the 0.7 threshold or on a no", async () => {
    const { candidate } = candidateAfter(chatter(12), "who do you all think wins the finals tonight");
    classifierReplies('{"interject": true, "score": 0.69}');
    expect((await evaluateAmbientInterjection(candidate, BOT_ID, NOON)).interject).toBe(false);
    classifierReplies('{"interject": false, "score": 0.95}');
    expect(
      (await evaluateAmbientInterjection(candidate, BOT_ID, NOON + 2 * MINUTE)).interject,
    ).toBe(false);
  });

  it("stays silent on any classifier error or junk", async () => {
    const { candidate } = candidateAfter(chatter(12), "who do you all think wins the finals tonight");
    vi.mocked(PrismService.generateText).mockRejectedValue(new Error("Prism timeout"));
    expect(await evaluateAmbientInterjection(candidate, BOT_ID, NOON)).toEqual({
      interject: false,
      reason: "classifier failed",
    });
    classifierReplies("sure, why not!");
    expect(
      (await evaluateAmbientInterjection(candidate, BOT_ID, NOON + 2 * MINUTE)).interject,
    ).toBe(false);
  });

  it("never calls the classifier for thin messages, bots, or right after he spoke", async () => {
    classifierReplies('{"interject": true, "score": 0.99}');
    const { candidate: thin } = candidateAfter(chatter(12), "lol ok");
    expect(await evaluateAmbientInterjection(thin, BOT_ID, NOON)).toMatchObject({
      reason: "too little substance",
    });
    const bot = chatMessage("beep boop the scheduled reminder fired", { bot: true });
    expect(await evaluateAmbientInterjection(bot, BOT_ID, NOON)).toMatchObject({
      reason: "not a human message",
    });
    const { candidate: afterHim } = candidateAfter(
      chatter(12, { lastFromBot: true }),
      "who do you all think wins the finals tonight",
    );
    expect(await evaluateAmbientInterjection(afterHim, BOT_ID, NOON)).toMatchObject({
      reason: "spoke recently",
    });
    expect(PrismService.generateText).not.toHaveBeenCalled();
  });

  it("never calls the classifier inside the cooldown or past the daily cap", async () => {
    classifierReplies('{"interject": true, "score": 0.99}');
    recordAmbientInterjection(CHANNEL_ID, NOON);
    const { candidate } = candidateAfter(chatter(12), "who do you all think wins the finals tonight");
    expect(await evaluateAmbientInterjection(candidate, BOT_ID, NOON + 5 * MINUTE)).toMatchObject({
      reason: "cooldown",
    });
    expect(PrismService.generateText).not.toHaveBeenCalled();
  });

  it("calls the classifier at most once a minute per channel", async () => {
    classifierReplies('{"interject": false, "score": 0.2}');
    const { candidate } = candidateAfter(chatter(12), "who do you all think wins the finals tonight");
    await evaluateAmbientInterjection(candidate, BOT_ID, NOON);
    expect(await evaluateAmbientInterjection(candidate, BOT_ID, NOON + 30 * 1000)).toMatchObject({
      reason: "classifier interval",
    });
    await evaluateAmbientInterjection(candidate, BOT_ID, NOON + MINUTE);
    expect(PrismService.generateText).toHaveBeenCalledTimes(2);
  });

  it("lets only one of two simultaneous messages reach the classifier", async () => {
    let release: (value: unknown) => void = () => {};
    vi.mocked(PrismService.generateText).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );
    const { candidate: first } = candidateAfter(chatter(12), "who do you all think wins the finals tonight");
    const { candidate: second } = candidateAfter(chatter(12), "and who is the mvp of the whole season");
    const firstVerdict = evaluateAmbientInterjection(first, BOT_ID, NOON);
    const secondVerdict = await evaluateAmbientInterjection(second, BOT_ID, NOON);
    expect(secondVerdict.interject).toBe(false);
    release({ text: '{"interject": true, "score": 0.8}' });
    expect((await firstVerdict).interject).toBe(true);
    expect(PrismService.generateText).toHaveBeenCalledOnce();
  });
});
