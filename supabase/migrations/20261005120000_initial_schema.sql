-- RektoIQ Supabase foundation. Apply only after reviewing the migration.
-- The migration is local source; it does not embed or apply hosted credentials.
-- Runtime access is server-only through a pooled PostgreSQL connection.

CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM anon, authenticated;

CREATE TABLE app.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_mongo_id text,
  kind text NOT NULL, trigger text NOT NULL, started_at timestamptz NOT NULL,
  completed_at timestamptz, status text NOT NULL, stats jsonb,
  delta_vs_previous jsonb, feeds jsonb, posts_created integer, removed jsonb,
  counts jsonb, message text, error text
);
CREATE UNIQUE INDEX automation_runs_legacy_mongo_id_uq ON app.automation_runs (legacy_mongo_id);
CREATE INDEX automation_runs_kind_started_idx ON app.automation_runs (kind, started_at DESC);
CREATE INDEX automation_runs_started_idx ON app.automation_runs (started_at DESC);

CREATE TABLE app.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_mongo_id text,
  source text NOT NULL, guid text NOT NULL, url text NOT NULL, canonical_url text NOT NULL,
  url_hash text NOT NULL, title text NOT NULL, title_key text NOT NULL,
  title_hash text NOT NULL, summary text NOT NULL DEFAULT '', content_hash text NOT NULL,
  author text, published_at timestamptz NOT NULL, categories text[] NOT NULL DEFAULT '{}',
  coins text[] NOT NULL DEFAULT '{}', raw_categories text[] NOT NULL DEFAULT '{}', image text,
  fetched_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, first_run_id uuid REFERENCES app.automation_runs(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX articles_legacy_mongo_id_uq ON app.articles (legacy_mongo_id);
CREATE UNIQUE INDEX articles_url_hash_uq ON app.articles (url_hash);
CREATE INDEX articles_source_guid_idx ON app.articles (source, guid);
CREATE INDEX articles_published_at_idx ON app.articles (published_at DESC);
CREATE INDEX articles_source_published_idx ON app.articles (source, published_at DESC);
CREATE INDEX articles_fetched_at_idx ON app.articles (fetched_at DESC);
CREATE INDEX articles_title_hash_idx ON app.articles (title_hash);

CREATE TABLE app.stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_mongo_id text,
  slug text NOT NULL, title text NOT NULL, summary text NOT NULL DEFAULT '',
  primary_article_id uuid NOT NULL REFERENCES app.articles(id) ON DELETE RESTRICT,
  sources text[] NOT NULL DEFAULT '{}', categories text[] NOT NULL DEFAULT '{}',
  coins text[] NOT NULL DEFAULT '{}', title_tokens text[] NOT NULL DEFAULT '{}',
  tokens text[] NOT NULL DEFAULT '{}', first_published_at timestamptz NOT NULL,
  last_published_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), score real NOT NULL DEFAULT 0, ai_summary jsonb
);
CREATE UNIQUE INDEX stories_legacy_mongo_id_uq ON app.stories (legacy_mongo_id);
CREATE UNIQUE INDEX stories_slug_uq ON app.stories (slug);
CREATE INDEX stories_recent_idx ON app.stories (last_published_at DESC);
CREATE INDEX stories_created_at_idx ON app.stories (created_at DESC);
CREATE INDEX stories_score_idx ON app.stories (score DESC, last_published_at DESC);
CREATE INDEX stories_category_recent_idx ON app.stories USING gin (categories);
CREATE INDEX stories_coins_idx ON app.stories USING gin (coins);
CREATE TABLE app.story_articles (
  story_id uuid NOT NULL REFERENCES app.stories(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES app.articles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (story_id, article_id)
);
CREATE INDEX story_articles_article_idx ON app.story_articles (article_id);

CREATE TABLE app.feed_state (
  source_id text PRIMARY KEY, etag text, last_modified text, last_success_at timestamptz,
  last_error_at timestamptz, last_error text, consecutive_failures integer NOT NULL DEFAULT 0,
  last_item_count integer NOT NULL DEFAULT 0
);
CREATE TABLE app.global_settings (
  key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app.global_settings (key, value) VALUES ('global', '{}'::jsonb) ON CONFLICT (key) DO NOTHING;

CREATE TABLE app.outbound_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_mongo_id text,
  story_id uuid REFERENCES app.stories(id) ON DELETE SET NULL, content text NOT NULL,
  kind text NOT NULL, platform text NOT NULL DEFAULT 'x', status text NOT NULL,
  buffer_post_id text, scheduled_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), error text, written_by text NOT NULL,
  run_id uuid REFERENCES app.automation_runs(id) ON DELETE SET NULL, sent_at timestamptz,
  external_url text, last_synced_at timestamptz, origin text, reason text, slot_key text, style text
);
COMMENT ON TABLE app.outbound_posts IS 'Existing MongoDB social_posts collection for outbound Buffer publishing; monitored inbound X posts are stored separately in app.social_posts.';
CREATE UNIQUE INDEX outbound_posts_legacy_mongo_id_uq ON app.outbound_posts (legacy_mongo_id);
CREATE UNIQUE INDEX outbound_posts_buffer_id_uq ON app.outbound_posts (buffer_post_id) WHERE buffer_post_id IS NOT NULL;
CREATE UNIQUE INDEX outbound_posts_slot_uq ON app.outbound_posts (slot_key) WHERE slot_key IS NOT NULL;
CREATE INDEX outbound_posts_schedule_idx ON app.outbound_posts (scheduled_at DESC);
CREATE INDEX outbound_posts_status_idx ON app.outbound_posts (status, scheduled_at DESC);

CREATE TABLE app.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ip inet NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_at_idx ON app.login_attempts (attempted_at);
CREATE INDEX login_attempts_ip_idx ON app.login_attempts (ip);

CREATE TABLE app.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_key text,
  symbol text NOT NULL, name text NOT NULL, chain text, contract_address text,
  provider_asset_id text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  latest_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, baseline_volume real,
  score real NOT NULL DEFAULT 0, score_components jsonb NOT NULL DEFAULT '{}'::jsonb,
  formula_version text NOT NULL DEFAULT 'legacy', scored_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_chain_contract_pair_ck CHECK ((chain IS NULL) = (contract_address IS NULL))
);
CREATE UNIQUE INDEX assets_legacy_key_uq ON app.assets (legacy_key);
CREATE UNIQUE INDEX assets_chain_contract_uq ON app.assets (lower(chain), lower(contract_address)) WHERE chain IS NOT NULL AND contract_address IS NOT NULL;
CREATE UNIQUE INDEX assets_identity_ref_uq ON app.assets (id, chain, contract_address);
CREATE UNIQUE INDEX assets_provider_id_uq ON app.assets (provider_asset_id) WHERE provider_asset_id IS NOT NULL;
CREATE INDEX assets_symbol_idx ON app.assets (symbol);
CREATE INDEX assets_updated_idx ON app.assets (updated_at DESC);
CREATE INDEX assets_score_idx ON app.assets (score DESC, updated_at DESC);

CREATE TABLE app.market_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), symbol text NOT NULL,
  sampled_at timestamptz NOT NULL, ingested_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL, batch_stale boolean NOT NULL DEFAULT false
);
CREATE INDEX market_snapshots_symbol_time_idx ON app.market_snapshots (symbol, sampled_at DESC);
CREATE INDEX market_snapshots_ingested_idx ON app.market_snapshots (ingested_at DESC);

CREATE TABLE app.market_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_mongo_id text,
  dedupe_key text NOT NULL, symbol text NOT NULL, type text NOT NULL,
  score real NOT NULL, evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  formula_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX market_signals_legacy_mongo_id_uq ON app.market_signals (legacy_mongo_id);
CREATE UNIQUE INDEX market_signals_dedupe_uq ON app.market_signals (dedupe_key);
CREATE INDEX market_signals_symbol_time_idx ON app.market_signals (symbol, occurred_at DESC);
CREATE INDEX market_signals_type_time_idx ON app.market_signals (type, occurred_at DESC);
CREATE TABLE app.market_signal_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES app.market_signals(id) ON DELETE CASCADE,
  kind text NOT NULL, label text NOT NULL, value jsonb, source text,
  observed_at timestamptz, details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX market_signal_evidence_signal_idx ON app.market_signal_evidence (signal_id);
CREATE TABLE app.market_signal_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES app.market_signals(id) ON DELETE CASCADE,
  horizon_minutes integer NOT NULL CHECK (horizon_minutes IN (60,240)),
  status text NOT NULL CHECK (status IN ('pending','success','failed','mixed','not_evaluated')),
  tier text NOT NULL CHECK (tier IN ('large_liquid','other')),
  tier_minimum_pct real NOT NULL, volatility_range_pct real,
  volatility_adjustment_pct real NOT NULL DEFAULT 0, target_pct real NOT NULL,
  entry_price real, end_price real, return_pct real, max_favorable_move_pct real,
  max_adverse_move_pct real, rolling_volume_change_pct real, btc_return_pct real,
  sample_count integer NOT NULL DEFAULT 0, coverage_minutes integer NOT NULL DEFAULT 0,
  reason text, evaluated_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX market_signal_outcomes_signal_horizon_uq ON app.market_signal_outcomes (signal_id, horizon_minutes);
CREATE INDEX market_signal_outcomes_horizon_status_idx ON app.market_signal_outcomes (horizon_minutes, status);

CREATE TABLE app.anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_mongo_id text,
  dedupe_key text NOT NULL, symbol text NOT NULL, type text NOT NULL,
  severity text NOT NULL, observed real NOT NULL, baseline real NOT NULL, ratio real NOT NULL,
  description text NOT NULL, occurred_at timestamptz NOT NULL,
  baseline_window_hours real NOT NULL, formula_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX anomalies_legacy_mongo_id_uq ON app.anomalies (legacy_mongo_id);
CREATE UNIQUE INDEX anomalies_dedupe_uq ON app.anomalies (dedupe_key);
CREATE INDEX anomalies_symbol_time_idx ON app.anomalies (symbol, occurred_at DESC);
CREATE INDEX anomalies_type_time_idx ON app.anomalies (type, occurred_at DESC);

CREATE TABLE app.news_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES app.articles(id) ON DELETE CASCADE,
  story_id uuid REFERENCES app.stories(id) ON DELETE SET NULL, symbol text NOT NULL,
  title text NOT NULL, url text NOT NULL, source text NOT NULL,
  published_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX news_entities_article_symbol_uq ON app.news_entities (article_id, symbol);
CREATE INDEX news_entities_symbol_published_idx ON app.news_entities (symbol, published_at DESC);
CREATE TABLE app.news_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES app.articles(id) ON DELETE CASCADE,
  symbol text NOT NULL, headline text NOT NULL, source text NOT NULL, url text NOT NULL,
  published_at timestamptz NOT NULL, window_minutes integer NOT NULL,
  price_before real NOT NULL, price_after real NOT NULL, price_change_pct real NOT NULL,
  volume_before real NOT NULL, volume_after real NOT NULL, volume_reaction_ratio real,
  computed_at timestamptz NOT NULL, formula_version text NOT NULL
);
CREATE UNIQUE INDEX news_impacts_article_symbol_uq ON app.news_impacts (article_id, symbol);
CREATE INDEX news_impacts_symbol_published_idx ON app.news_impacts (symbol, published_at DESC);
CREATE TABLE app.ai_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, ref_type text NOT NULL,
  ref_id text NOT NULL, symbol text NOT NULL, input_hash text NOT NULL,
  result jsonb NOT NULL, provider text NOT NULL, model text NOT NULL,
  prompt_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_analyses_input_hash_uq ON app.ai_analyses (input_hash);
CREATE INDEX ai_analyses_ref_idx ON app.ai_analyses (ref_type, ref_id);
CREATE TABLE app.provider_health (
  provider_id text PRIMARY KEY, requests integer NOT NULL DEFAULT 0, errors integer NOT NULL DEFAULT 0,
  rate_limits integer NOT NULL DEFAULT 0, last_success_at timestamptz, last_failure_at timestamptz,
  last_error text, avg_latency_ms real NOT NULL DEFAULT 0, stale boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Membership rows mirror Auth identity only. Privileged app routes must still
-- check approval_status on each request; no client-facing table grants exist.
CREATE TABLE app.member_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected','revoked')),
  role text NOT NULL DEFAULT 'member' CHECK (role = 'member'),
  requested_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  decided_by text, decision_note text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_profiles_approval_idx ON app.member_profiles (approval_status, requested_at);

CREATE TABLE app.tracked_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), handle text NOT NULL,
  normalized_handle text NOT NULL, display_name text, platform_account_id text,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tracked_accounts_handle_uq ON app.tracked_accounts (normalized_handle);
CREATE UNIQUE INDEX tracked_accounts_platform_id_uq ON app.tracked_accounts (platform_account_id);
CREATE INDEX tracked_accounts_active_idx ON app.tracked_accounts (active);
CREATE TABLE app.tracked_account_groups (
  account_id uuid NOT NULL REFERENCES app.tracked_accounts(id) ON DELETE CASCADE,
  group_key text NOT NULL CHECK (group_key IN ('majors','onchain','momentum')),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (account_id, group_key)
);
CREATE INDEX tracked_account_groups_group_idx ON app.tracked_account_groups (group_key, account_id);

CREATE TABLE app.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL DEFAULT 'x',
  platform_post_id text NOT NULL, account_id uuid NOT NULL REFERENCES app.tracked_accounts(id) ON DELETE RESTRICT,
  author_handle text NOT NULL, source_url text NOT NULL, published_at timestamptz NOT NULL,
  raw_text text, raw_text_expires_at timestamptz NOT NULL, language text,
  post_metadata jsonb NOT NULL DEFAULT '{}'::jsonb, first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_posts_raw_text_retention_ck CHECK
    (raw_text IS NULL OR raw_text_expires_at <= published_at + interval '20 days')
);
CREATE UNIQUE INDEX social_posts_platform_id_uq ON app.social_posts (platform, platform_post_id);
COMMENT ON TABLE app.social_posts IS 'Monitored inbound X posts, deduplicated by platform ID. This is distinct from app.outbound_posts, which stores outbound Buffer posts.';
CREATE INDEX social_posts_account_published_idx ON app.social_posts (account_id, published_at DESC);
CREATE INDEX social_posts_raw_expiry_idx ON app.social_posts (raw_text_expires_at) WHERE raw_text IS NOT NULL;
COMMENT ON COLUMN app.social_posts.raw_text IS 'Purged by bounded retention job at raw_text_expires_at (20 days after post publication).';

CREATE TABLE app.social_asset_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES app.social_posts(id) ON DELETE CASCADE,
  asset_id uuid,
  model_kind text NOT NULL CHECK (model_kind IN ('majors','onchain')),
  referenced_symbol text, chain text, contract_address text,
  confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  attribution_status text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_mentions_identity_pair_ck CHECK ((chain IS NULL) = (contract_address IS NULL)),
  CONSTRAINT social_mentions_onchain_identity_ck CHECK (model_kind <> 'onchain' OR asset_id IS NULL OR (chain IS NOT NULL AND contract_address IS NOT NULL)),
  CONSTRAINT social_mentions_asset_identity_fk FOREIGN KEY (asset_id, chain, contract_address)
    REFERENCES app.assets(id, chain, contract_address) ON DELETE SET NULL
);
CREATE UNIQUE INDEX social_mentions_post_asset_uq ON app.social_asset_mentions (post_id, asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX social_mentions_asset_idx ON app.social_asset_mentions (asset_id, created_at DESC);
CREATE INDEX social_mentions_unresolved_idx ON app.social_asset_mentions (attribution_status, created_at DESC);
CREATE TABLE app.social_engagement_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES app.social_posts(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL, likes integer NOT NULL DEFAULT 0, reposts integer NOT NULL DEFAULT 0,
  replies integer NOT NULL DEFAULT 0, quotes integer NOT NULL DEFAULT 0, bookmarks integer NOT NULL DEFAULT 0,
  impressions integer, unique_engaged_accounts integer, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX social_engagement_post_time_uq ON app.social_engagement_observations (post_id, observed_at);
CREATE INDEX social_engagement_time_idx ON app.social_engagement_observations (observed_at DESC);

CREATE TABLE app.social_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_kind text NOT NULL CHECK (model_kind IN ('majors','onchain')),
  asset_id uuid REFERENCES app.assets(id) ON DELETE SET NULL, analysis_key text NOT NULL,
  schema_version text NOT NULL,
  model_version text NOT NULL, prompt_version text NOT NULL, provider text NOT NULL, model text NOT NULL,
  sentiment text NOT NULL, confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  score real NOT NULL, components jsonb NOT NULL, summary text NOT NULL,
  caveats text[] NOT NULL DEFAULT '{}', analyzed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX social_analyses_key_uq ON app.social_analyses (analysis_key);
CREATE INDEX social_analyses_asset_time_idx ON app.social_analyses (asset_id, analyzed_at DESC);
CREATE INDEX social_analyses_model_time_idx ON app.social_analyses (model_kind, analyzed_at DESC);
CREATE TABLE app.social_analysis_evidence (
  analysis_id uuid NOT NULL REFERENCES app.social_analyses(id) ON DELETE CASCADE,
  post_id uuid REFERENCES app.social_posts(id) ON DELETE SET NULL,
  platform_post_id text NOT NULL, author_handle text NOT NULL, source_url text NOT NULL,
  published_at timestamptz NOT NULL, evidence_summary text NOT NULL,
  evidence_data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (analysis_id, platform_post_id)
);
CREATE INDEX social_analysis_evidence_post_idx ON app.social_analysis_evidence (post_id);
CREATE TABLE app.social_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dedupe_key text NOT NULL,
  model_kind text NOT NULL CHECK (model_kind IN ('majors','onchain')),
  model_version text NOT NULL, schema_version text NOT NULL, prompt_version text NOT NULL,
  formula_version text NOT NULL, provider text NOT NULL, model text NOT NULL,
  asset_id uuid NOT NULL,
  asset_chain text, asset_contract_address text,
  direction text NOT NULL CHECK (direction IN ('bullish','bearish','neutral')),
  label text NOT NULL, score real NOT NULL, confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  dimensions jsonb NOT NULL, explanation text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','withdrawn')),
  occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_signals_identity_pair_ck CHECK ((asset_chain IS NULL) = (asset_contract_address IS NULL)),
  CONSTRAINT social_signals_onchain_identity_ck CHECK (model_kind <> 'onchain' OR (asset_chain IS NOT NULL AND asset_contract_address IS NOT NULL)),
  CONSTRAINT social_signals_asset_identity_fk FOREIGN KEY (asset_id, asset_chain, asset_contract_address)
    REFERENCES app.assets(id, chain, contract_address) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX social_signals_dedupe_uq ON app.social_signals (dedupe_key);
CREATE INDEX social_signals_asset_time_idx ON app.social_signals (asset_id, occurred_at DESC);
CREATE INDEX social_signals_model_time_idx ON app.social_signals (model_kind, occurred_at DESC);
CREATE TABLE app.social_analysis_signals (
  analysis_id uuid NOT NULL REFERENCES app.social_analyses(id) ON DELETE CASCADE,
  signal_id uuid NOT NULL REFERENCES app.social_signals(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (analysis_id, signal_id)
);
CREATE INDEX social_analysis_signals_signal_idx ON app.social_analysis_signals (signal_id);
CREATE TABLE app.social_signal_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES app.social_signals(id) ON DELETE CASCADE,
  post_id uuid REFERENCES app.social_posts(id) ON DELETE SET NULL,
  platform_post_id text NOT NULL, author_handle text NOT NULL, source_url text NOT NULL,
  published_at timestamptz NOT NULL, evidence_summary text NOT NULL,
  evidence_data jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX social_signal_evidence_signal_post_uq ON app.social_signal_evidence (signal_id, platform_post_id);
CREATE INDEX social_signal_evidence_signal_idx ON app.social_signal_evidence (signal_id);
CREATE TABLE app.social_signal_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES app.social_signals(id) ON DELETE CASCADE,
  horizon_hours integer NOT NULL CHECK (horizon_hours IN (4,24,168)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','mixed','not_evaluated')),
  entry_price real, end_price real, return_pct real, max_favorable_move_pct real,
  max_adverse_move_pct real, sample_count integer NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  coverage_minutes integer NOT NULL DEFAULT 0 CHECK (coverage_minutes >= 0), context jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text, evaluated_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX social_signal_outcomes_horizon_uq ON app.social_signal_outcomes (signal_id, horizon_hours);
CREATE INDEX social_signal_outcomes_horizon_status_idx ON app.social_signal_outcomes (horizon_hours, status);

CREATE TABLE app.tracked_account_cursors (
  account_id uuid PRIMARY KEY REFERENCES app.tracked_accounts(id) ON DELETE CASCADE,
  since_id text, next_token text, last_collected_at timestamptz, last_successful_at timestamptz,
  last_error text, consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.worker_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_key text NOT NULL, status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  lease_expires_at timestamptz, batch_cursor text, counts jsonb NOT NULL DEFAULT '{}'::jsonb, error text
);
CREATE INDEX worker_job_runs_key_started_idx ON app.worker_job_runs (job_key, started_at DESC);
CREATE INDEX worker_job_runs_active_lease_idx ON app.worker_job_runs (job_key, lease_expires_at);

-- Least privilege: all data access goes through trusted server routes/workers.
-- Tables remain RLS-enabled; browser roles receive neither schema usage nor DML.
DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'app'
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE app.%I FROM PUBLIC, anon, authenticated', table_name);
  END LOOP;
END $$;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA app TO service_role;

-- Idempotent seed for the 16 supplied accounts and their explicit groups.
CREATE TEMP TABLE _seed_tracked_accounts (handle text PRIMARY KEY, groups text[] NOT NULL);
INSERT INTO _seed_tracked_accounts (handle, groups) VALUES
  ('insomniacxbt', ARRAY['majors']::text[]),
  ('lBattleRhino', ARRAY['majors']::text[]),
  ('captain_kole', ARRAY['majors']::text[]),
  ('_tolks', ARRAY['majors']::text[]),
  ('Tradermayne', ARRAY['majors']::text[]),
  ('stogolp', ARRAY['majors','onchain']::text[]),
  ('Evan_ss6', ARRAY['majors']::text[]),
  ('ThinkingUSD', ARRAY['majors']::text[]),
  ('smileycapital', ARRAY['majors']::text[]),
  ('blknoiz06', ARRAY['majors','onchain']::text[]),
  ('0xRenaissance', ARRAY['onchain']::text[]),
  ('0xuberM', ARRAY['onchain']::text[]),
  ('notanicecat69', ARRAY['onchain']::text[]),
  ('owen1v9', ARRAY['majors','onchain']::text[]),
  ('0xn4te', ARRAY['onchain']::text[]),
  ('based16z', ARRAY['momentum']::text[]);

INSERT INTO app.tracked_accounts (handle, normalized_handle)
SELECT handle, lower(handle) FROM _seed_tracked_accounts
ON CONFLICT (normalized_handle) DO UPDATE SET handle = EXCLUDED.handle, active = true, updated_at = now();

-- Correct only seeded handles; leave all administrator-created accounts alone.
DELETE FROM app.tracked_account_groups AS existing
USING app.tracked_accounts AS account, _seed_tracked_accounts AS seed
WHERE existing.account_id = account.id
  AND account.normalized_handle = lower(seed.handle)
  AND NOT (existing.group_key = ANY(seed.groups));

INSERT INTO app.tracked_account_groups (account_id, group_key)
SELECT account.id, groups.group_key
FROM _seed_tracked_accounts AS seed
JOIN app.tracked_accounts AS account ON account.normalized_handle = lower(seed.handle)
CROSS JOIN LATERAL unnest(seed.groups) AS groups(group_key)
ON CONFLICT (account_id, group_key) DO NOTHING;
DROP TABLE _seed_tracked_accounts;
