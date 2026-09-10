import assert from "node:assert/strict";
import test from "node:test";

import { createOperationEngine } from "../../src/shared/operation-engine.js";
import { normalizeOperationItem, sameOperationValue } from "../../src/shared/operation-data.js";

const TARGET = { tabId: 1, url: "https://example.com/app", origin: "https://example.com", cookieStoreId: "0", incognito: false };

function value(text) {
  return text === null ? null : { type: "local", key: "flag", value: text, origin: TARGET.origin };
}

function spec(id = "operation", before = "before", after = "after") {
  return {
    id, target: TARGET, label: "Change value", source: "test",
    items: [{ id: "flag", kind: "localStorage", name: "flag", before: value(before), after: value(after) }],
    skipped: []
  };
}

function fixture(initial = value("before")) {
  const env = {
    jobs: [], values: new Map([["flag", initial]]), writes: [], checkpoints: [],
    verifyError: null, writeError: null, journalError: null, afterMutation: null, summaryError: null
  };
  const journal = {
    async read() { return structuredClone(env.jobs); },
    async write(jobs) {
      if (env.journalError?.(jobs)) throw new Error("Journal unavailable");
      env.jobs = structuredClone(jobs);
      env.checkpoints.push(structuredClone(jobs));
    }
  };
  const adapter = {
    async verifyTarget() { if (env.verifyError) throw env.verifyError; },
    async read(item) { return structuredClone(env.values.get(item.id) ?? null); },
    async compareAndWrite(item, target, expected, desired) {
      const persisted = env.jobs.find((job) => job.items.some((entry) => entry.id === item.id && ["running", "undoing"].includes(entry.state)));
      assert.ok(persisted, "The intent must be durable before changing site data.");
      assert.equal(persisted.items.find((entry) => entry.id === item.id).writeUncertain, true);
      assert.ok(sameOperationValue(item.kind, env.values.get(item.id) ?? null, expected));
      if (env.writeError) throw env.writeError;
      env.writes.push({ itemId: item.id, target: structuredClone(target), expected, desired });
      env.values.set(item.id, structuredClone(desired));
      if (env.afterMutation) await env.afterMutation(item);
      return structuredClone(desired);
    }
  };
  const options = {
    journal, adapter,
    async persistHistory() { if (env.summaryError) throw env.summaryError; }
  };
  return { env, options, engine: createOperationEngine(options) };
}

async function finished(engine, id) {
  await engine.resumeOperations();
  return engine.getOperation(id);
}

test("operations ACK only after their queued journal is durable and checkpoint before mutation", async () => {
  const { env, engine } = fixture();
  const ack = await engine.submitOperation(spec());
  assert.equal(ack.status, "queued");
  assert.equal(env.checkpoints[0][0].status, "queued");
  assert.equal(env.checkpoints[0][0].items[0].state, "pending");
  const job = await finished(engine, ack.id);
  assert.equal(job.status, "completed");
  assert.equal(job.items[0].state, "applied");
  assert.equal(env.values.get("flag").value, "after");
  assert.equal(env.writes.length, 1);
  assert.deepEqual(job.items[0].before, value("before"));
});

for (const action of ["apply", "undo"]) {
  test(`status reads return durable progress while an ${action} mutation callback is pending`, async () => {
    const { env, engine } = fixture();
    if (action === "undo") {
      await engine.submitOperation(spec());
      await finished(engine, "operation");
    }
    let releaseMutation;
    let notifyStarted;
    const mutationHeld = new Promise((resolve) => { releaseMutation = resolve; });
    const mutationStarted = new Promise((resolve) => { notifyStarted = resolve; });
    env.afterMutation = async () => {
      notifyStarted();
      await mutationHeld;
    };
    try {
      if (action === "undo") await engine.undoOperation("operation");
      else await engine.submitOperation(spec());
      await mutationStarted;

      const reads = await Promise.race([
        Promise.all([engine.getOperation("operation"), engine.listOperations()]),
        new Promise((resolve) => setImmediate(() => resolve(null)))
      ]);
      assert.notEqual(reads, null, "Status reads must not wait for the browser mutation callback.");
      const [job, jobs] = reads;
      for (const snapshot of [job, jobs[0]]) {
        assert.equal(snapshot.status, "running");
        assert.equal(snapshot.items[0].state, action === "undo" ? "undoing" : "running");
        assert.equal(snapshot.items[0].writeUncertain, true);
        assert.deepEqual(snapshot.items[0].before, value("before"));
        assert.deepEqual(snapshot.items[0].after, value("after"));
      }
    } finally {
      releaseMutation();
      await engine.resumeOperations();
    }
    const completed = await engine.getOperation("operation");
    assert.equal(completed.status, "completed");
    assert.equal(completed.items[0].state, action === "undo" ? "undone" : "applied");
  });
}

test("the background queue serializes competing batches and preserves a changed value", async () => {
  const { env, engine } = fixture();
  await Promise.all([engine.submitOperation(spec("first")), engine.submitOperation(spec("second", "before", "second"))]);
  await engine.resumeOperations();
  const first = await engine.getOperation("first");
  const second = await engine.getOperation("second");
  assert.equal(first.items[0].state, "applied");
  assert.equal(second.items[0].state, "conflict");
  assert.equal(env.values.get("flag").value, "after");
  assert.equal(env.writes.length, 1);
});

test("repeated request IDs ACK the existing operation without repeating writes", async () => {
  const { env, engine } = fixture();
  await engine.submitOperation(spec());
  await finished(engine, "operation");
  const ack = await engine.submitOperation(spec());
  assert.equal(ack.status, "completed");
  assert.equal(env.writes.length, 1);
  await assert.rejects(engine.submitOperation(spec("operation", "before", "different")), /another request/);
});

test("journal failure rejects a new batch before mutating any site data", async () => {
  const { env, engine } = fixture();
  env.journalError = () => true;
  await assert.rejects(engine.submitOperation(spec()), /Journal unavailable/);
  assert.equal(env.writes.length, 0);
  assert.equal(env.jobs.length, 0);
});

test("failed running checkpoint pauses a durable batch without mutating its target", async () => {
  const { env, engine } = fixture();
  env.journalError = (jobs) => jobs[0]?.status === "running";
  await engine.submitOperation(spec());
  const job = await finished(engine, "operation");
  assert.equal(job.status, "queued");
  assert.match(job.executionError.message, /Journal unavailable/);
  assert.equal(env.writes.length, 0);
  env.journalError = null;
  await engine.resumeOperations();
});

test("a failure after the browser write leaves recoverable intent instead of replaying blindly", async () => {
  const { env, engine, options } = fixture();
  env.journalError = (jobs) => jobs[0]?.items[0].state === "applied";
  await engine.submitOperation(spec());
  await engine.resumeOperations();
  assert.equal(env.jobs[0].items[0].state, "running");
  assert.equal(env.values.get("flag").value, "after");
  assert.equal(env.writes.length, 1);
  env.journalError = null;
  const restarted = createOperationEngine(options);
  const recovered = await finished(restarted, "operation");
  assert.equal(recovered.items[0].state, "applied");
  assert.equal(recovered.items[0].recovered, true);
  assert.equal(env.writes.length, 1);
});

for (const current of ["before", "after", "external"]) {
  test(`worker recovery reconciles a running item with actual value ${current}`, async () => {
    const { env, options } = fixture(value(current));
    const job = spec();
    const item = normalizeOperationItem(job.items[0], TARGET);
    env.jobs = [{ ...job, createdAt: "2026-09-10T00:00:00.000Z", status: "running", action: "apply", revision: 1, items: [{ ...item, state: "running", writeUncertain: true }] }];
    const engine = createOperationEngine(options);
    const result = await finished(engine, job.id);
    assert.equal(result.items[0].state, current === "external" ? "conflict" : "applied");
    assert.equal(env.writes.length, current === "before" ? 1 : 0);
    assert.equal(env.values.get("flag").value, current === "before" ? "after" : current);
    if (current === "after") assert.equal(result.items[0].recovered, true);
  });
}

test("retry applies failed items against the original before state and preserves successful items", async () => {
  const { env, engine } = fixture();
  env.writeError = new Error("Temporary browser failure");
  await engine.submitOperation(spec());
  const failed = await finished(engine, "operation");
  assert.equal(failed.items[0].state, "failed");
  env.writeError = null;
  await engine.retryOperation("operation");
  const retried = await finished(engine, "operation");
  assert.equal(retried.items[0].state, "applied");
  assert.deepEqual(retried.items[0].before, value("before"));
  assert.equal(env.writes.length, 1);
  await engine.retryOperation("operation");
  assert.equal(env.writes.length, 1);
});

test("retry never replaces data written after an earlier failure", async () => {
  const { env, engine } = fixture();
  env.writeError = new Error("Temporary browser failure");
  await engine.submitOperation(spec());
  await finished(engine, "operation");
  env.writeError = null;
  env.values.set("flag", value("external"));
  await engine.retryOperation("operation");
  const retried = await finished(engine, "operation");
  assert.equal(retried.items[0].state, "conflict");
  assert.equal(env.values.get("flag").value, "external");
  assert.equal(env.writes.length, 0);
});

test("undo supports a same-origin replacement tab for Local Storage and preserves original target", async () => {
  const { env, engine } = fixture();
  await engine.submitOperation(spec());
  await finished(engine, "operation");
  const replacement = { ...TARGET, tabId: 2, url: "https://example.com/second" };
  await engine.undoOperation("operation", { target: replacement });
  const result = await finished(engine, "operation");
  assert.equal(result.items[0].state, "undone");
  assert.equal(env.values.get("flag").value, "before");
  assert.equal(env.writes.at(-1).target.tabId, 2);
  assert.deepEqual(result.target, TARGET);
});

test("undo detects edits made after applying and keeps their current value", async () => {
  const { env, engine } = fixture();
  await engine.submitOperation(spec());
  await finished(engine, "operation");
  env.values.set("flag", value("external"));
  await engine.undoOperation("operation");
  const result = await finished(engine, "operation");
  assert.equal(result.items[0].state, "undo-conflict");
  assert.equal(env.values.get("flag").value, "external");
  assert.equal(env.writes.length, 1);
});

test("selective undo only touches requested entries and remains recoverable", async () => {
  const { env, engine } = fixture();
  env.values.set("other", { ...value("old"), key: "other" });
  const request = spec();
  request.items.push({ id: "other", kind: "localStorage", name: "other", before: { ...value("old"), key: "other" }, after: { ...value("new"), key: "other" } });
  await engine.submitOperation(request);
  await finished(engine, "operation");
  await engine.undoOperation("operation", { itemIds: ["flag"] });
  const result = await finished(engine, "operation");
  assert.deepEqual(result.items.map((item) => item.state), ["undone", "applied"]);
  assert.equal(env.values.get("other").value, "new");
});

test("Session Storage undo requires the original tab and every undo keeps browsing scope", async () => {
  const { engine } = fixture();
  const request = spec();
  request.items[0].kind = "sessionStorage";
  await engine.submitOperation(request);
  await finished(engine, "operation");
  await assert.rejects(engine.undoOperation("operation", { target: { ...TARGET, tabId: 2 } }), /original tab/);
  await assert.rejects(engine.undoOperation("operation", { target: { ...TARGET, incognito: true } }), /browsing mode/);
  await assert.rejects(engine.undoOperation("operation", { target: { ...TARGET, cookieStoreId: "1" } }), /cookie store/);
});

for (const current of ["after", "before", "external"]) {
  test(`worker recovery reconciles an undoing item with actual value ${current}`, async () => {
    const { env, options } = fixture(value(current));
    const job = spec();
    const item = normalizeOperationItem(job.items[0], TARGET);
    env.jobs = [{ ...job, createdAt: "2026-09-10T00:00:00.000Z", status: "running", action: "undo", revision: 1, items: [{ ...item, state: "undoing", writeUncertain: true }] }];
    const engine = createOperationEngine(options);
    const result = await finished(engine, job.id);
    assert.equal(result.items[0].state, current === "external" ? "undo-conflict" : "undone");
    assert.equal(env.writes.length, current === "after" ? 1 : 0);
    assert.equal(env.values.get("flag").value, current === "after" ? "before" : current);
  });
}

test("local summary errors do not fail durable session operations", async () => {
  const { env, engine } = fixture();
  env.summaryError = new Error("Local storage full");
  await engine.submitOperation(spec());
  const result = await finished(engine, "operation");
  assert.equal(result.items[0].state, "applied");
});

test("forget removes only a completed journal entry and never changes site data", async () => {
  const { env, engine } = fixture();
  await engine.submitOperation(spec());
  await finished(engine, "operation");
  await engine.forgetOperation("operation");
  assert.equal(await engine.getOperation("operation"), null);
  assert.equal(env.values.get("flag").value, "after");
  const active = fixture();
  active.env.jobs = [{ ...spec("active"), status: "running" }];
  await assert.rejects(active.engine.forgetOperation("active"), /Wait for the operation/);
});

test("all-skipped batches complete without changing any data", async () => {
  const { env, engine } = fixture();
  const request = { ...spec(), items: [], skipped: [{ id: "flag", reason: "Existing item was kept." }] };
  await engine.submitOperation(request);
  const job = await finished(engine, request.id);
  assert.equal(job.status, "completed");
  assert.deepEqual(job.skipped, request.skipped);
  assert.equal(env.writes.length, 0);
});

test("duplicate stable items are rejected even when they use distinct request IDs", async () => {
  const { env, engine } = fixture();
  const request = spec();
  request.items.push({ ...request.items[0], id: "another-id" });
  await assert.rejects(engine.submitOperation(request), /same site data item/);
  assert.equal(env.jobs.length, 0);
  assert.equal(env.writes.length, 0);
});

test("fresh multi-item undo does not treat untouched later items as recovered", async () => {
  const { env, engine } = fixture();
  env.values.set("other", { ...value("old"), key: "other" });
  const request = spec();
  request.items.push({ id: "other", kind: "localStorage", name: "other", before: { ...value("old"), key: "other" }, after: { ...value("new"), key: "other" } });
  await engine.submitOperation(request);
  await finished(engine, request.id);
  env.values.set("flag", value("before"));
  await engine.undoOperation(request.id);
  const job = await finished(engine, request.id);
  assert.deepEqual(job.items.map((item) => item.state), ["undo-conflict", "undone"]);
  assert.equal(job.items[0].recovered, undefined);
});

test("normalized cookie expirations keep requestedAfter for idempotency and use actual after for undo", async () => {
  const original = {
    name: "token", value: "old", domain: "example.com", path: "/", session: false,
    expirationDate: 1800000000, secure: false, httpOnly: false, sameSite: "lax", storeId: "0", hostOnly: true
  };
  const { env, options } = fixture(original);
  const request = { ...spec(), items: [{ id: "flag", kind: "cookies", name: "token", before: original, after: { ...original, value: "new", expirationDate: 2200000000 } }] };
  const write = options.adapter.compareAndWrite;
  options.adapter.compareAndWrite = async (item, target, expected, desired) => {
    const actual = desired.value === "new" ? { ...desired, expirationDate: 1900000000 } : desired;
    await write(item, target, expected, actual);
    return actual;
  };
  const engine = createOperationEngine(options);
  await engine.submitOperation(request);
  const applied = await finished(engine, request.id);
  assert.equal(applied.items[0].normalized, true);
  assert.equal(applied.items[0].after.expirationDate, 1900000000);
  assert.equal(applied.items[0].requestedAfter.expirationDate, 2200000000);
  assert.equal((await engine.submitOperation(request)).status, "completed");
  await engine.undoOperation(request.id);
  const undone = await finished(engine, request.id);
  assert.equal(undone.items[0].state, "undone");
  assert.equal(env.values.get("flag").expirationDate, original.expirationDate);
});

test("target navigation fails each unattempted item without changing its site", async () => {
  const { env, engine } = fixture();
  env.afterMutation = async () => { env.verifyError = new Error("The target tab changed sites."); };
  const request = spec();
  env.values.set("other", { ...value("old"), key: "other" });
  request.items.push({ id: "other", kind: "localStorage", name: "other", before: { ...value("old"), key: "other" }, after: { ...value("new"), key: "other" } });
  await engine.submitOperation(request);
  const result = await finished(engine, "operation");
  assert.deepEqual(result.items.map((item) => item.state), ["applied", "failed"]);
  assert.equal(env.writes.length, 1);
});
