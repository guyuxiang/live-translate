import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/translation-session-manager.ts", import.meta.url), "utf8");

test("session list exposes persisted language and token counts", () => {
  assert.match(source, /languageCount\?: number;/, "SessionInfo should expose languageCount");
  assert.match(source, /tokenCount\?: number;/, "SessionInfo should expose tokenCount");
  assert.match(source, /languageCount:\s*session\.languageCount/, "getAllSessions should copy persisted languageCount");
  assert.match(source, /tokenCount:\s*session\.tokenCount/, "getAllSessions should copy persisted tokenCount");
});
