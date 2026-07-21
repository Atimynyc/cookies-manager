import assert from "node:assert/strict";
import {
  createRecentChange,
  formatBytes,
  getCookiePairSize,
  normalizeRecentChanges
} from "../src/shared/recent-changes.js";
import {
  compactJsonValue,
  decodeJwtPayload,
  decodeUrlValue,
  encodeUrlValue,
  formatJsonValue,
  getAutoValueToolOutput
} from "../src/shared/value-tools.js";

const jwt =
  "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiZGV2Iiwicm9sZXMiOlsicWEiXX0.";

assert.equal(decodeUrlValue("%7B%22ok%22%3Atrue%7D"), '{"ok":true}');
assert.equal(encodeUrlValue('{"ok":true}'), "%7B%22ok%22%3Atrue%7D");
assert.equal(formatJsonValue('{"ok":true}'), '{\n  "ok": true\n}');
assert.equal(formatJsonValue("%7B%22ok%22%3Atrue%7D"), '{\n  "ok": true\n}');
assert.equal(compactJsonValue('{\n  "ok": true\n}'), '{"ok":true}');
assert.deepEqual(JSON.parse(decodeJwtPayload(jwt)), {
  user: "dev",
  roles: ["qa"]
});

const autoJwt = getAutoValueToolOutput(jwt);
assert.equal(autoJwt.mode, "jwt");
assert.deepEqual(JSON.parse(autoJwt.text), {
  user: "dev",
  roles: ["qa"]
});
assert.deepEqual(getAutoValueToolOutput('{"ok":true}'), {
  mode: "jsonFormat",
  title: "Formatted JSON",
  text: '{\n  "ok": true\n}'
});
assert.deepEqual(getAutoValueToolOutput('{\n  "ok": true\n}'), {
  mode: "jsonCompact",
  title: "Compacted JSON",
  text: '{"ok":true}'
});
assert.equal(getAutoValueToolOutput("%7B%22ok%22%3Atrue%7D").mode, "jsonFormat");
assert.deepEqual(getAutoValueToolOutput("%2Fadmin%20home"), {
  mode: "urlDecode",
  title: "URL decoded value",
  text: "/admin home"
});
assert.equal(getAutoValueToolOutput("admin home"), null);
assert.equal(getAutoValueToolOutput("plain-value"), null);

assert.throws(() => decodeUrlValue("%E0%A4%A"), /URL-encoded/);
assert.throws(() => formatJsonValue("plain text"), /valid JSON/);
assert.throws(() => decodeJwtPayload("not-a-token"), /JWT/);

const row = {
  id: "store||example.test|/|session",
  name: "session",
  domain: "example.test",
  path: "/",
  storeId: "0",
  size: getCookiePairSize("session", "old")
};
const change = createRecentChange(row, "next", "example.test", 1790000000000);

assert.equal(change.name, "session");
assert.equal(change.host, "example.test");
assert.equal(change.cookieId, row.id);
assert.equal(change.action, "edit");
assert.equal(change.beforeSize, "session=old".length);
assert.equal(change.afterSize, "session=next".length);
assert.equal(formatBytes(change.afterSize), "12 B");

const manyChanges = Array.from({ length: 10 }, (_, index) => ({
  name: `cookie-${index}`,
  timestamp: 1790000000000 + index
}));
assert.equal(normalizeRecentChanges(manyChanges).length, 8);
const mixedChanges = [
  ...manyChanges,
  ...manyChanges.map((change, index) => ({
    ...change,
    name: `local-${index}`,
    itemKind: "localStorage"
  }))
];
const normalizedMixedChanges = normalizeRecentChanges(mixedChanges);
assert.equal(normalizedMixedChanges.length, 16);
assert.equal(normalizedMixedChanges.filter((item) => item.itemKind === "cookie").length, 8);
assert.equal(normalizedMixedChanges.filter((item) => item.itemKind === "localStorage").length, 8);
assert.deepEqual(normalizeRecentChanges([null, { timestamp: 1 }, manyChanges[0]]), [{
  ...manyChanges[0],
  cookieId: "",
  itemId: "",
  itemKind: "cookie",
  storageType: "",
  origin: "",
  action: "edit"
}]);

console.log("milestone 4 verification ok");
