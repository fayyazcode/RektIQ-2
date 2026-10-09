import { config, env, hasSecret, requireSecret } from "../env";
/**
 * Buffer GraphQL API (https://developers.buffer.com). The free plan includes
 * API access (1 key, rate-limited), which is plenty for 3 posts a day.
 */
const ENDPOINT = "https://api.buffer.com";

/** Only the API key is required: the X channel is found automatically when BUFFER_CHANNEL_ID is unset or wrong. */
export const bufferConfigured = () => hasSecret("BUFFER_API_KEY");
export const bufferDryRun = () => env.bufferDryRunForced() || !bufferConfigured();

type GqlResponse<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const key = requireSecret("BUFFER_API_KEY");
  let last: Error = new Error("Buffer request failed");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000),
    }).catch((e: Error) => e);
    if (res instanceof Error) {
      last = res;
    } else if (res.status === 429 || res.status >= 500) {
      last = new Error(`Buffer HTTP ${res.status}`);
    } else {
      const json = (await res.json().catch(() => ({}))) as GqlResponse<T>;
      if (!res.ok) throw new Error(`Buffer HTTP ${res.status}: ${json.errors?.[0]?.message ?? ""}`.trim());
      if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
      if (!json.data) throw new Error("Buffer returned no data");
      return json.data;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw last;
}

/* ── Which channel to post to ─────────────────────────────────────────── */

export type BufferChannel = { id: string; name: string | null; displayName: string | null; service: string; organizationId: string };

const isXChannel = (c: BufferChannel) => /^(twitter|x)$/i.test(c.service);
const describe = (c: BufferChannel) => `${c.displayName || c.name || "unnamed"} (${c.service}) → ${c.id}`;

async function listOrganizations(): Promise<{ id: string; name: string | null }[]> {
  const data = await gql<{ account: { organizations: { id: string; name: string | null }[] } }>(`query { account { organizations { id name } } }`);
  return data.account?.organizations ?? [];
}

export async function getOrganizationId(): Promise<string> {
  const id = (await listOrganizations())[0]?.id;
  if (!id) throw new Error("Buffer returned no organization for this API key");
  return id;
}

async function listChannels(organizationId: string): Promise<BufferChannel[]> {
  const data = await gql<{ channels: { id: string; name: string | null; displayName: string | null; service: string }[] }>(
    `query { channels(input: { organizationId: ${JSON.stringify(organizationId)} }) { id name displayName service } }`
  );
  return (data.channels ?? []).map((c) => ({ ...c, organizationId }));
}

export type ChannelResolution = { channelId: string; organizationId: string; channel: BufferChannel | null; note: string | null; channels: BufferChannel[] };

/**
 * Works out which Buffer channel to post to, and remembers the answer in PostgreSQL so
 * it costs no API requests afterwards:
 *   1. BUFFER_CHANNEL_ID matches a channel id on this account → use it
 *   2. it matches a channel's name or @handle instead → use that channel's id
 *   3. it's empty or matches nothing, and the account has exactly one X channel → use that
 *   4. otherwise → fail, listing the channels that do exist
 */
export async function resolveChannel(opts: { force?: boolean } = {}): Promise<ChannelResolution> {
  const { getSettings, saveSettings } = await import("../settings");
  const configured = config("BUFFER_CHANNEL_ID") ?? "";
  const settings = await getSettings();
  if (!opts.force && settings.bufferChannelId && settings.bufferOrganizationId && (settings.bufferChannelFor ?? "") === configured) {
    return { channelId: settings.bufferChannelId, organizationId: settings.bufferOrganizationId, channel: null, note: null, channels: [] };
  }

  const orgs = await listOrganizations();
  if (!orgs.length) throw new Error("This Buffer API key has no organization. Check BUFFER_API_KEY.");
  const preferredOrg = config("BUFFER_ORG_ID");
  orgs.sort((a, b) => Number(b.id === preferredOrg) - Number(a.id === preferredOrg));
  const channels = (await Promise.all(orgs.map((o) => listChannels(o.id)))).flat();
  if (!channels.length) throw new Error("This Buffer account has no connected channels. Connect your X account in Buffer first.");

  const wanted = configured.toLowerCase().replace(/^@/, "");
  let channel: BufferChannel | undefined;
  let note: string | null = null;
  if (configured) {
    channel = channels.find((c) => c.id === configured);
    if (!channel) {
      channel = channels.find((c) => [c.name, c.displayName].some((n) => n && n.toLowerCase().replace(/^@/, "") === wanted));
      if (channel) note = `BUFFER_CHANNEL_ID holds the channel's name ("${configured}"); using its id ${channel.id}. Put that id in BUFFER_CHANNEL_ID to skip this lookup.`;
    }
  }
  if (!channel) {
    const xs = channels.filter(isXChannel);
    if (xs.length === 1) {
      channel = xs[0];
      note = configured
        ? `BUFFER_CHANNEL_ID ("${configured}") isn't a channel on this Buffer account, so the account's only X channel is used: ${describe(channel)}. Set BUFFER_CHANNEL_ID to ${channel.id}.`
        : `BUFFER_CHANNEL_ID is empty, so the account's only X channel is used: ${describe(channel)}.`;
    }
  }
  if (!channel) {
    throw new Error(
      `BUFFER_CHANNEL_ID ${configured ? `("${configured}") doesn't match any channel` : "is empty and there isn't exactly one X channel"} on this Buffer account. ` +
        `Channels found: ${channels.map(describe).join("; ")}. Copy the id of your X channel into BUFFER_CHANNEL_ID.`
    );
  }

  await saveSettings({ bufferOrganizationId: channel.organizationId, bufferChannelId: channel.id, bufferChannelFor: configured });
  return { channelId: channel.id, organizationId: channel.organizationId, channel, note, channels };
}

/** "now" publishes straight away (Buffer's shareNow); a Date schedules it for that time. */
export type PostWhen = Date | "now";

async function createPost(channelId: string, text: string, when: PostWhen) {
  // Literals are inlined via JSON.stringify (valid GraphQL string escaping).
  const timing = when === "now" ? "mode: shareNow" : `mode: customScheduled,\n      dueAt: ${JSON.stringify(when.toISOString())}`;
  const data = await gql<{ createPost: { post?: { id: string }; message?: string } }>(`mutation {
    createPost(input: {
      text: ${JSON.stringify(text)},
      channelId: ${JSON.stringify(channelId)},
      schedulingType: automatic,
      ${timing}
    }) {
      ... on PostActionSuccess { post { id } }
      ... on MutationError { message }
    }
  }`);
  if (data.createPost?.message) throw new Error(`Buffer: ${data.createPost.message}`);
  if (!data.createPost?.post?.id) throw new Error("Buffer returned no post id");
  return { id: data.createPost.post.id };
}

export async function schedulePost(text: string, when: PostWhen): Promise<{ id: string }> {
  // Never publish a link nobody can open.
  if (/https?:\/\/(localhost|127\.0\.0\.1)/i.test(text)) {
    throw new Error("The post links to localhost. Set SITE_URL (GitHub variable) / NEXT_PUBLIC_SITE_URL (Vercel) to your live site address.");
  }
  const { channelId } = await resolveChannel();
  try {
    return await createPost(channelId, text, when);
  } catch (err) {
    // A remembered channel can go stale (reconnected in Buffer, key changed): look it up again once.
    if (!/channel/i.test(err instanceof Error ? err.message : String(err))) throw err;
    const fresh = await resolveChannel({ force: true });
    if (fresh.channelId === channelId) throw err;
    return createPost(fresh.channelId, text, when);
  }
}

/* ── Reading posts back from Buffer (for the sync job) ───────────────── */

export type BufferPost = {
  id: string;
  text: string;
  status: string;
  dueAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
  externalLink: string | null;
  channelId: string;
};

/**
 * One page of the channel's scheduled, sent and failed posts, newest first.
 * The free plan allows about 100 API requests a day, so callers fetch one page per run.
 */
export async function listChannelPosts(organizationId: string, channelId: string, opts: { first?: number; after?: string | null } = {}) {
  const after = opts.after ? `after: ${JSON.stringify(opts.after)}` : "";
  const data = await gql<{ posts: { edges: { node: BufferPost }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(`query {
    posts(
      first: ${Math.min(100, opts.first ?? 50)}
      ${after}
      input: {
        organizationId: ${JSON.stringify(organizationId)}
        filter: { status: [scheduled, sent, error], channelIds: [${JSON.stringify(channelId)}] }
        sort: [{ field: createdAt, direction: desc }]
      }
    ) {
      edges { node { id text status dueAt sentAt createdAt externalLink channelId } }
      pageInfo { hasNextPage endCursor }
    }
  }`);
  return { posts: data.posts.edges.map((e) => e.node), hasNextPage: data.posts.pageInfo.hasNextPage, endCursor: data.posts.pageInfo.endCursor };
}
