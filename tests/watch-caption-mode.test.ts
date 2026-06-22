import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/app/session/[id]/watch/page.tsx", import.meta.url), "utf8");

test("watch page supports compact caption mode", () => {
  assert.match(source, /useSearchParams/, "watch page should read query params");
  assert.match(source, /captionMode/, "watch page should pass captionMode into attendee view");
  assert.match(source, /mode=caption/, "watch page should expose a caption-mode URL");
  assert.match(source, /caption-shell/, "caption mode should use compact shell styling");
  assert.match(source, /caption-line/, "caption text should use dedicated compact caption styling");
});
