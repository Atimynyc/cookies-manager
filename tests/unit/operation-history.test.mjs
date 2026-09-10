import assert from "node:assert/strict";
import test from "node:test";
import { compareRecentChangeOrder, projectOperationHistory } from "../../src/shared/operation-history.js";
import {
  clearHistoryKind,
  getDismissedChangeIds,
  getRecentCookieChanges,
  persistOperationHistory
} from "../../src/shared/history-store.js";
import { installWebLocks } from "../helpers/web-locks.mjs";

const TARGET = {
  tabId: 7, url: "https://example.test/app", origin: "https://example.test",
  cookieStoreId: "0", incognito: false
};

function storageValue(key, value, type = "local") {
  return value === null ? null : { type, key, value, origin: TARGET.origin };
}

function item(id, before, after, state = "applied", kind = "localStorage") {
  const type = kind === "sessionStorage" ? "session" : "local";
  return { id, kind, name: id, before: storageValue(id, before, type), after: storageValue(id, after, type), state };
}

function job(id, items, { source = "edit", createdAt = "2026-09-10T10:00:00.000Z" } = {}) {
  return { id, target: TARGET, source, createdAt, status: "completed", items };
}

function installHistoryStorage(t, initial = {}) {
  const { requests } = installWebLocks(t);
  const previousChrome = globalThis.chrome;
  const state = {
    local: structuredClone(initial.local || {}),
    session: structuredClone(initial.session || {}),
    writes: [], lockRequests: requests
  };
  const area = (name) => ({
    get(defaults, callback) {
      queueMicrotask(() => callback(structuredClone({ ...defaults, ...state[name] })));
    },
    set(values, callback) {
      queueMicrotask(() => {
        Object.assign(state[name], structuredClone(values));
        state.writes.push({ area: name, values: structuredClone(values) });
        callback();
      });
    },
    remove(keys, callback) {
      queueMicrotask(() => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete state[name][key];
        callback();
      });
    }
  });
  globalThis.chrome = { runtime: {}, storage: { local: area("local"), session: area("session") } };
  t.after(() => {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  });
  return state;
}

test("operation history distinguishes imported create, overwrite and deletion with accurate snapshots", () => {
  const entries = [item("created", null, "created-secret"), item("overwritten", "old-secret", "new-secret"), item("deleted", "removed-secret", null)];
  const projection = projectOperationHistory([job("import", entries, { source: "package-import" })]);
  assert.deepEqual(projection.changes.map(({ name, action }) => ({ name, action })), [
    { name: "deleted", action: "delete" },
    { name: "overwritten", action: "import-overwrite" },
    { name: "created", action: "import-create" }
  ]);
  const byName = new Map(projection.changes.map((change) => [change.name, change]));
  assert.equal(byName.get("created").beforeSize, 0);
  assert.equal(byName.get("deleted").afterSize, 0);
  assert.ok(byName.get("deleted").beforeSize > 0);
  assert.equal(projection.snapshots["import:created"].beforeValue, "");
  assert.equal(projection.snapshots["import:created"].afterValue, "created-secret");
  assert.equal(projection.snapshots["import:overwritten"].beforeValue, "old-secret");
  assert.equal(projection.snapshots["import:deleted"].afterValue, "");
  assert.deepEqual(projection.snapshots["import:deleted"].target, TARGET);
  assert.equal(projection.snapshots["import:deleted"].operationItemId, "deleted");
});

test("history orders jobs newest first and completed items last-write first within a batch", () => {
  const older = job("older", [item("first", "a", "b"), item("second", "c", "d")]);
  const newer = job("newer", [item("third", "e", "f")], { createdAt: "2026-09-10T10:01:00.000Z" });
  assert.deepEqual(projectOperationHistory([older, newer]).changes.map(({ id }) => id), ["newer:third", "older:second", "older:first"]);
});

test("failed and pending items are absent while undone items retain summaries without undo snapshots", () => {
  const states = ["pending", "running", "failed", "conflict", "applied", "undoing", "undone", "undo-failed", "undo-conflict"];
  const projection = projectOperationHistory([job("states", states.map((state) => item(state, "before", "after", state)))]);
  assert.deepEqual(new Set(projection.changes.map(({ name }) => name)), new Set(["applied", "undoing", "undone", "undo-failed", "undo-conflict"]));
  assert.equal(projection.snapshots["states:undone"], undefined);
  for (const state of ["applied", "undoing", "undo-failed", "undo-conflict"]) {
    assert.equal(projection.snapshots[`states:${state}`].operationId, "states");
  }
});

test("cookie history keeps expiration metadata and browser target without values in its summaries", () => {
  const before = {
    name: "session", value: "unique-before-sensitive-value", domain: "example.test", path: "/",
    storeId: "0", hostOnly: true, session: true, secure: true, httpOnly: true, sameSite: "lax"
  };
  const after = { ...before, value: "unique-after-sensitive-value", session: false, expirationDate: 1900000000 };
  const projection = projectOperationHistory([job("cookie", [{ id: "session", name: "session", kind: "cookies", before, after, state: "applied" }])]);
  const change = projection.changes[0];
  assert.equal(change.itemKind, "cookie");
  assert.equal(change.beforeSession, true);
  assert.equal(change.afterSession, false);
  assert.equal(change.afterExpirationDate, 1900000000);
  assert.equal(change.targetTabId, TARGET.tabId);
  assert.equal(change.targetIncognito, false);
  assert.equal(change.origin, TARGET.origin);
  assert.ok(!JSON.stringify(projection.changes).includes(before.value));
  assert.ok(!JSON.stringify(projection.changes).includes(after.value));
  assert.equal(projection.snapshots[change.id].beforeValue, before.value);
});

test("concurrent summaries from independent modules merge different jobs without persisting values", async (t) => {
  const storage = installHistoryStorage(t);
  const secondSurface = await import("../../src/shared/history-store.js?history-surface=second");
  const first = job("first", [item("first-item", "unique-before-A", "unique-after-A")]);
  const second = job("second", [item("second-item", "unique-before-B", "unique-after-B")], { createdAt: "2026-09-10T10:02:00.000Z" });
  await Promise.all([persistOperationHistory(first), secondSurface.persistOperationHistory(second)]);
  assert.deepEqual((await getRecentCookieChanges()).map(({ id }) => id), ["second:second-item", "first:first-item"]);
  assert.equal(storage.local.recentCookieChanges.length, 2);
  assert.deepEqual(storage.lockRequests, Array(2).fill({ name: "cookie-controller:storage.local:recentCookieChanges", mode: "exclusive" }));
  const persistedText = JSON.stringify(storage.local);
  for (const value of ["unique-before-A", "unique-after-A", "unique-before-B", "unique-after-B"]) assert.ok(!persistedText.includes(value));
  assert.equal(storage.local.recentChangeSnapshots, undefined);
});

test("clear history tombstones prevent a later checkpoint from resurrecting that job and preserve other kinds", async (t) => {
  const localJob = job("local", [item("local-key", "before", "after")]);
  const sessionJob = job("session", [item("session-key", "old", "new", "applied", "sessionStorage")]);
  const localId = "local:local-key";
  const sessionId = "session:session-key";
  const storage = installHistoryStorage(t, { session: { recentChangeSnapshots: { [localId]: { legacy: true }, [sessionId]: { legacy: true } } } });
  await Promise.all([persistOperationHistory(localJob), persistOperationHistory(sessionJob)]);
  await clearHistoryKind("localStorage", [localId]);
  await persistOperationHistory({ ...localJob, items: [{ ...localJob.items[0], state: "undone" }] });
  assert.deepEqual((await getRecentCookieChanges()).map(({ id }) => id), [sessionId]);
  assert.ok((await getDismissedChangeIds()).includes(localId));
  assert.equal(storage.session.recentChangeSnapshots[localId], undefined);
  assert.deepEqual(storage.session.recentChangeSnapshots[sessionId], { legacy: true });
});

test("clear and summary updates serialize so a known cleared operation stays dismissed", async (t) => {
  const storage = installHistoryStorage(t);
  const oldJob = job("known", [item("known-item", "before", "after")]);
  const newJob = job("fresh", [item("new-item", null, "new")], { source: "quick-import", createdAt: "2026-09-10T11:00:00.000Z" });
  await persistOperationHistory(oldJob);
  await Promise.all([
    clearHistoryKind("localStorage", ["known:known-item"]),
    persistOperationHistory(oldJob),
    persistOperationHistory(newJob)
  ]);
  assert.deepEqual((await getRecentCookieChanges()).map(({ id }) => id), ["fresh:new-item"]);
  assert.deepEqual(storage.session.dismissedOperationChanges, ["known:known-item"]);
});

test("repeated checkpoints update one summary and local retention stays bounded per data kind", async (t) => {
  installHistoryStorage(t);
  for (let index = 0; index < 10; index += 1) {
    const current = job(`job-${index}`, [item(`key-${index}`, "before", "after")], { createdAt: `2026-09-10T10:${String(index).padStart(2, "0")}:00.000Z` });
    await persistOperationHistory(current);
    await persistOperationHistory(current);
  }
  const changes = await getRecentCookieChanges();
  assert.equal(changes.length, 8);
  assert.equal(new Set(changes.map(({ id }) => id)).size, 8);
  assert.equal(changes[0].id, "job-9:key-9");
  assert.equal(changes.at(-1).id, "job-2:key-2");
});

test("incremental batch checkpoints retain last-item-first order after merging previously persisted summaries", async (t) => {
  installHistoryStorage(t);
  const entries = [item("first", "a", "b"), item("second", "c", "d"), item("third", "e", "f")];
  const batch = job("batch", entries, { source: "quick-import" });
  await persistOperationHistory({ ...batch, items: entries.map((entry, index) => ({ ...entry, state: index === 0 ? "applied" : "pending" })) });
  await persistOperationHistory({ ...batch, items: entries.map((entry, index) => ({ ...entry, state: index < 2 ? "applied" : "pending" })) });
  const otherSurface = await import("../../src/shared/history-store.js?history-surface=checkpoint");
  const unrelated = job("newer", [item("unrelated", "x", "y")], { createdAt: "2026-09-10T10:01:00.000Z" });
  await Promise.all([persistOperationHistory(batch), otherSurface.persistOperationHistory(unrelated)]);
  assert.deepEqual((await getRecentCookieChanges()).map(({ id }) => id), ["newer:unrelated", "batch:third", "batch:second", "batch:first"]);
  await persistOperationHistory(batch);
  assert.deepEqual((await getRecentCookieChanges()).map(({ id }) => id), ["newer:unrelated", "batch:third", "batch:second", "batch:first"]);
});

test("legacy records without IDs at the same timestamp cannot prevent a new summary from persisting", async (t) => {
  const timestamp = Date.parse("2026-09-10T10:00:00.000Z");
  const legacy = [
    { name: "legacy-first", itemKind: "localStorage", timestamp },
    { name: "legacy-second", itemKind: "localStorage", timestamp }
  ];
  assert.doesNotThrow(() => [...legacy].sort(compareRecentChangeOrder));
  installHistoryStorage(t, { local: { recentCookieChanges: [null, { timestamp }, ...legacy] } });
  await persistOperationHistory(job("new-operation", [item("new-key", "before", "after")]));
  const changes = await getRecentCookieChanges();
  assert.ok(changes.some((change) => change.id === "new-operation:new-key"));
  assert.ok(changes.some((change) => change.name.startsWith("legacy-")));
  assert.ok(changes.every((change) => typeof change.name === "string" && Number.isFinite(change.timestamp)));
  assert.doesNotThrow(() => changes.sort(compareRecentChangeOrder));
});
