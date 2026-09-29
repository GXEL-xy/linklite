-- LinkLite D1 表结构 (迭代 0)
-- 执行: npm run db:schema

CREATE TABLE IF NOT EXISTS links (
  code        TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  click_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_links_created_at  ON links(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_click_count ON links(click_count DESC);
