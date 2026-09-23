// TurnSteering (round-2 contract §4): which follow-ups fold into the
// running turn, what Prism is handed, and which folded follow-ups are
// handed back to be queued because the turn did not answer them.

vi.mock("#root/services/PrismService.ts", () => ({
  default: { postAgentInput: vi.fn() },
  conversationIdOf: (event: { conversationId?: unknown }) =>
    typeof event.conversationId === "string" ? event.conversationId : null,
}));
vi.mock("#root/services/DiscordUtilityService.ts", () => ({
  default: { getUsernameNoSpaces: () => "alice" },
}));

const { Collection } = await import("discord.js");
const PrismService = (await import("#root/services/PrismService.ts")).default;
const DiscordState = (await import("../DiscordState.ts")).default;
const {
  FOLDED_REACTION,
  buildFoldInput,
  openSteerableTurn,
  resetTurnSteering,
  tryFoldIntoRunningTurn,
} = await import("../TurnSteering.ts");

const ALICE = "800000000000000001";
const BOB = "800000000000000002";
const CHANNEL = "600000000000000001";
const OTHER_CHANNEL = "600000000000000002";

let nextId = 7000;

function fakeMessage({
  authorId = ALICE,
  channelId = CHANNEL,
  content = "lupos, also this",
  attachments = [] as {
    url: string;
    proxyURL?: string;
    contentType: string;
    name?: string;
    size?: number;
  }[],
  referenceId,
}: {
  authorId?: string;
  channelId?: string;
  content?: string;
  attachments?: {
    url: string;
    proxyURL?: string;
    contentType: string;
    name?: string;
    size?: number;
  }[];
  referenceId?: string;
} = {}) {
  const id = `70000000000000${nextId++}`;
  return {
    id,
    channelId,
    content,
    createdTimestamp: Date.parse("2026-09-22T20:00:00Z"),
    author: { id: authorId, username: authorId === ALICE ? "alice" : "bob" },
    member: { displayName: authorId === ALICE ? "Queen Alice" : "Bob" },
    attachments: new Collection(
      attachments.map((attachment, index) => [String(index), attachment]),
    ),
    stickers: new Collection(),
    mentions: { repliedUser: referenceId ? { id: BOB } : null },
    reference: referenceId ? { messageId: referenceId } : null,
    react: vi.fn().mockResolvedValue(undefined),
  } as never as import("discord.js").Message & {
    react: ReturnType<typeof vi.fn>;
  };
}

/** A turn for Alice in CHANNEL whose stream has named its conversation. */
function streamingTurn() {
  const trigger = fakeMessage({ content: "lupos, first question" });
  const turn = openSteerableTurn(trigger);
  turn.observe({ type: "user_message", conversationId: "conv-1" });
  return { trigger, turn };
}

beforeEach(() => {
  resetTurnSteering();
  vi.mocked(PrismService.postAgentInput).mockReset();
  vi.mocked(PrismService.postAgentInput).mockResolvedValue("input-1");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tryFoldIntoRunningTurn — who may fold", () => {
  it("folds the author's follow-up: posts it to the turn, reacts 👀 once, marks it taken", async () => {
    const { turn } = streamingTurn();
    const followUp = fakeMessage();
    await expect(tryFoldIntoRunningTurn(followUp, "name")).resolves.toBe(true);
    expect(PrismService.postAgentInput).toHaveBeenCalledOnce();
    const [conversationId, input, username] = vi.mocked(
      PrismService.postAgentInput,
    ).mock.calls[0];
    expect(conversationId).toBe("conv-1");
    expect(input.text).toContain(`<discord-message id="${followUp.id}"`);
    expect(username).toBe("alice");
    expect(followUp.react).toHaveBeenCalledOnce();
    expect(followUp.react).toHaveBeenCalledWith(FOLDED_REACTION);
    expect(DiscordState.wasAcceptedForReply(followUp.id)).toBe(true);
    expect(turn.folds.map((fold) => fold.inputId)).toEqual(["input-1"]);
  });

  it("never folds another author's message, or one in another channel", async () => {
    streamingTurn();
    expect(
      await tryFoldIntoRunningTurn(fakeMessage({ authorId: BOB }), "mention"),
    ).toBe(false);
    expect(
      await tryFoldIntoRunningTurn(
        fakeMessage({ channelId: OTHER_CHANNEL }),
        "mention",
      ),
    ).toBe(false);
    expect(PrismService.postAgentInput).not.toHaveBeenCalled();
  });

  it("never folds a message that reached him on the ambient path", async () => {
    streamingTurn();
    expect(await tryFoldIntoRunningTurn(fakeMessage(), "ambient")).toBe(false);
    expect(PrismService.postAgentInput).not.toHaveBeenCalled();
  });

  it("waits for the stream to name the conversation", async () => {
    openSteerableTurn(fakeMessage({ content: "lupos, first" }));
    expect(await tryFoldIntoRunningTurn(fakeMessage(), "name")).toBe(false);
    expect(PrismService.postAgentInput).not.toHaveBeenCalled();
  });

  it("never folds into a turn that has produced its reply (stream done) or was closed", async () => {
    const { turn } = streamingTurn();
    turn.observe({ type: "done" });
    expect(await tryFoldIntoRunningTurn(fakeMessage(), "name")).toBe(false);

    const second = streamingTurn();
    second.turn.close();
    expect(await tryFoldIntoRunningTurn(fakeMessage(), "name")).toBe(false);
    expect(PrismService.postAgentInput).not.toHaveBeenCalled();
  });

  it("never folds the trigger into itself", async () => {
    const { trigger } = streamingTurn();
    expect(await tryFoldIntoRunningTurn(trigger, "name")).toBe(false);
  });

  it("hands the message back when Prism refuses it (409/error): no 👀, not marked taken", async () => {
    vi.mocked(PrismService.postAgentInput).mockResolvedValue(null);
    streamingTurn();
    const followUp = fakeMessage();
    await expect(tryFoldIntoRunningTurn(followUp, "name")).resolves.toBe(false);
    expect(followUp.react).not.toHaveBeenCalled();
    expect(DiscordState.wasAcceptedForReply(followUp.id)).toBe(false);
  });

  it("hands the message back, unmarked, when it can't even be built", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    streamingTurn();
    const broken = {
      ...fakeMessage(),
      attachments: null,
      content: undefined,
      author: { id: ALICE },
    };
    Object.defineProperty(broken, "attachments", {
      get() {
        throw new Error("partial message");
      },
    });
    await expect(tryFoldIntoRunningTurn(broken as never, "name")).resolves.toBe(
      false,
    );
    expect(PrismService.postAgentInput).not.toHaveBeenCalled();
    expect(DiscordState.wasAcceptedForReply(broken.id)).toBe(false);
  });

  it("an edit of a folded follow-up never queues a reply of its own", async () => {
    streamingTurn();
    const followUp = fakeMessage();
    await tryFoldIntoRunningTurn(followUp, "mention");
    expect(DiscordState.isEditANewMention(followUp.id, true, false)).toBe(
      false,
    );
  });

  it("a newer turn by the same author replaces (and closes) the older one", () => {
    const { turn: older } = streamingTurn();
    const { turn: newer } = streamingTurn();
    expect(older.closed).toBe(true);
    expect(newer.closed).toBe(false);
  });
});

describe("SteerableTurn.settle — folds the turn did not answer are handed back", () => {
  async function foldOne(boundary?: string) {
    const { turn } = streamingTurn();
    const followUp = fakeMessage();
    await tryFoldIntoRunningTurn(followUp, "reply");
    if (boundary) turn.observe({ type: "turn_input", id: "input-1", boundary });
    return { turn, followUp };
  }

  it("keeps a fold the delivered reply answered (applied before the last pass)", async () => {
    for (const boundary of [
      "iteration_start",
      "after_tools",
      "before_end",
      "native_steer",
    ]) {
      const { turn, followUp } = await foldOne(boundary);
      expect(turn.answeredFoldTurns().map((fold) => fold.id)).toEqual([
        followUp.id,
      ]);
      turn.modelReplied = true;
      turn.delivered = true;
      await expect(turn.settle()).resolves.toEqual([]);
    }
  });

  it("hands back a fold that only joined as the turn ended, or was never acknowledged", async () => {
    for (const boundary of ["turn_end", undefined]) {
      const { turn, followUp } = await foldOne(boundary);
      expect(turn.answeredFoldTurns()).toEqual([]);
      turn.modelReplied = true;
      turn.delivered = true;
      const unanswered = await turn.settle();
      expect(unanswered.map((fold) => fold.message.id)).toEqual([followUp.id]);
      expect(unanswered[0].replyMode).toBe("reply");
    }
  });

  it("hands back every fold when the turn failed or its reply never posted", async () => {
    const failed = await foldOne("before_end");
    failed.turn.delivered = true; // "..." fallback posted, but the model never replied
    expect(await failed.turn.settle()).toHaveLength(1);

    const undelivered = await foldOne("before_end");
    undelivered.turn.modelReplied = true; // e.g. trigger deleted before posting
    expect(await undelivered.turn.settle()).toHaveLength(1);
  });

  it("never hands back a follow-up Prism refused (it was queued on the spot)", async () => {
    vi.mocked(PrismService.postAgentInput).mockResolvedValue(null);
    const { turn } = streamingTurn();
    await tryFoldIntoRunningTurn(fakeMessage(), "name");
    await expect(turn.settle()).resolves.toEqual([]);
  });

  it("waits for a fold still being posted when the turn ends", async () => {
    let answer: (inputId: string | null) => void = () => {};
    vi.mocked(PrismService.postAgentInput).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { turn } = streamingTurn();
    const folding = tryFoldIntoRunningTurn(fakeMessage(), "name");
    turn.modelReplied = true;
    turn.delivered = true;
    const settled = turn.settle();
    answer("input-9"); // taken just as the turn sealed — never acknowledged
    expect(await folding).toBe(true);
    expect(await settled).toHaveLength(1);
  });
});

describe("buildFoldInput", () => {
  it("renders the follow-up as a <discord-message> envelope with its images", () => {
    const message = fakeMessage({
      content: "and this one?",
      referenceId: "700000000000000001",
      attachments: [
        {
          url: "https://cdn.discordapp.com/attachments/1/2/cat.png",
          contentType: "image/png",
          size: 1048576,
        },
        {
          url: "https://cdn.discordapp.com/attachments/1/3/clip.mp4",
          proxyURL: "https://media.discordapp.net/attachments/1/3/clip.mp4",
          contentType: "video/mp4",
          name: "clip.mp4",
        },
      ],
    });
    const { text, images } = buildFoldInput(message);
    expect(images).toEqual([
      "https://cdn.discordapp.com/attachments/1/2/cat.png",
    ]);
    expect(text).toContain(`id="${message.id}"`);
    expect(text).toContain('author="Queen Alice"');
    expect(text).toContain(`author-id="${ALICE}"`);
    expect(text).toContain('<replying-to id="700000000000000001"');
    expect(text).toContain("and this one?");
    expect(text).toContain(
      'url="https://cdn.discordapp.com/attachments/1/2/cat.png"',
    );
    expect(text).toContain(
      'url="https://media.discordapp.net/attachments/1/3/clip.mp4"',
    );
  });
});
