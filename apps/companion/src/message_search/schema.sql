PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -2048;
CREATE TABLE IF NOT EXISTS sources (
    thread_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    identity TEXT NOT NULL,
    offset INTEGER NOT NULL,
    turn_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL,
    checkpoint BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS messages_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL, timestamp TEXT NOT NULL,
    source_offset INTEGER NOT NULL, kind TEXT NOT NULL,
    representations INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS message_position ON messages_content(thread_id, source_offset);
CREATE INDEX IF NOT EXISTS message_mirrors ON messages_content(thread_id, turn_id, kind);
CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(
    body, thread_id UNINDEXED, turn_id UNINDEXED, timestamp UNINDEXED,
    source_offset UNINDEXED, kind UNINDEXED,
    content = 'messages_content', content_rowid = 'id',
    tokenize = 'unicode61', prefix = '2 3 4'
);
CREATE TRIGGER IF NOT EXISTS message_insert AFTER INSERT ON messages_content BEGIN
    INSERT INTO messages(rowid, body, thread_id, turn_id, timestamp, source_offset, kind)
    VALUES (new.id, new.body, new.thread_id, new.turn_id, new.timestamp, new.source_offset, new.kind);
END;
CREATE TRIGGER IF NOT EXISTS message_delete AFTER DELETE ON messages_content BEGIN
    INSERT INTO messages(messages, rowid, body, thread_id, turn_id, timestamp, source_offset, kind)
    VALUES ('delete', old.id, old.body, old.thread_id, old.turn_id, old.timestamp, old.source_offset, old.kind);
END;
CREATE TABLE IF NOT EXISTS turns (
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    source_offset INTEGER NOT NULL,
    PRIMARY KEY(thread_id, turn_id)
);
CREATE INDEX IF NOT EXISTS search_turn_position ON turns(thread_id, source_offset);
