import { describe, expect, it } from "vitest";
import {
  aggregateSentiment,
  aggregateAuthorConsensus,
  confirmMarketDirection,
  findExplicitAssetSymbols,
  isWithinSentimentWindow,
  newsSentimentAnalysisKey,
  newsSentimentContentHash,
  parseSentimentResponse,
  sentimentAnalysisKey,
} from "@/lib/social/sentiment";
import { normalizeXTweet, xCollectionStartTime } from "@/lib/social/x-provider";

describe("social sentiment output validation", () => {
  const posts = [{ id: "post-1", text: "Bitcoin adoption is rising." }, { id: "post-2", text: "Markets remain uncertain." }];
  const assets = [{ symbol: "BTC", name: "Bitcoin", chain: null, contractAddress: null }];

  it("accepts validated model output and filters symbols outside the supported asset list", () => {
    const raw = `\`\`\`json
      {"results":[
        {"postId":"post-1","sentiment":"positive","score":72,"confidence":0.8,"symbols":["btc","UNKNOWN"],"summary":"The post expresses optimism about adoption."},
        {"postId":"post-2","sentiment":"neutral","score":2,"confidence":0.5,"symbols":[],"summary":"The post describes an uncertain market."}
      ]}
    \`\`\``;

    expect(parseSentimentResponse(raw, posts, assets)).toMatchObject([
      { postId: "post-1", symbols: ["BTC"], score: 72 },
      { postId: "post-2", symbols: [], sentiment: "neutral" },
    ]);
  });

  it("drops unknown and duplicate post IDs rather than attaching fabricated evidence", () => {
    const raw = JSON.stringify({ results: [
      { postId: "post-1", sentiment: "positive", score: 20, confidence: 0.7, symbols: ["BTC"], summary: "The post expresses positive tone." },
      { postId: "post-1", sentiment: "negative", score: -90, confidence: 1, symbols: ["BTC"], summary: "A duplicate response." },
      { postId: "not-collected", sentiment: "positive", score: 90, confidence: 1, symbols: ["BTC"], summary: "An unknown response." },
    ] });
    expect(parseSentimentResponse(raw, posts, assets)).toHaveLength(1);
  });

  it("only carries an earlier author's coin link when the model cites a verified context post", () => {
    const postWithContext = [{
      id: "follow-up",
      text: "it is finally moving",
      context: [{
        id: "earlier-post",
        text: "$BTC breakout",
        publishedAt: "2026-10-07T10:00:00.000Z",
        sourceUrl: "https://x.com/author/status/earlier-post",
        verifiedSymbols: ["BTC"],
        relation: "explicit-reference" as const,
      }],
    }];
    const cited = JSON.stringify({ results: [{
      postId: "follow-up",
      sentiment: "positive",
      score: 45,
      confidence: 0.7,
      symbols: ["BTC"],
      contextReferences: [{ postId: "earlier-post", symbol: "BTC" }],
      summary: "The post continues a positive market discussion.",
    }] });
    const uncited = JSON.stringify({ results: [{
      postId: "follow-up",
      sentiment: "positive",
      score: 45,
      confidence: 0.7,
      symbols: ["BTC"],
      summary: "The post may be about Bitcoin.",
    }] });

    expect(parseSentimentResponse(cited, postWithContext, assets)[0]).toMatchObject({
      symbols: ["BTC"],
      contextReferences: [{ postId: "earlier-post", symbol: "BTC" }],
    });
    expect(parseSentimentResponse(uncited, postWithContext, assets)[0].symbols).toEqual([]);
  });

  it("extracts an emerging coin only when its evidence is quoted in the post or an explicit thread reference", () => {
    const input = [{
      id: "new-token-post",
      text: "This launch looks interesting: #MoonFrog",
      context: [{
        id: "linked-post",
        text: "CA: 0x1234567890123456789012345678901234567890",
        publishedAt: "2026-10-07T10:00:00.000Z",
        sourceUrl: "https://x.com/author/status/linked-post",
        verifiedSymbols: [],
        relation: "explicit-reference" as const,
      }],
    }];
    const raw = JSON.stringify({ results: [{
      postId: "new-token-post",
      sentiment: "positive",
      score: 60,
      confidence: 0.9,
      symbols: [],
      coinMentions: [
        { name: "MoonFrog", symbol: "MFROG", chain: null, contractAddress: null, evidence: "#MoonFrog", contextPostId: null },
        { name: "Invented Coin", symbol: "FAKE", chain: null, contractAddress: null, evidence: "#MoonFrog", contextPostId: null },
        {
          name: "MoonFrog",
          symbol: "MFROG",
          chain: "ethereum",
          contractAddress: "0x1234567890123456789012345678901234567890",
          evidence: "0x1234567890123456789012345678901234567890",
          contextPostId: "linked-post",
        },
      ],
      summary: "The post expresses optimism about a token launch.",
    }] });

    expect(parseSentimentResponse(raw, input, assets)[0].coinMentions).toEqual([
      { name: "MoonFrog", symbol: "MFROG", chain: null, contractAddress: null, evidence: "#MoonFrog", contextPostId: null },
      {
        name: "MoonFrog",
        symbol: "MFROG",
        chain: "ethereum",
        contractAddress: "0x1234567890123456789012345678901234567890",
        evidence: "0x1234567890123456789012345678901234567890",
        contextPostId: "linked-post",
      },
    ]);
  });

  it("does not use same-author context as proof of a coin mention", () => {
    const input = [{
      id: "follow-up",
      text: "it is finally moving",
      context: [{
        id: "earlier-post",
        text: "$MOON",
        publishedAt: "2026-10-07T10:00:00.000Z",
        sourceUrl: "https://x.com/author/status/earlier-post",
        verifiedSymbols: [],
        relation: "same-author" as const,
      }],
    }];
    const raw = JSON.stringify({ results: [{
      postId: "follow-up",
      sentiment: "positive",
      score: 45,
      confidence: 0.7,
      symbols: [],
      coinMentions: [{
        name: "Moon",
        symbol: "MOON",
        chain: null,
        contractAddress: null,
        evidence: "$MOON",
        contextPostId: "earlier-post",
      }],
      summary: "The post expresses positive market movement.",
    }] });

    expect(parseSentimentResponse(raw, input, assets)[0].coinMentions).toEqual([]);
  });

  it("derives verified context symbols only from explicit tickers or asset names", () => {
    expect(findExplicitAssetSymbols("$btc is up", assets)).toEqual(["BTC"]);
    expect(findExplicitAssetSymbols("Bitcoin looks stronger", assets)).toEqual(["BTC"]);
    expect(findExplicitAssetSymbols("the coin looks stronger", assets)).toEqual([]);
  });

  it("normalizes X conversation and referenced-post metadata", () => {
    const post = normalizeXTweet({
      id: "follow-up",
      text: "it is finally moving",
      created_at: "2026-10-07T11:00:00.000Z",
      conversation_id: "thread-1",
      referenced_tweets: [{ id: "earlier-post", type: "replied_to" }],
      entities: { urls: [{ expanded_url: "https://example.com/token" }] },
      attachments: { media_keys: ["media-1"] },
    }, "author", new Date("2026-10-07T12:00:00.000Z"), new Map([["media-1", { media_key: "media-1", alt_text: "MoonFrog token launch" }]]));
    expect(post).toMatchObject({
      conversationId: "thread-1",
      referencedPostIds: ["earlier-post"],
      expandedUrls: ["https://example.com/token"],
      mediaDescriptions: ["MoonFrog token launch"],
    });
  });

  it("rejects malformed scores and sentiment labels", () => {
    const raw = JSON.stringify({ results: [
      { postId: "post-1", sentiment: "buy", score: 101, confidence: 2, symbols: [], summary: "Invalid model response." },
    ] });
    expect(() => parseSentimentResponse(raw, posts, assets)).toThrow();
  });
});

describe("social sentiment aggregation", () => {
  it("selects posts by publication time within rolling windows", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(isWithinSentimentWindow(new Date("2026-10-06T12:00:00Z"), now, 168)).toBe(true);
    expect(isWithinSentimentWindow(new Date("2026-09-30T11:59:59Z"), now, 168)).toBe(false);
    expect(isWithinSentimentWindow(new Date("2026-10-07T12:00:01Z"), now, 168)).toBe(false);
  });

  it("confidence-weights scores and reports sentiment counts and direction", () => {
    expect(aggregateSentiment([
      { score: 80, confidence: 1, sentiment: "positive" },
      { score: -20, confidence: 0.5, sentiment: "negative" },
      { score: 0, confidence: 1, sentiment: "neutral" },
    ])).toEqual({
      score: 28,
      confidence: 0.83,
      counts: { positive: 1, neutral: 1, negative: 1 },
      direction: "bullish",
    });
  });

  it("requires at least two independent authors and a two-thirds directional consensus", () => {
    expect(aggregateAuthorConsensus([
      { authorId: "one", score: 90, confidence: 1, sentiment: "positive" },
      { authorId: "one", score: 90, confidence: 1, sentiment: "positive" },
    ])).toBeNull();
    expect(aggregateAuthorConsensus([
      { authorId: "one", score: 90, confidence: 1, sentiment: "positive" },
      { authorId: "two", score: 70, confidence: 0.8, sentiment: "positive" },
      { authorId: "three", score: -80, confidence: 1, sentiment: "negative" },
      { authorId: "four", score: -80, confidence: 1, sentiment: "negative" },
    ])).toBeNull();
    expect(aggregateAuthorConsensus([
      { authorId: "one", score: 90, confidence: 1, sentiment: "positive" },
      { authorId: "two", score: 70, confidence: 0.8, sentiment: "positive" },
      { authorId: "three", score: 10, confidence: 1, sentiment: "neutral" },
    ])).toMatchObject({ direction: "bullish", distinctAuthors: 3, alignedAuthors: 2, consensusRatio: 0.67 });
  });

  it("confirms direction only with a fresh, sufficiently long market-price series", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const points = [
      { sampledAt: new Date("2026-10-08T10:29:00Z"), price: 100, stale: false },
      { sampledAt: new Date("2026-10-08T11:59:00Z"), price: 101, stale: false },
    ];
    expect(confirmMarketDirection(points, now, "bullish")).toBe("confirmed");
    expect(confirmMarketDirection(points, now, "bearish")).toBe("opposed");
    expect(confirmMarketDirection(points.slice(1), now, "bullish")).toBe("unavailable");
  });

  it("caps new X collection at two hours while overlapping a recent successful fetch", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(xCollectionStartTime(now)).toBe("2026-10-08T10:00:00.000Z");
    expect(xCollectionStartTime(now, new Date("2026-10-08T11:30:00Z"))).toBe("2026-10-08T11:29:00.000Z");
    expect(xCollectionStartTime(now, new Date("2026-10-08T08:00:00Z"))).toBe("2026-10-08T10:00:00.000Z");
    expect(xCollectionStartTime(now, new Date("2026-10-08T12:10:00Z"))).toBe("2026-10-08T11:59:00.000Z");
  });

  it("does not invent a score when there are no analyses and derives stable keys", () => {
    expect(aggregateSentiment([])).toBeNull();
    expect(sentimentAnalysisKey("post-1", "asset-1")).toBe(sentimentAnalysisKey("post-1", "asset-1"));
    expect(sentimentAnalysisKey("post-1", "asset-1")).not.toBe(sentimentAnalysisKey("post-1", "asset-2"));
    expect(newsSentimentAnalysisKey("article-1")).toBe(newsSentimentAnalysisKey("article-1"));
    expect(newsSentimentAnalysisKey("article-1")).not.toBe(newsSentimentAnalysisKey("article-2"));
    expect(newsSentimentContentHash("Headline", "Summary")).toBe(newsSentimentContentHash("Headline", "Summary"));
    expect(newsSentimentContentHash("Headline", "Summary")).not.toBe(newsSentimentContentHash("Updated headline", "Summary"));
  });
});
