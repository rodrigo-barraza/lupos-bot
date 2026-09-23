// The prep-latency layer under the history extraction: in-flight sharing
// and short-lived reuse (PromiseMemo) of link probes, content hashes of
// immutable media and Tenor scrapes — with every failure behaving exactly
// as it did without the memo (answered, never kept).

import PromiseMemo, { prefetch } from "../PromiseMemo.ts";
import {
  clearNetMemos,
  generateFileHash,
  isImageUrl,
  isImmutableMediaUrl,
  FILE_HASH_TIMEOUT_MS,
  IMAGE_PROBE_TIMEOUT_MS,
} from "../net.ts";

const { default: ScraperService } =
  await import("#root/services/ScraperService.ts");
const { default: DiscordUtilityService } =
  await import("#root/services/DiscordUtilityService.ts");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A fetch stub answering each URL with `respond(url)`; records calls. */
function stubFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; signal?: AbortSignal }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, signal: init?.signal ?? undefined });
      return respond(url);
    }),
  );
  return calls;
}

beforeEach(() => {
  clearNetMemos();
  ScraperService.clearTenorMemo();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PromiseMemo", () => {
  it("shares one in-flight request and reuses its result", async () => {
    const memo = new PromiseMemo<string>(10, 60_000);
    const gate = deferred<string>();
    const produce = vi.fn(() => gate.promise);
    const first = memo.get("k", produce);
    const second = memo.get("k", produce);
    gate.resolve("v");
    expect(await first).toBe("v");
    expect(await second).toBe("v");
    expect(await memo.get("k", produce)).toBe("v");
    expect(produce).toHaveBeenCalledOnce();
  });

  it("hands a null result to its waiters, then forgets it", async () => {
    const memo = new PromiseMemo<string>(10, 60_000);
    const produce = vi.fn(async () => null);
    expect(await memo.get("k", produce)).toBeNull();
    expect(await memo.get("k", produce)).toBeNull();
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it("propagates a rejection to its waiters, then forgets it", async () => {
    const memo = new PromiseMemo<string>(10, 60_000);
    const produce = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    await expect(memo.get("k", produce)).rejects.toThrow("boom");
    expect(await memo.get("k", produce)).toBe("ok");
  });

  it("expires after its TTL", async () => {
    vi.useFakeTimers();
    try {
      const memo = new PromiseMemo<string>(10, 1_000);
      const produce = vi.fn(async () => "v");
      await memo.get("k", produce);
      vi.advanceTimersByTime(1_001);
      await memo.get("k", produce);
      expect(produce).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("prefetch never throws, synchronously or asynchronously", async () => {
    expect(() =>
      prefetch(() => {
        throw new TypeError("not a function");
      }),
    ).not.toThrow();
    prefetch(async () => {
      throw new Error("rejected");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("isImmutableMediaUrl", () => {
  it("covers Discord's CDN and Tenor media, not Discord's /external/ proxy or other hosts", () => {
    expect(
      isImmutableMediaUrl(
        "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2&hm=3",
      ),
    ).toBe(true);
    expect(
      isImmutableMediaUrl("https://cdn.discordapp.com/emojis/123.png"),
    ).toBe(true);
    expect(
      isImmutableMediaUrl("https://media.discordapp.net/stickers/5.png"),
    ).toBe(true);
    expect(isImmutableMediaUrl("https://media.tenor.com/abc/cat.gif")).toBe(
      true,
    );
    expect(
      isImmutableMediaUrl(
        "https://media.discordapp.net/external/xyz/https/example.com/a.png",
      ),
    ).toBe(false);
    expect(isImmutableMediaUrl("https://example.com/random.png")).toBe(false);
    expect(isImmutableMediaUrl("not a url")).toBe(false);
  });
});

describe("generateFileHash", () => {
  const image = () =>
    new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    });

  it("downloads an immutable media URL once per hour, sharing a download in flight", async () => {
    const calls = stubFetch(image);
    const url = "https://cdn.discordapp.com/attachments/1/2/a.png";
    const [first, second] = await Promise.all([
      generateFileHash(url),
      generateFileHash(url),
    ]);
    const third = await generateFileHash(url);
    expect(first).toEqual(second);
    expect(third).toEqual(first);
    expect(first?.fileType).toBe("image/png");
    expect(calls).toHaveLength(1);
  });

  it("always re-downloads other hosts (their bytes may change)", async () => {
    const calls = stubFetch(image);
    await generateFileHash("https://example.com/a.png");
    await generateFileHash("https://example.com/a.png");
    expect(calls).toHaveLength(2);
  });

  it("keeps no failure: a 404 or an error is retried next time", async () => {
    let status = 404;
    const calls = stubFetch(() => new Response("", { status }));
    const url = "https://cdn.discordapp.com/attachments/1/2/gone.png";
    expect(await generateFileHash(url)).toBeNull();
    status = 200;
    expect(await generateFileHash(url)).not.toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("bounds the download", async () => {
    const calls = stubFetch(image);
    await generateFileHash("https://example.com/a.png");
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(FILE_HASH_TIMEOUT_MS).toBe(30_000);
  });
});

describe("isImageUrl", () => {
  it("reads only the headers (the body is cancelled) under a timeout", async () => {
    const cancel = vi.fn(async () => {});
    const calls = stubFetch(() => {
      const response = new Response("<html>…</html>", {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "body", { value: { cancel } });
      return response;
    });
    expect(await isImageUrl("https://news.example.com/story")).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(IMAGE_PROBE_TIMEOUT_MS).toBe(10_000);
  });

  it("probes a link once per hour", async () => {
    const calls = stubFetch(
      () => new Response("", { headers: { "content-type": "image/jpeg" } }),
    );
    expect(await isImageUrl("https://i.example.com/cat.jpg")).toBe(true);
    expect(await isImageUrl("https://i.example.com/cat.jpg")).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("answers an error page or a network failure as before, and keeps neither", async () => {
    let mode: "503" | "throw" | "ok" = "503";
    const calls = stubFetch(() => {
      if (mode === "throw") throw new TypeError("fetch failed");
      return new Response("", {
        status: mode === "503" ? 503 : 200,
        headers: { "content-type": mode === "503" ? "text/html" : "image/png" },
      });
    });
    const url = "https://flaky.example.com/a";
    expect(await isImageUrl(url)).toBe(false);
    mode = "throw";
    expect(await isImageUrl(url)).toBe(false);
    mode = "ok";
    expect(await isImageUrl(url)).toBe(true);
    expect(calls).toHaveLength(3);
  });
});

describe("ScraperService.scrapeTenor", () => {
  it("keeps a found GIF for an hour", async () => {
    const calls = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            image: "https://media.tenor.com/x/cat.gif",
            title: "cat",
          }),
        ),
    );
    const first = await ScraperService.scrapeTenor(
      "https://tenor.com/view/cat-123",
    );
    const second = await ScraperService.scrapeTenor(
      "https://tenor.com/view/cat-123",
    );
    expect(first).toEqual(second);
    expect(first.image).toBe("https://media.tenor.com/x/cat.gif");
    expect(first.name).toBe("cat 123");
    expect(calls).toHaveLength(1);
  });

  it("scrapes a miss once per call, and retries it next time", async () => {
    const calls = stubFetch(() => new Response("", { status: 502 }));
    const result = await ScraperService.scrapeTenor(
      "https://tenor.com/view/dog-9",
    );
    expect(result).toEqual({ name: "dog 9" });
    await ScraperService.scrapeTenor("https://tenor.com/view/dog-9");
    expect(calls).toHaveLength(2);
  });
});

describe("DiscordUtilityService.extractImageUrlsFromMessage", () => {
  it("probes a message's links concurrently and keeps their order", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<Response>>>();
    stubFetch((url) => {
      const gate = deferred<Response>();
      gates.set(url, gate);
      return gate.promise;
    });
    const pending = DiscordUtilityService.extractImageUrlsFromMessage({
      attachments: new Map([
        [
          "a",
          {
            url: "https://cdn.discordapp.com/attachments/1/2/att.png",
            contentType: "image/png",
          },
        ],
      ]),
      content:
        "https://a.example.com/1 and https://b.example.com/2 and https://c.example.com/3",
    } as never);
    await vi.waitFor(() => expect(gates.size).toBe(3)); // all three in flight at once
    const answer = (url: string, type: string) =>
      gates
        .get(url)!
        .resolve(new Response("", { headers: { "content-type": type } }));
    answer("https://c.example.com/3", "image/gif");
    answer("https://a.example.com/1", "image/png");
    answer("https://b.example.com/2", "text/html");
    expect(await pending).toEqual([
      "https://cdn.discordapp.com/attachments/1/2/att.png",
      "https://a.example.com/1",
      "https://c.example.com/3",
    ]);
  });
});
