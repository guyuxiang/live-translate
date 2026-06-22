import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/translation-bridge.ts", import.meta.url), "utf8");

test("translation bridge keeps listening for organizer audio after broadcast reconnects", () => {
  const subscribeStart = source.indexOf("private async subscribeToOrganizer");
  const participantsLookup = source.indexOf("const participants = this.room.remoteParticipants", subscribeStart);
  const trackPublishedListener = source.indexOf("RoomEvent.TrackPublished", subscribeStart);

  assert.notEqual(subscribeStart, -1, "subscribeToOrganizer should exist");
  assert.notEqual(participantsLookup, -1, "subscribeToOrganizer should inspect participants");
  assert.notEqual(trackPublishedListener, -1, "subscribeToOrganizer should register a TrackPublished listener");
  assert.ok(
    trackPublishedListener < participantsLookup,
    "TrackPublished listener must be registered before the early return when organizer is already present, so a history session keeps translating after broadcast closes and reconnects"
  );
});
