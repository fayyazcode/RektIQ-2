import { cache } from "react";
import { FEEDS } from "../config";
import { hasDatabase } from "../db";
import { getSettings } from "../settings";
import type { FeedSource } from "../types";

/** The first admin edit persists a copy of the built-in feed list in settings. */
export const getFeedSources = cache(async (): Promise<FeedSource[]> => {
  if (!hasDatabase()) return FEEDS;
  try {
    const settings = await getSettings();
    return Array.isArray(settings.feedSources) ? settings.feedSources : FEEDS;
  } catch {
    return FEEDS;
  }
});

/** Active plus retired metadata, for attribution on stories collected in the past. */
export const getFeedSourceCatalog = cache(async (): Promise<FeedSource[]> => {
  if (!hasDatabase()) return FEEDS;
  try {
    const settings = await getSettings();
    const active = Array.isArray(settings.feedSources) ? settings.feedSources : FEEDS;
    const retired = settings.retiredFeedSources ?? [];
    return [...active, ...retired.filter((old) => !active.some((feed) => feed.id === old.id))];
  } catch {
    return FEEDS;
  }
});

export const getFeedSourceById = cache(async (id: string): Promise<FeedSource | undefined> =>
  (await getFeedSourceCatalog()).find((feed) => feed.id === id)
);
