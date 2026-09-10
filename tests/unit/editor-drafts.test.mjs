import assert from "node:assert/strict";
import test from "node:test";
import { createEditorDraftStore, getEditorDraftKey } from "../../src/popup/popup-editor-drafts.js";

const target = { tabId: 1, origin: "https://example.test", incognito: false, cookieStoreId: "0" };
const row = { id: "flag", type: "local", value: "before", raw: { key: "flag", value: "before", origin: target.origin } };

test("drafts survive refreshes and keep the original conflict baseline", () => {
  const store = createEditorDraftStore();
  const key = getEditorDraftKey(target, "localStorage", row.id);
  store.capture(key, row, "draft", "", "");
  assert.equal(store.hasConflict(key, { ...row }), false);
  const changed = { ...row, value: "external", raw: { ...row.raw, value: "external" } };
  assert.equal(store.hasConflict(key, changed), true);
  store.capture(key, changed, "draft revised", "", "");
  assert.equal(store.get(key).value, "draft revised");
  assert.equal(store.hasConflict(key, changed), true);
  store.capture(key, changed, "external", "", "");
  assert.equal(store.get(key), undefined);
});

test("drafts are isolated by tab, origin, store, and data kind", () => {
  const key = getEditorDraftKey(target, "sessionStorage", row.id);
  for (const overrides of [{ tabId: 2 }, { origin: "https://other.test" }, { cookieStoreId: "1" }, { incognito: true }]) {
    assert.notEqual(getEditorDraftKey({ ...target, ...overrides }, "sessionStorage", row.id), key);
  }
  assert.notEqual(getEditorDraftKey(target, "localStorage", row.id), key);
});

test("cookie expiration drafts and external attribute changes are preserved", () => {
  const store = createEditorDraftStore();
  const cookie = { id: "cookie", value: "value", raw: { name: "cookie", value: "value", domain: "example.test", session: true } };
  store.capture("cookie", cookie, cookie.value, "2027-01-01T00:00:00", "");
  assert.equal(store.get("cookie").expiration, "2027-01-01T00:00:00");
  assert.equal(store.hasConflict("cookie", { ...cookie, raw: { ...cookie.raw, secure: true } }), true);
  store.remove("cookie");
  assert.equal(store.get("cookie"), undefined);
});

test("browser cookies with an empty name can keep an editable draft", () => {
  const store = createEditorDraftStore();
  const cookie = { id: "unnamed", value: "before", raw: { name: "", value: "before", domain: "example.test", session: true } };
  store.capture("unnamed", cookie, "draft", "", "");
  assert.equal(store.get("unnamed").value, "draft");
  assert.equal(store.hasConflict("unnamed", cookie), false);
});
