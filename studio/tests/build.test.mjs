import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const output = new URL("../../public/meridian/consent-studio/index.html", import.meta.url);

test("builds Meridian Consent Studio at its canonical Measurement Stack path", async () => {
  const html = await readFile(output, "utf8");
  assert.match(html, /<title>Meridian Consent Studio<\/title>/);
  assert.match(html, /\/meridian\/consent-studio\/assets\//);
  assert.match(html, /<style data-studio-css>/);
  assert.match(html, /--bg:#0d0f12/);
  assert.doesNotMatch(html, /chatgpt\.site/);
});
