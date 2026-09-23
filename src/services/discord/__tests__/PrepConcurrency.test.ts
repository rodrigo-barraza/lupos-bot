// The work before the first model call, made concurrent without changing
// what the model receives:
//   - the extraction starts every message's link probes at once (they
//     used to run one message after another) and each message's captions
//     as soon as its own links are resolved; sticker captions start in
//     the first pass; replies to messages already in the fetched history
//     are never re-fetched over REST;
//   - buildAndGenerateReply takes the replied-to message from the fetched
//     history, starts the trigger's emoji captions up front, keeps the
//     reference-image order, and logs one ⏱️ [prep] line before /agent;
//   - the prefetchers start exactly the SMALL captions it will ask for.

vi.mock("#root/services/AIService.ts", () => ({
  default: {
    captionImages: vi.fn(),
    transcribeAudioUrls: vi.fn(async () => ({ transcriptionsMap: new Map() })),
    generateTextDetermineHowManyMessagesToFetch: vi.fn(async () => 50),
    _getTraceParams: () => ({ traceId: "trace-1" }),
  },
}));
vi.mock("#root/services/DiscordUtilityService.ts", () => ({
  default: {
    extractImageUrlsFromMessage: vi.fn(),
    extractAudioUrlsFromMessage: vi.fn(async () => []),
    getUsernameNoSpaces: () => "someone",
    retrieveMessageReferenceFromMessage: vi.fn(async () => null),
    retrieveMemberFromGuildById: vi.fn(async () => null),
    getDisplayName: vi.fn(async () => "Someone"),
  },
}));
vi.mock("#root/services/PrismService.ts", () => ({
  default: { generateAgentResponse: vi.fn() },
  conversationIdOf: () => null,
}));
vi.mock("#root/services/CensorService.ts", () => ({
  default: { removeFlaggedWords: (text: string) => text },
}));
vi.mock("#root/formatters/LogFormatter.ts", () => ({
  default: new Proxy({}, { get: () => () => [] }),
}));

const { Collection } = await import("discord.js");
const AIService = (await import("#root/services/AIService.ts")).default;
const DiscordUtilityService = (await import("#root/services/DiscordUtilityService.ts")).default;
const PrismService = (await import("#root/services/PrismService.ts")).default;
const ChannelSessionCache = (await import("../ChannelSessionCache.ts")).default;
const PrepTimings = (await import("../PrepTimings.ts")).default;
const { extractContentFromMessages } = await import("../ConversationExtractor.ts");
const {
  buildAndGenerateReply,
  prefetchRepliedImageCaption,
  prefetchTriggerReferenceCaptions,
} = await import("../PromptBuilder.ts");

const BOT_ID = "900000000000000001";
const CHANNEL_ID = "500000000000000001";
const client = { user: { id: BOT_ID, username: "Lupos", displayAvatarURL: () => null } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const channel = {
  id: CHANNEL_ID,
  name: "general-chat",
  messages: { cache: new Collection(), fetch: vi.fn(async () => null) },
};

let nextId = 100;

function fakeMessage({
  content = "hello",
  authorId = "800000000000000001",
  referenceId,
  attachments = [] as { url: string; proxyURL?: string; contentType: string }[],
  sticker,
}: {
  content?: string;
  authorId?: string;
  referenceId?: string;
  attachments?: { url: string; proxyURL?: string; contentType: string }[];
  sticker?: { name: string; url: string };
} = {}) {
  const id = `7000000000000${nextId++}`;
  return {
    id,
    content,
    cleanContent: content,
    client,
    guild: {
      id: "600000000000000001",
      name: "Guild",
      memberCount: 3,
      premiumSubscriptionCount: 0,
      channels: { cache: { size: 1 } },
      members: { cache: new Collection() },
    },
    guildId: "600000000000000001",
    channelId: CHANNEL_ID,
    channel,
    createdTimestamp: Date.parse("2026-09-22T20:00:00Z"),
    editedTimestamp: null,
    author: { id: authorId, username: `user${authorId.slice(-2)}`, globalName: null },
    member: null,
    attachments: new Collection(
      attachments.map((attachment, index) => [String(index), { name: "file", ...attachment }]),
    ),
    stickers: new Collection(sticker ? [["s", { name: sticker.name, url: sticker.url }]] : []),
    embeds: [],
    reactions: { cache: new Collection() },
    mentions: { users: new Collection(), members: new Collection(), repliedUser: null },
    reference: referenceId ? { messageId: referenceId } : null,
  };
}
type FakeMessage = ReturnType<typeof fakeMessage>;

function history(messages: FakeMessage[]) {
  return new Collection(messages.map((message) => [message.id, message])) as never;
}

const noCaptions = { images: [], imagesMap: new Map() };

beforeEach(() => {
  vi.mocked(AIService.captionImages).mockReset();
  vi.mocked(AIService.captionImages).mockResolvedValue(noCaptions as never);
  vi.mocked(DiscordUtilityService.extractImageUrlsFromMessage).mockReset();
  vi.mocked(DiscordUtilityService.extractImageUrlsFromMessage).mockResolvedValue([]);
  vi.mocked(DiscordUtilityService.retrieveMessageReferenceFromMessage).mockClear();
  channel.messages.fetch.mockClear();
  ChannelSessionCache.clearAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractContentFromMessages — concurrency", () => {
  it("starts every message's link probes before any of them answers", async () => {
    const messages = [1, 2, 3, 4, 5].map((n) => fakeMessage({ content: `link https://x.example.com/${n}` }));
    const gates = messages.map(() => deferred<string[]>());
    vi.mocked(DiscordUtilityService.extractImageUrlsFromMessage).mockImplementation(
      async (message: { id: string }) => gates[messages.findIndex((m) => m.id === message.id)].promise,
    );
    const extraction = extractContentFromMessages(
      { message: messages[4] as never, recentMessages: history(messages) },
      {} as never,
      { windowSize: 50 },
    );
    await vi.waitFor(() =>
      expect(DiscordUtilityService.extractImageUrlsFromMessage).toHaveBeenCalledTimes(5),
    );
    gates.forEach((gate, index) =>
      gate.resolve(index === 2 ? ["https://x.example.com/3"] : []),
    );
    const { conversation, messagesImagesCollection } = await extraction;
    expect(conversation).toHaveLength(5);
    // Only the message whose link is an image was captioned.
    expect(AIService.captionImages).toHaveBeenCalledWith(["https://x.example.com/3"], {}, "IMAGE");
    expect(vi.mocked(AIService.captionImages).mock.calls.filter((call) => call[2] === "IMAGE")).toHaveLength(1);
    // Only a message that had image URLs gets a caption entry.
    expect([...messagesImagesCollection.keys()]).toEqual([messages[2].id]);
  });

  it("starts a sticker's caption in the first pass, before the image captions answer", async () => {
    const withImage = fakeMessage({ attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/a.png", contentType: "image/png" }] });
    const withSticker = fakeMessage({ content: "", sticker: { name: "wave", url: "https://media.discordapp.net/stickers/5.png" } });
    vi.mocked(DiscordUtilityService.extractImageUrlsFromMessage).mockImplementation(
      async (message: { id: string }) =>
        message.id === withImage.id ? ["https://cdn.discordapp.com/attachments/1/2/a.png"] : [],
    );
    const imageCaption = deferred<typeof noCaptions>();
    vi.mocked(AIService.captionImages).mockImplementation(async (_urls, _mongo, type) =>
      (type === "IMAGE" ? imageCaption.promise : noCaptions) as never,
    );
    const extraction = extractContentFromMessages(
      { message: withSticker as never, recentMessages: history([withImage, withSticker]) },
      {} as never,
      { windowSize: 50 },
    );
    await vi.waitFor(() =>
      expect(vi.mocked(AIService.captionImages).mock.calls.some((call) => call[2] === "STICKER")).toBe(true),
    );
    imageCaption.resolve(noCaptions);
    const { conversation } = await extraction;
    expect(conversation.at(-1)?.content).toContain('<sticker name="wave"');
  });

  it("never re-fetches a replied-to message that is in the fetched history", async () => {
    const quoted = fakeMessage({ content: "the original point" });
    const filler = [1, 2].map(() => fakeMessage());
    const inWindowReply = fakeMessage({ content: "agreed", referenceId: filler[1].id });
    const outOfWindowReply = fakeMessage({ content: "what?", referenceId: quoted.id });
    const { conversation } = await extractContentFromMessages(
      { message: outOfWindowReply as never, recentMessages: history([quoted, ...filler, inWindowReply, outOfWindowReply]) },
      {} as never,
      { windowSize: 3 }, // quoted is fetched but outside the window
    );
    expect(channel.messages.fetch).not.toHaveBeenCalled();
    expect(conversation.at(-2)?.content).toContain(`<replying-to id="${filler[1].id}"`);
    expect(conversation.at(-2)?.content).toContain('in-context="true"');
    expect(conversation.at(-1)?.content).toContain(`<replying-to id="${quoted.id}"`);
    expect(conversation.at(-1)?.content).toContain("the original point");
  });

  it("reports the window it chose and times its stages", async () => {
    const messages = [1, 2, 3, 4].map(() => fakeMessage());
    const selected: string[][] = [];
    const timings = new PrepTimings();
    await extractContentFromMessages(
      { message: messages[3] as never, recentMessages: history(messages) },
      {} as never,
      { windowSize: 2, onWindowSelected: (window) => selected.push(window.map((m) => m.id)), timings },
    );
    expect(selected).toEqual([[messages[2].id, messages[3].id]]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timings.line("x")).toMatch(/links=\d+ .*media=\d+ .*envelopes=\d+/);
  });
});

describe("buildAndGenerateReply — prep work", () => {
  function input(message: FakeMessage, recent: FakeMessage[], extra: Record<string, unknown> = {}) {
    return {
      conversation: [{ role: "user", content: "<discord-message …>" }],
      memberMentionsCollection: new Collection(),
      messagesEmojisCollection: new Collection(),
      messagesImagesCollection: new Collection(),
      newSystemPrompt: "",
      participantsAvatarsCollection: new Collection(),
      participantsCollection: new Collection(),
      participantsMembersCollection: new Collection(),
      participantsUsersCollection: new Collection(),
      queuedDatum: { message, recentMessages: history(recent) },
      userMentionsCollection: new Collection(),
      localMongo: {},
      ...extra,
    } as never;
  }

  beforeEach(() => {
    vi.mocked(PrismService.generateAgentResponse).mockReset();
    vi.mocked(PrismService.generateAgentResponse).mockResolvedValue({
      text: "ok", images: [], toolCalls: [], toolResults: [], audioRef: null,
    } as never);
  });

  afterEach(() => {
    // Every case must get as far as the /agent call (not the "..." catch).
    expect(PrismService.generateAgentResponse).toHaveBeenCalledOnce();
  });

  it("takes the replied-to message from the fetched history (no REST lookup)", async () => {
    const original = fakeMessage({ content: "look at this" });
    const trigger = fakeMessage({ content: "lupos, thoughts?", referenceId: original.id });
    await buildAndGenerateReply(input(trigger, [original, trigger]));
    expect(DiscordUtilityService.retrieveMessageReferenceFromMessage).not.toHaveBeenCalled();
  });

  it("still looks the replied-to message up when it is older than the history", async () => {
    const trigger = fakeMessage({ content: "lupos?", referenceId: "700000000000000001" });
    await buildAndGenerateReply(input(trigger, [trigger]));
    expect(DiscordUtilityService.retrieveMessageReferenceFromMessage).toHaveBeenCalledOnce();
  });

  it("starts the emoji captions up front, and keeps reference images before emojis", async () => {
    const imageUrl = "https://cdn.discordapp.com/attachments/1/2/a.png";
    const trigger = fakeMessage({
      content: "lupos what is this <:pog:111111111111111111>",
      attachments: [{ url: imageUrl, contentType: "image/png" }],
    });
    const referenceCaption = deferred<unknown>();
    const smallCalls: string[][] = [];
    vi.mocked(AIService.captionImages).mockImplementation(async (urls, _mongo, type) => {
      smallCalls.push(urls as string[]);
      if (type !== "SMALL") return noCaptions as never;
      if ((urls as string[])[0] === imageUrl) return referenceCaption.promise as never;
      return {
        images: ["pog face"],
        imagesMap: new Map([["h", { url: (urls as string[])[0], caption: "pog face" }]]),
      } as never;
    });
    const imagesCollection = new Collection([[trigger.id, new Collection([["h1", { url: imageUrl, caption: "long" }]])]]);
    const reply = buildAndGenerateReply(
      input(trigger, [trigger], { messagesImagesCollection: imagesCollection }),
    );
    // Both caption requests are out while the reference caption is pending.
    await vi.waitFor(() => expect(smallCalls).toHaveLength(2));
    expect(smallCalls[0]).toEqual(["https://cdn.discordapp.com/emojis/111111111111111111.png"]);
    referenceCaption.resolve({ images: ["a cat"], imagesMap: new Map([["h2", { url: imageUrl, caption: "a cat" }]]) });
    await reply;
    const sent = vi.mocked(PrismService.generateAgentResponse).mock.calls[0][0];
    const lastUser = sent.messages.filter((m: { role: string }) => m.role === "user").at(-1);
    expect(lastUser.images).toEqual([imageUrl, "https://cdn.discordapp.com/emojis/111111111111111111.png"]);
    expect(lastUser.content.indexOf("Attached image")).toBeLessThan(lastUser.content.indexOf("Emoji: pog"));
  });

  it("logs one ⏱️ [prep] line with its stages right before calling /agent", async () => {
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
    vi.mocked(PrismService.generateAgentResponse).mockImplementation(async () => {
      expect(lines.filter((line) => line.startsWith("⏱️ [prep]"))).toHaveLength(1);
      return { text: "ok", images: [], toolCalls: [], toolResults: [], audioRef: null } as never;
    });
    const trigger = fakeMessage({ content: "lupos, hi" });
    const timings = new PrepTimings(trigger.createdTimestamp);
    timings.record("fetch", 1200);
    await buildAndGenerateReply(input(trigger, [trigger], { timings }));
    const line = lines.find((entry) => entry.startsWith("⏱️ [prep]"))!;
    expect(line).toMatch(
      new RegExp(`^⏱️ \\[prep\\] ${trigger.id} fetch=1200 dossier=\\d+ refs=\\d+ avatars=\\d+ emoji=\\d+ prompt=\\d+ total=\\d+ sinceTrigger=\\d+$`),
    );
  });
});

describe("prefetchTriggerReferenceCaptions / prefetchRepliedImageCaption", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("starts the SMALL captions of the trigger's image and video attachments, and its emojis", async () => {
    vi.mocked(DiscordUtilityService.extractImageUrlsFromMessage).mockResolvedValue(["https://cdn.discordapp.com/attachments/1/2/a.png"]);
    const trigger = fakeMessage({
      content: "lupos <:pog:111111111111111111>",
      attachments: [
        { url: "https://cdn.discordapp.com/attachments/1/2/a.png", contentType: "image/png" },
        { url: "https://cdn.discordapp.com/attachments/1/3/v.mp4", contentType: "video/mp4" },
      ],
    });
    prefetchTriggerReferenceCaptions(trigger as never, {} as never);
    await settle();
    expect(AIService.captionImages).toHaveBeenCalledWith(
      ["https://cdn.discordapp.com/attachments/1/2/a.png", "https://cdn.discordapp.com/attachments/1/3/v.mp4"],
      {},
      "SMALL",
    );
    expect(AIService.captionImages).toHaveBeenCalledWith(
      ["https://cdn.discordapp.com/emojis/111111111111111111.png"],
      {},
      "SMALL",
    );
  });

  it("starts nothing for a trigger without attachments or emojis (no wasted vision calls)", async () => {
    prefetchTriggerReferenceCaptions(fakeMessage({ content: "lupos, hi" }) as never, {} as never);
    await settle();
    expect(AIService.captionImages).not.toHaveBeenCalled();
  });

  it("the replied-to image: as captioned in the extracted slice, else its first image attachment", async () => {
    const referenced = fakeMessage({
      attachments: [{ url: "https://cdn.discordapp.com/attachments/1/9/r.png", proxyURL: "https://media.discordapp.net/attachments/1/9/r.png", contentType: "image/png" }],
    });
    vi.mocked(DiscordUtilityService.extractImageUrlsFromMessage).mockResolvedValue(["https://cdn.discordapp.com/attachments/1/9/r.png"]);
    const trigger = fakeMessage({ referenceId: referenced.id });
    const recent = history([referenced, trigger]);

    prefetchRepliedImageCaption({ message: trigger as never, recentMessages: recent, extractedMessageIds: new Set([referenced.id]), localMongo: {} as never });
    await settle();
    expect(AIService.captionImages).toHaveBeenLastCalledWith(["https://cdn.discordapp.com/attachments/1/9/r.png"], {}, "SMALL");

    prefetchRepliedImageCaption({ message: trigger as never, recentMessages: recent, extractedMessageIds: new Set(), localMongo: {} as never });
    await settle();
    expect(AIService.captionImages).toHaveBeenLastCalledWith(["https://media.discordapp.net/attachments/1/9/r.png"], {}, "SMALL");
  });

  it("never throws, even on a message it can't read", () => {
    expect(() => prefetchTriggerReferenceCaptions({} as never, {} as never)).not.toThrow();
    expect(() =>
      prefetchRepliedImageCaption({ message: {} as never, recentMessages: history([]), extractedMessageIds: new Set(), localMongo: {} as never }),
    ).not.toThrow();
  });
});
