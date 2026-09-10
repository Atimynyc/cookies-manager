import assert from "node:assert/strict";
import test from "node:test";
import { createOperationJournal, MAX_OPERATION_JOBS, OPERATION_JOURNAL_KEY } from "../../src/shared/operation-journal.js";

function setup(t, options = {}) {
  const previousChrome = globalThis.chrome;
  const env = { data: {}, writes: 0, queries: [], error: null };
  globalThis.chrome = {
    runtime: {},
    storage: { session: {
      QUOTA_BYTES: options.quota || 10 * 1024 * 1024,
      get(defaults, callback) { callback(structuredClone({ ...defaults, ...env.data })); },
      getBytesInUse(key, callback) {
        env.queries.push(key);
        callback(key === null ? options.totalBytes || 0 : options.journalBytes || 0);
      },
      set(values, callback) {
        if (env.error) {
          chrome.runtime.lastError = { message: env.error };
          callback();
          delete chrome.runtime.lastError;
          return;
        }
        env.writes += 1;
        Object.assign(env.data, structuredClone(values));
        callback();
      }
    } }
  };
  t.after(() => {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  });
  return env;
}

function job(id = "job") {
  return { id, status: "queued", items: [{ id: "item", state: "pending", before: null, after: { value: "new" } }] };
}

test("the operation journal stores a versioned session-only record and returns independent snapshots", async (t) => {
  const env = setup(t);
  const journal = createOperationJournal();
  assert.deepEqual(await journal.read(), []);
  await journal.write([job()]);
  assert.equal(env.data[OPERATION_JOURNAL_KEY].schemaVersion, 1);
  const read = await journal.read();
  read[0].items[0].after.value = "mutated";
  assert.equal((await journal.read())[0].items[0].after.value, "new");
});

test("journal capacity preflight includes other session data and checkpoint reserves before writes", async (t) => {
  const env = setup(t, { quota: 3000, totalBytes: 1800 });
  const journal = createOperationJournal();
  await assert.rejects(journal.write([job()]), (error) => {
    assert.equal(error.code, "OPERATION_JOURNAL_FULL");
    assert.match(error.message, /Clear completed batches in History/);
    return true;
  });
  assert.deepEqual(env.queries, [null, OPERATION_JOURNAL_KEY]);
  assert.equal(env.writes, 0);
});

test("journal quota accounting subtracts the existing journal rather than double counting it", async (t) => {
  const env = setup(t, { quota: 3000, totalBytes: 1800, journalBytes: 1800 });
  await createOperationJournal().write([job()]);
  assert.equal(env.writes, 1);
});

test("Cookie normalization and error checkpoints consume capacity reserved before writing", async (t) => {
  const env = setup(t, { quota: 12000 });
  const journal = createOperationJournal();
  const after = { value: "v".repeat(4000), session: false, expirationDate: 2200000000 };
  const initial = { ...job(), items: [{ id: "cookie", kind: "cookies", state: "pending", before: null, after }] };
  await journal.write([initial]);
  const normalized = {
    ...initial, status: "completed", revision: 10, updatedAt: "2026-09-10T00:00:00.000Z",
    items: [{ ...initial.items[0], state: "applied", after: { ...after, expirationDate: 2000000000 }, requestedAfter: after, normalized: true }]
  };
  await journal.write([normalized]);
  assert.equal(env.writes, 2);
  assert.equal((await journal.read())[0].items[0].requestedAfter.expirationDate, 2200000000);
});

test("journal job limit rejects additional history without silently deleting existing jobs", async (t) => {
  const env = setup(t);
  env.data[OPERATION_JOURNAL_KEY] = { schemaVersion: 1, jobs: [job("kept")] };
  const jobs = Array.from({ length: MAX_OPERATION_JOBS + 1 }, (_, index) => job(String(index)));
  await assert.rejects(createOperationJournal().write(jobs), { code: "OPERATION_JOURNAL_FULL" });
  assert.equal(env.data[OPERATION_JOURNAL_KEY].jobs[0].id, "kept");
  assert.equal(env.writes, 0);
});

test("Chrome quota rejection remains actionable and preserves the previous journal", async (t) => {
  const env = setup(t);
  const journal = createOperationJournal();
  await journal.write([job("kept")]);
  env.error = "QUOTA_BYTES quota exceeded";
  await assert.rejects(journal.write([job("replacement")]), { code: "OPERATION_JOURNAL_FULL" });
  assert.equal((await journal.read())[0].id, "kept");
  assert.equal(env.writes, 1);
});

test("unknown journal versions and unavailable session storage fail without erasing history", async (t) => {
  const env = setup(t);
  env.data[OPERATION_JOURNAL_KEY] = { schemaVersion: 2, jobs: [job("kept")] };
  await assert.rejects(createOperationJournal().read(), /Existing history has been preserved/);
  assert.equal(env.writes, 0);
  delete chrome.storage.session;
  await assert.rejects(createOperationJournal().write([job()]), /Session storage is required/);
});
