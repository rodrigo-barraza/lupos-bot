// The archive must not write withheld content over what it holds: without
// the MessageContent intent Discord sends every message that doesn't
// @-mention Lupos with empty content, embeds and attachments — on edits
// too, so an edit of a message archived earlier would blank its copy.

const withheld = vi.hoisted(() => ({ value: false }));

vi.mock("#root/wrappers/DiscordWrapper.ts", () => ({
  isMessageContentWithheld: vi.fn(() => withheld.value),
}));
vi.mock("#root/services/MediaArchivalService.ts", () => ({
  default: { isAvailable: () => false },
}));
vi.mock("#root/services/discord/transformers.ts", () => ({
  transformMessageRoot: vi.fn(() => ({
    id: "1558177010449129573",
    guildId: "609471635308937237",
    content: "",
    cleanContent: "",
    embeds: [],
    attachments: [],
    components: [],
    poll: null,
    messageSnapshots: [],
    reactions: [],
    editedAt: new Date(0),
    editedTimestamp: 0,
    pinned: false,
    member: null,
  })),
  transformReaction: vi.fn(),
}));

const MessageArchive = (await import("../MessageArchive.ts")).default;

const CONTENT_FIELDS = [
  "content",
  "cleanContent",
  "embeds",
  "attachments",
  "components",
  "poll",
  "messageSnapshots",
];

function fakeMongo() {
  const updateOne = vi.fn();
  const mongo = { db: () => ({ collection: () => ({ updateOne }) }) };
  return { mongo: mongo as never, updateOne };
}

const message = { id: "1558177010449129573" } as never;

beforeEach(() => {
  withheld.value = false;
});

describe("updateMessageInMongo", () => {
  it("leaves the archived content alone when Discord withheld the edit's content", async () => {
    withheld.value = true;
    const { mongo, updateOne } = fakeMongo();
    await MessageArchive.updateMessageInMongo(message, mongo);
    const update = updateOne.mock.calls[0][1].$set;
    for (const field of CONTENT_FIELDS)
      expect(update).not.toHaveProperty(field);
    expect(update).toHaveProperty("editedTimestamp");
  });

  it("writes the content when Discord sent it", async () => {
    const { mongo, updateOne } = fakeMongo();
    await MessageArchive.updateMessageInMongo(message, mongo);
    expect(updateOne.mock.calls[0][1].$set).toHaveProperty("content", "");
  });
});

describe("saveMessageToMongo", () => {
  it("inserts withheld content as withheld and never overwrites an existing copy with it", async () => {
    withheld.value = true;
    const { mongo, updateOne } = fakeMongo();
    await MessageArchive.saveMessageToMongo(message, mongo);
    const [, { $set, $setOnInsert }] = updateOne.mock.calls[0];
    for (const field of CONTENT_FIELDS) expect($set).not.toHaveProperty(field);
    expect($setOnInsert).toMatchObject({ content: "", contentWithheld: true });
    expect($set).toHaveProperty("reactions");
  });

  it("keeps content in $set (and no withheld mark) when Discord sent it", async () => {
    const { mongo, updateOne } = fakeMongo();
    await MessageArchive.saveMessageToMongo(message, mongo);
    const [, { $set, $setOnInsert }] = updateOne.mock.calls[0];
    expect($set).toHaveProperty("content");
    expect($setOnInsert).not.toHaveProperty("content");
    expect($setOnInsert).not.toHaveProperty("contentWithheld");
  });
});
