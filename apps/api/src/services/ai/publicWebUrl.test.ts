import test from "node:test";
import assert from "node:assert/strict";
import { publicWebUrl } from "./publicWebUrl.js";
test("public web candidates exclude local, credential-bearing and encoded IP URLs", () => {
  for (const value of [
    "http://localhost/x",
    "http://127.1/",
    "http://2130706433/",
    "http://[::1]/",
    "https://metadata.internal/x",
    "https://user:pass@wikipedia.org",
    "file:///tmp/a",
    "https://host.local",
    "https://example.org:8080/x"
  ])
    assert.equal(publicWebUrl(value), null, value);
  assert.equal(
    publicWebUrl("https://en.wikipedia.org/wiki/Prague#History"),
    "https://en.wikipedia.org/wiki/Prague"
  );
});
