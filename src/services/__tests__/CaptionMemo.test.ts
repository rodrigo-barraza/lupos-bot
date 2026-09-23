// AIService.captionImages shares one caption per (type, url) between
// callers — the trigger's captions are prefetched at acceptance and the
// extraction / reference-image steps join them — without changing what a
// caller gets back, and without keeping a failure.

vi.mock("../PrismService", () => ({
  default: { captionImage: vi.fn() },
}));
vi.mock("../DiscordUtilityService", () => ({ default: {} }));

const AIService = (await import("../AIService.ts")).default;
const PrismService = (await import("../PrismService.ts")).default;
const { clearNetMemos } = await import("#root/utilities/net.ts");

const IMAGE_URL = "https://cdn.discordapp.com/attachments/1/2/cat.png";

/** One fake Mongo collection per caption type (ImageCaptions, SmallCaptions, …). */
function fakeMongo() {
  const collections = new Map<string, ReturnType<typeof fakeCollection>>();
  function fakeCollection() {
    const stored = new Map<string, Record<string, unknown>>();
    return {
      findOne: vi.fn(
        async ({ hash }: { hash: string }) => stored.get(hash) ?? null,
      ),
      insertOne: vi.fn(async (doc: Record<string, unknown>) => {
        stored.set(doc.hash as string, doc);
      }),
    };
  }
  const collectionNamed = (name: string) => {
    if (!collections.has(name)) collections.set(name, fakeCollection());
    return collections.get(name)!;
  };
  return {
    collection: collectionNamed("SmallCaptions"),
    client: { db: () => ({ collection: collectionNamed }) } as never,
  };
}

let downloads = 0;

beforeEach(() => {
  clearNetMemos();
  downloads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      downloads++;
      return new Response(`bytes of ${url}`, {
        headers: { "content-type": "image/png" },
      });
    }),
  );
  vi.mocked(PrismService.captionImage).mockReset();
  vi.mocked(PrismService.captionImage).mockResolvedValue({
    text: "a cat",
    model: "m",
    provider: "p",
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AIService.captionImages — shared captions", () => {
  it("two callers captioning one image at once share one download and one vision call", async () => {
    const { client, collection } = fakeMongo();
    // Each test uses its own URL: the caption memo is module-wide.
    const url = `${IMAGE_URL}?case=shared`;
    const [prefetched, joined] = await Promise.all([
      AIService.captionImages([url], client, "SMALL"),
      AIService.captionImages([url], client, "SMALL"),
    ]);
    expect(prefetched.images).toEqual(["a cat"]);
    expect(joined.images).toEqual(["a cat"]);
    expect([...joined.imagesMap.values()][0]).toMatchObject({
      url,
      caption: "a cat",
    });
    expect(PrismService.captionImage).toHaveBeenCalledOnce();
    expect(collection.insertOne).toHaveBeenCalledOnce();
    expect(downloads).toBe(1);
  });

  it("keeps caption types apart (IMAGE and SMALL are different prompts)", async () => {
    const { client } = fakeMongo();
    const url = `${IMAGE_URL}?case=types`;
    await AIService.captionImages([url], client, "IMAGE");
    await AIService.captionImages([url], client, "SMALL");
    expect(PrismService.captionImage).toHaveBeenCalledTimes(2);
    const prompts = vi
      .mocked(PrismService.captionImage)
      .mock.calls.map((call) => call[0].prompt);
    expect(prompts[0]).toContain("Describe this image.");
    expect(prompts[1]).toContain("10 words or less");
    expect(downloads).toBe(1); // the hash of immutable media is shared
  });

  it("keeps no failed caption: the next caller tries again", async () => {
    const { client } = fakeMongo();
    const url = `${IMAGE_URL}?case=retry`;
    vi.mocked(PrismService.captionImage).mockRejectedValueOnce(
      new Error("vision down"),
    );
    expect(
      (await AIService.captionImages([url], client, "IMAGE")).images,
    ).toEqual([]);
    expect(
      (await AIService.captionImages([url], client, "IMAGE")).images,
    ).toEqual(["a cat"]);
  });

  it("returns captions in URL order, skipping the ones that failed", async () => {
    const { client } = fakeMongo();
    const good = `${IMAGE_URL}?case=order-a`;
    const bad = "https://cdn.discordapp.com/attachments/1/2/missing.png";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === bad
          ? new Response("", { status: 404 })
          : new Response(`bytes of ${url}`, {
              headers: { "content-type": "image/png" },
            }),
      ),
    );
    const { images, imagesMap } = await AIService.captionImages(
      [bad, good],
      client,
      "EMOJI",
    );
    expect(images).toEqual(["a cat"]);
    expect([...imagesMap.values()].map((entry) => entry.url)).toEqual([good]);
  });
});
