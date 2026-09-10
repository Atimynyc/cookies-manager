import assert from "node:assert/strict";
import test from "node:test";
import { installWebLocks } from "../helpers/web-locks.mjs";
import { withStorageWriteLock } from "../../src/shared/storage-write-coordinator.js";

test("storage coordination requests exclusive locks and waits for asynchronous writes", async (t) => {
  const { requests } = installWebLocks(t);
  const events = [];
  let releaseFirst;
  const writing = new Promise((resolve) => { releaseFirst = resolve; });
  const first = withStorageWriteLock("profiles", async () => {
    events.push("first-read");
    await writing;
    events.push("first-write");
    return "first";
  });
  const second = withStorageWriteLock("profiles", async () => { events.push("second-read"); return "second"; });

  await Promise.resolve();
  assert.deepEqual(events, ["first-read"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(events, ["first-read", "first-write", "second-read"]);
  assert.ok(requests.every((request) => request.name === "cookie-controller:storage.local:profiles" && request.mode === "exclusive"));
});

test("failed storage writes release the key for the next update", async (t) => {
  installWebLocks(t);
  const failure = new Error("Write rejected");
  const first = withStorageWriteLock("profiles", async () => { throw failure; });
  const second = withStorageWriteLock("profiles", () => "next write");

  await assert.rejects(first, (error) => error === failure);
  assert.equal(await second, "next write");
});

test("storage writes on independent keys do not block each other", async (t) => {
  installWebLocks(t);
  let releaseFirst;
  const first = withStorageWriteLock("profiles", () => new Promise((resolve) => { releaseFirst = resolve; }));
  assert.equal(await withStorageWriteLock("favorites", () => "updated"), "updated");
  releaseFirst("done");
  assert.equal(await first, "done");
});

test("unavailable Web Locks rejects without attempting uncoordinated mutations", async (t) => {
  installWebLocks(t);
  delete navigator.locks;
  let called = false;

  await assert.rejects(withStorageWriteLock("profiles", () => { called = true; }), {
    code: "STORAGE_WRITE_COORDINATION_UNAVAILABLE"
  });
  assert.equal(called, false);
});
