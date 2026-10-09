CREATE INDEX IF NOT EXISTS articles_fetched_at_idx ON app.articles (fetched_at DESC);
CREATE INDEX IF NOT EXISTS stories_created_at_idx ON app.stories (created_at DESC);
