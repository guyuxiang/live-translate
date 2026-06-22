import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface StoredSession {
  sessionId: string;
  organizerIdentity: string;
  name: string;
  createdAt: Date;
  endedAt?: Date | null;
  languageCount?: number;
  tokenCount?: number;
}

export interface StoredTranscriptEntry {
  id: string;
  text: string;
  language: string;
  final: boolean;
  timestamp: number;
}

const DEFAULT_DB_PATH = process.env.LIVE_TRANSLATE_DB_PATH || process.env.SQLITE_PATH || "/data/live-translate.sqlite";

export class SQLiteStore {
  private db: DatabaseSync;

  constructor(dbPath = DEFAULT_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        organizer_identity TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ended_at TEXT,
        language_count INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS transcript_entries (
        session_id TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        language TEXT NOT NULL,
        text TEXT NOT NULL,
        final INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (session_id, entry_id)
      );

      CREATE INDEX IF NOT EXISTS idx_transcript_session_language_time
        ON transcript_entries(session_id, language, timestamp);
    `);
  }

  saveSession(session: StoredSession): void {
    this.db.prepare(`
      INSERT INTO sessions (session_id, organizer_identity, name, created_at, ended_at, language_count, token_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        organizer_identity = excluded.organizer_identity,
        name = excluded.name,
        created_at = excluded.created_at,
        ended_at = excluded.ended_at,
        language_count = excluded.language_count,
        token_count = excluded.token_count
    `).run(
      session.sessionId,
      session.organizerIdentity,
      session.name,
      session.createdAt.toISOString(),
      session.endedAt ? session.endedAt.toISOString() : null,
      session.languageCount ?? 0,
      session.tokenCount ?? 0,
    );
  }

  getSession(sessionId: string): StoredSession | undefined {
    const row = this.db.prepare(`
      SELECT session_id, organizer_identity, name, created_at, ended_at, language_count, token_count
      FROM sessions
      WHERE session_id = ?
    `).get(sessionId) as SessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }

  getAllSessions(limit = 50): StoredSession[] {
    const rows = this.db.prepare(`
      SELECT session_id, organizer_identity, name, created_at, ended_at, language_count, token_count
      FROM sessions
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(limit) as SessionRow[];
    return rows.map(rowToSession);
  }

  updateSessionStats(sessionId: string, languageCount: number, tokenCount: number): void {
    this.db.prepare(`
      UPDATE sessions
      SET language_count = ?, token_count = ?
      WHERE session_id = ?
    `).run(languageCount, tokenCount, sessionId);
  }

  endSession(sessionId: string, endedAt = new Date()): void {
    this.db.prepare(`
      UPDATE sessions
      SET ended_at = ?
      WHERE session_id = ?
    `).run(endedAt.toISOString(), sessionId);
  }

  saveTranscriptEntry(sessionId: string, entry: StoredTranscriptEntry): void {
    this.db.prepare(`
      INSERT INTO transcript_entries (session_id, entry_id, language, text, final, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, entry_id) DO UPDATE SET
        language = excluded.language,
        text = excluded.text,
        final = excluded.final,
        timestamp = excluded.timestamp
    `).run(
      sessionId,
      entry.id,
      entry.language,
      entry.text,
      entry.final ? 1 : 0,
      entry.timestamp,
    );
  }

  appendTranscriptEntry(sessionId: string, entry: StoredTranscriptEntry): void {
    this.db.prepare(`
      INSERT INTO transcript_entries (session_id, entry_id, language, text, final, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, entry_id) DO UPDATE SET
        language = excluded.language,
        text = transcript_entries.text || excluded.text,
        final = excluded.final,
        timestamp = excluded.timestamp
    `).run(
      sessionId,
      entry.id,
      entry.language,
      entry.text,
      entry.final ? 1 : 0,
      entry.timestamp,
    );
  }

  getTranscriptEntries(sessionId: string, language?: string, limit = 500): StoredTranscriptEntry[] {
    const rows = language
      ? this.db.prepare(`
          SELECT entry_id, language, text, final, timestamp
          FROM transcript_entries
          WHERE session_id = ? AND language = ?
          ORDER BY timestamp ASC
          LIMIT ?
        `).all(sessionId, language, limit)
      : this.db.prepare(`
          SELECT entry_id, language, text, final, timestamp
          FROM transcript_entries
          WHERE session_id = ?
          ORDER BY timestamp ASC
          LIMIT ?
        `).all(sessionId, limit);
    return (rows as TranscriptRow[]).map(rowToTranscriptEntry);
  }

  close(): void {
    this.db.close();
  }
}

type SessionRow = {
  session_id: string;
  organizer_identity: string;
  name: string;
  created_at: string;
  ended_at: string | null;
  language_count: number;
  token_count: number;
};

type TranscriptRow = {
  entry_id: string;
  language: string;
  text: string;
  final: number;
  timestamp: number;
};

function rowToSession(row: SessionRow): StoredSession {
  return {
    sessionId: row.session_id,
    organizerIdentity: row.organizer_identity,
    name: row.name,
    createdAt: new Date(row.created_at),
    endedAt: row.ended_at ? new Date(row.ended_at) : null,
    languageCount: row.language_count,
    tokenCount: row.token_count,
  };
}

function rowToTranscriptEntry(row: TranscriptRow): StoredTranscriptEntry {
  return {
    id: row.entry_id,
    language: row.language,
    text: row.text,
    final: Boolean(row.final),
    timestamp: row.timestamp,
  };
}

let singleton: SQLiteStore | null = null;

export function getSQLiteStore(): SQLiteStore {
  if (!singleton) singleton = new SQLiteStore();
  return singleton;
}
