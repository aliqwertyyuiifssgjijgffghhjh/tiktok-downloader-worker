CREATE TABLE IF NOT EXISTS api_keys(id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider IN ('saveapi','yoinku')),label TEXT NOT NULL,encrypted_secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,last_used_at INTEGER,cooldown_until INTEGER,last_error TEXT);
CREATE INDEX IF NOT EXISTS idx_keys_provider ON api_keys(provider,enabled,cooldown_until);
CREATE TABLE IF NOT EXISTS usage(id INTEGER PRIMARY KEY AUTOINCREMENT,provider TEXT NOT NULL,key_id TEXT,outcome TEXT NOT NULL,error_code TEXT,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage(created_at);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL);