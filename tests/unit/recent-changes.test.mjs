import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRecentChanges } from "../../src/shared/recent-changes.js";

test("normalizes legacy recent changes and ignores malformed entries", () => {
  const changes = normalizeRecentChanges([
    null,
    { name: "missing-time" },
    {
      id: "legacy",
      timestamp: 100,
      name: "token",
      cookieId: "cookie-id",
      domain: "example.com",
      path: "/"
    }
  ]);

  assert.deepEqual(changes, [{
    id: "legacy",
    timestamp: 100,
    name: "token",
    cookieId: "cookie-id",
    domain: "example.com",
    path: "/",
    itemId: "cookie-id",
    itemKind: "cookie",
    storageType: "",
    origin: "",
    action: "edit"
  }]);
});

test("keeps at most eight recent changes for each data kind", () => {
  const input = Array.from({ length: 20 }, (_, index) => ({
    id: String(index),
    timestamp: 100 - index,
    name: `item-${index}`,
    itemKind: index % 2 ? "localStorage" : "cookie"
  }));
  const normalized = normalizeRecentChanges(input);

  assert.equal(normalized.filter((item) => item.itemKind === "cookie").length, 8);
  assert.equal(normalized.filter((item) => item.itemKind === "localStorage").length, 8);
});
