import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SQLiteStore } from "../src/lib/sqlite-store.ts";

test("sessions persist cost, status, duration, listener peak, and last activity", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-translate-metadata-"));
  const dbPath = join(dir, "test.sqlite");

  try {
    const store = new SQLiteStore(dbPath);
    store.saveSession({
      sessionId: "session-meta",
      organizerIdentity: "organizer-host",
      name: "Metadata Test",
      createdAt: new Date("2026-06-22T08:00:00.000Z"),
    });

    store.updateSessionStats("session-meta", {
      languageCount: 2,
      tokenCount: 12345,
      costUsd: 0.123456,
      listenerCount: 3,
      lastActivityAt: new Date("2026-06-22T08:05:00.000Z"),
    });

    const active = store.getSession("session-meta");
    assert.equal(active?.status, "active");
    assert.equal(active?.languageCount, 2);
    assert.equal(active?.tokenCount, 12345);
    assert.equal(active?.costUsd, 0.123456);
    assert.equal(active?.listenerPeakCount, 3);
    assert.equal(active?.durationSeconds, 300);
    assert.deepEqual(active?.lastActivityAt, new Date("2026-06-22T08:05:00.000Z"));

    store.endSession("session-meta", new Date("2026-06-22T08:10:00.000Z"));
    const ended = store.getSession("session-meta");
    assert.equal(ended?.status, "ended");
    assert.equal(ended?.durationSeconds, 600);

    store.archiveSession("session-meta");
    assert.equal(store.getSession("session-meta")?.status, "archived");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("home page displays persisted session metadata and caption opens as a primary button", () => {
  const homeSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const watchSource = readFileSync(new URL("../src/app/session/[id]/watch/page.tsx", import.meta.url), "utf8");

  assert.match(homeSource, /costUsd/, "home page should read and display costUsd");
  assert.match(homeSource, /durationSeconds/, "home page should read and display durationSeconds");
  assert.match(homeSource, /lastActivityAt/, "home page should read and display lastActivityAt");
  assert.match(homeSource, /status/, "home page should read and display status");
  assert.match(watchSource, /Caption mode/);
});
