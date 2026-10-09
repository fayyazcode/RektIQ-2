import { describe, expect, it, vi } from "vitest";

// Mock server-only module before importing
vi.mock("server-only", () => ({}));

import { composePost, xLength, X_LIMIT } from "@/lib/social/tweet";
import { parseAligned, parseAndValidate, ruleBasedPosts } from "@/lib/ai/writer";
import { stylesFor } from "@/lib/ai/prompt";
import { unknownNumbers } from "@/lib/ai/facts";
import { daySlots, dueSlots } from "@/lib/jobs/daily-posts";
import { kindsFor } from "@/lib/ai/prompt";

describe("X length", () => {
  it("counts every URL as 23 and emoji as 2", () => {
    expect(xLength("hi https://example.com/a/very/long/path/that/is/long")).toBe(3 + 23);
    expect(xLength("🚨")).toBe(2);
  });
  it("composePost always fits, keeping the link", () => {
    const post = composePost("word ".repeat(120), "https://rektoiq.vercel.app/story/x-abc123");
    expect(xLength(post)).toBeLessThanOrEqual(X_LIMIT);
    expect(post.endsWith("https://rektoiq.vercel.app/story/x-abc123")).toBe(true);
  });
});

describe("AI output validation", () => {
  const cands = [
    { title: "SEC approves spot Solana ETFs", summary: "The SEC approved spot SOL ETFs from three issuers.", sources: ["coindesk", "the-block"], publishedAt: new Date() },
    { title: "Bitcoin ETF inflows hit $900 million", summary: "Spot bitcoin ETFs took in $900 million on Monday.", sources: ["decrypt"], publishedAt: new Date() },
    { title: "Exchange hacked for $200M", summary: "Attackers drained $200 million from hot wallets.", sources: ["the-block"], publishedAt: new Date() },
  ];
  const req = (...xs: [string, string][]) => xs.map(([kind, style]) => ({ kind, style })) as never;

  it("drops duplicates, missing stories, hype and code fences", () => {
    const raw = '```json\n{"posts":[{"kind":"breaking","style":"link","storyIndex":0,"text":"SEC approves spot SOL ETFs, first for an altcoin."},{"kind":"market","style":"link","storyIndex":0,"text":"Duplicate story should be dropped"},{"kind":"market","style":"link","storyIndex":9,"text":"Out of range index here"},{"kind":"insight","style":"link","storyIndex":1,"text":"ETFs guaranteed to pump, 100x soon"}]}\n```';
    const posts = parseAndValidate(raw, cands, req(["breaking", "link"], ["market", "link"], ["insight", "link"]));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ kind: "breaking", storyIndex: 0 });
  });

  it("rejects posts with numbers that aren't in the source material", () => {
    const ok = '{"posts":[{"kind":"market","style":"detailed","storyIndex":1,"text":"Spot bitcoin ETFs pulled in $900M on Monday, per Decrypt."}]}';
    const invented = '{"posts":[{"kind":"market","style":"detailed","storyIndex":1,"text":"Spot bitcoin ETFs pulled in $1.2B on Monday, per Decrypt."}]}';
    expect(parseAndValidate(ok, cands, req(["market", "detailed"]))).toHaveLength(1);
    expect(parseAndValidate(invented, cands, req(["market", "detailed"]))).toHaveLength(0);
  });

  it("never lets a joke run on a serious story", () => {
    const raw = '{"posts":[{"kind":"insight","style":"humor","storyIndex":2,"text":"Hot wallet got a little too hot 🔥 $200M gone"},{"kind":"insight","style":"humor","storyIndex":1,"text":"ETFs ate $900 million on Monday. Breakfast of champions 🥣"}]}';
    const posts = parseAndValidate(raw, cands, req(["insight", "humor"]));
    expect(posts).toHaveLength(1);
    expect(posts[0].storyIndex).toBe(1);
  });

  it("keeps link posts short and lets detailed posts use the full length", () => {
    const long = "Spot bitcoin ETFs took in $900 million on Monday. ".repeat(8);
    const raw = (style: string) => `{"posts":[{"kind":"market","style":"${style}","storyIndex":1,"text":"${long}"}]}`;
    expect(xLength(parseAndValidate(raw("link"), cands, req(["market", "link"]))[0].text)).toBeLessThanOrEqual(230);
    const detailed = parseAndValidate(raw("detailed"), cands, req(["market", "detailed"]))[0].text;
    expect(xLength(detailed)).toBeLessThanOrEqual(275);
    expect(detailed.endsWith(".")).toBe(true); // cut at a sentence end, not mid-word
  });

  it("keeps each post lined up with its slot when one in the middle fails", () => {
    const raw = '{"posts":[{"kind":"breaking","style":"link","storyIndex":0,"text":"SEC approves spot Solana ETFs."},{"kind":"market","style":"detailed","storyIndex":1,"text":"ETFs pulled in $5B, per Decrypt."},{"kind":"insight","style":"link","storyIndex":2,"text":"Exchange loses $200M in hack."}]}';
    const aligned = parseAligned(raw, cands, req(["breaking", "link"], ["market", "detailed"], ["insight", "link"]));
    expect(aligned.map((p) => p?.storyIndex ?? null)).toEqual([0, null, 2]);
  });

  it("rule-based fallback picks different stories and turns humor into detailed", () => {
    const p = ruleBasedPosts(cands, req(["breaking", "link"], ["market", "humor"], ["insight", "detailed"]));
    expect(new Set(p.map((x) => x.storyIndex)).size).toBe(3);
    expect(p[1]).toMatchObject({ storyIndex: 1, style: "detailed" });
    expect(p[1].text).toMatch(/via Decrypt/);
  });
});

describe("post style mix", () => {
  it("spreads styles across the day in proportion, interleaved", () => {
    const s = stylesFor(10, { link: 50, detailed: 30, humor: 20 });
    expect(s.filter((x) => x === "link")).toHaveLength(5);
    expect(s.filter((x) => x === "detailed")).toHaveLength(3);
    expect(s.filter((x) => x === "humor")).toHaveLength(2);
    expect(s.join(",")).not.toMatch(/humor,humor/);
    expect(stylesFor(3, { link: 0, detailed: 100, humor: 0 })).toEqual(["detailed", "detailed", "detailed"]);
  });
});

describe("fact check", () => {
  it("treats different spellings of a number as the same", () => {
    expect(unknownNumbers("inflows of $900M and 12%", ["took in $900 million", "up 12%"])).toEqual([]);
    expect(unknownNumbers("up 15% to $120K", ["up 12% to $118,000"])).toEqual(["15%", "120k"]);
    expect(unknownNumbers("3 newsrooms in 2 hours", [])).toEqual([]);
  });
});

describe("daily slots", () => {
  const day = new Date("2026-09-24T09:00:00Z");
  const hhmm = (ds: Date[]) => ds.map((d) => d.toISOString().slice(11, 16));

  it("uses exact times when there are enough of them", () => {
    expect(hhmm(daySlots({ postsPerDay: 2, postTimesUtc: ["21:00", "13:00", "17:00"], postWindowStartUtc: "08:00", postWindowEndUtc: "22:00" }, day))).toEqual(["13:00", "17:00"]);
  });

  it("spreads any number of posts evenly across the window", () => {
    expect(hhmm(daySlots({ postsPerDay: 7, postTimesUtc: [], postWindowStartUtc: "08:00", postWindowEndUtc: "22:00" }, day))).toEqual(["09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"]);
    expect(daySlots({ postsPerDay: 24, postTimesUtc: [], postWindowStartUtc: "00:00", postWindowEndUtc: "23:59" }, day)).toHaveLength(24);
  });

  it("each run fills only slots coming up soon, plus recently missed ones", () => {
    const slots = daySlots({ postsPerDay: 7, postTimesUtc: [], postWindowStartUtc: "08:00", postWindowEndUtc: "22:00" }, day);
    const now = new Date("2026-09-24T10:30:00Z");
    // 09:00 missed by 90 min → skipped; 11:00 and 13:00 are within 2.5 h; 11:00 already done
    expect(hhmm(dueSlots(slots, new Set(), now))).toEqual(["11:00", "13:00"]);
    expect(hhmm(dueSlots(slots, new Set([slots[1].toISOString()]), now))).toEqual(["13:00"]);
    expect(hhmm(dueSlots(slots, new Set(), new Date("2026-09-24T09:40:00Z")))).toEqual(["09:00", "11:00"]);
  });

  it("force fills every remaining slot, or one right now when the day is done", () => {
    const slots = daySlots({ postsPerDay: 3, postTimesUtc: ["13:00", "17:00", "21:00"], postWindowStartUtc: "08:00", postWindowEndUtc: "22:00" }, day);
    expect(hhmm(dueSlots(slots, new Set(), new Date("2026-09-24T12:00:00Z"), true))).toEqual(["13:00", "17:00", "21:00"]);
    expect(dueSlots(slots, new Set(slots.map((d) => d.toISOString())), new Date("2026-09-24T22:30:00Z"), true)).toHaveLength(1);
  });

  it("post types cycle so a busy day gets a mix", () => {
    expect(kindsFor(5)).toEqual(["breaking", "market", "insight", "breaking", "market"]);
  });
});

import { mapBufferStatus } from "@/lib/jobs/sync-posts";
describe("Buffer status mapping", () => {
  it("maps Buffer states onto ours and ignores drafts", () => {
    expect(mapBufferStatus("sent")).toBe("sent");
    expect(mapBufferStatus("scheduled")).toBe("scheduled");
    expect(mapBufferStatus("error")).toBe("failed");
    expect(mapBufferStatus("draft")).toBeNull();
  });
});
