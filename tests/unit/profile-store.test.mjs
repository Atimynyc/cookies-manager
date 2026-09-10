import assert from "node:assert/strict";
import test from "node:test";

import { createSiteDataPackage } from "../../src/shared/site-data-package.js";
import {
  createSiteProfile,
  duplicateSiteProfile,
  normalizeSiteProfiles,
  renameSiteProfile
} from "../../src/shared/site-profiles.js";
import {
  getSiteProfiles,
  MAX_SITE_PROFILES,
  saveSiteProfiles,
  SITE_PROFILES_KEY
} from "../../src/shared/site-profile-store.js";

const dataPackage = createSiteDataPackage({
  url: "https://example.com/app",
  exportedAt: "2026-09-10T00:00:00.000Z",
  localStorage: [{ key: "theme", value: "dark" }]
});

function createProfiles(count) {
  return Array.from({ length: count }, (_, index) => createSiteProfile({
    id: `profile-${index}`,
    name: `State ${index}`,
    createdAt: "2026-09-10T00:00:00.000Z",
    dataPackage
  }));
}

function bytesForEntry(key, value) {
  const encoder = new TextEncoder();
  return encoder.encode(key).length + encoder.encode(JSON.stringify(value)).length;
}

function installStorage(t, profiles = [], options = {}) {
  const previousChrome = globalThis.chrome;
  const state = {
    data: structuredClone({ ...options.otherData, [SITE_PROFILES_KEY]: profiles }),
    writes: 0,
    byteQueries: []
  };
  globalThis.chrome = {
    runtime: {},
    storage: {
      local: {
        QUOTA_BYTES: options.quota ?? 10 * 1024 * 1024,
        get(defaults, callback) {
          callback(structuredClone({ ...defaults, ...state.data }));
        },
        getBytesInUse(keys, callback) {
          state.byteQueries.push(keys);
          const entries = keys === null
            ? Object.entries(state.data)
            : [[keys, state.data[keys]]].filter(([, value]) => value !== undefined);
          callback(entries.reduce((total, [key, value]) => total + bytesForEntry(key, value), 0));
        },
        set(values, callback) {
          state.writes += 1;
          if (options.writeError) {
            chrome.runtime.lastError = { message: options.writeError };
            callback();
            delete chrome.runtime.lastError;
            return;
          }
          Object.assign(state.data, structuredClone(values));
          callback();
        }
      }
    }
  };
  t.after(() => {
    if (previousChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = previousChrome;
    }
  });
  return state;
}

test("saved states keep all valid stored entries during normalization and loading", async (t) => {
  const profiles = createProfiles(52);
  const stored = [{ name: "invalid" }, ...profiles];
  const storage = installStorage(t, stored);
  assert.deepEqual(normalizeSiteProfiles(stored), profiles);
  assert.deepEqual(await getSiteProfiles(), profiles);
  assert.equal(storage.writes, 0);
  assert.deepEqual(storage.data[SITE_PROFILES_KEY], stored);
});

test("saving the 51st state rejects before writing and preserves every previous state", async (t) => {
  const profiles = createProfiles(MAX_SITE_PROFILES);
  const storage = installStorage(t, profiles);
  const newProfile = { ...profiles[0], id: "new-profile", name: "New state" };

  await assert.rejects(saveSiteProfiles([newProfile, ...profiles]), (error) => {
    assert.equal(error.code, "SAVED_STATE_LIMIT_REACHED");
    assert.match(error.message, /50 states/);
    assert.match(error.message, /Saved States list and delete unused states/);
    return true;
  });
  assert.equal(storage.writes, 0);
  assert.deepEqual(storage.data[SITE_PROFILES_KEY], profiles);
});

test("copying a state at the limit rejects without replacing the oldest state", async (t) => {
  const profiles = createProfiles(MAX_SITE_PROFILES);
  const storage = installStorage(t, profiles);
  const copied = duplicateSiteProfile(profiles[0]);

  await assert.rejects(saveSiteProfiles([copied, ...profiles]), { code: "SAVED_STATE_LIMIT_REACHED" });
  assert.equal(storage.writes, 0);
  assert.deepEqual(storage.data[SITE_PROFILES_KEY], profiles);
});

test("existing states above the limit can be renamed and deleted without truncation", async (t) => {
  const profiles = createProfiles(52);
  const storage = installStorage(t, profiles);
  const renamed = profiles.map((profile, index) => index === 51 ? renameSiteProfile(profile, "Renamed last state") : profile);

  assert.deepEqual(await saveSiteProfiles(renamed), renamed);
  assert.equal(storage.data[SITE_PROFILES_KEY].length, 52);
  assert.equal(storage.data[SITE_PROFILES_KEY][51].name, "Renamed last state");

  const reduced = renamed.filter((profile) => profile.id !== profiles[0].id);
  assert.deepEqual(await saveSiteProfiles(reduced), reduced);
  assert.equal(storage.data[SITE_PROFILES_KEY].length, 51);
  assert.deepEqual(storage.data[SITE_PROFILES_KEY], reduced);
});

test("an over-limit replacement cannot disguise a new state as a rename", async (t) => {
  const profiles = createProfiles(51);
  const storage = installStorage(t, profiles);
  const replacement = [{ ...profiles[0], id: "new-state" }, ...profiles.slice(1)];

  await assert.rejects(saveSiteProfiles(replacement), { code: "SAVED_STATE_LIMIT_REACHED" });
  assert.equal(storage.writes, 0);
  assert.deepEqual(storage.data[SITE_PROFILES_KEY], profiles);
});

test("saving and copying below the limit preserves all entries", async (t) => {
  const storage = installStorage(t);
  const profiles = createProfiles(1);
  assert.deepEqual(await saveSiteProfiles(profiles), profiles);

  const copied = duplicateSiteProfile(profiles[0]);
  assert.deepEqual(await saveSiteProfiles([copied, ...profiles]), [copied, ...profiles]);
  assert.equal(storage.writes, 2);
  assert.deepEqual(await getSiteProfiles(), [copied, ...profiles]);
});

test("quota preflight includes other local storage and preserves data when there is no space", async (t) => {
  const profiles = createProfiles(1);
  const otherData = { history: "x".repeat(1024) };
  const required = bytesForEntry("history", otherData.history) + bytesForEntry(SITE_PROFILES_KEY, profiles);
  const storage = installStorage(t, [], { otherData, quota: required - 1 });
  const before = structuredClone(storage.data);

  await assert.rejects(saveSiteProfiles(profiles), (error) => {
    assert.equal(error.code, "SAVED_STATE_QUOTA_EXCEEDED");
    assert.match(error.message, /Chrome limit:/);
    assert.match(error.message, /required:/);
    assert.match(error.message, /delete unused states/);
    return true;
  });
  assert.deepEqual(storage.byteQueries, [null, SITE_PROFILES_KEY]);
  assert.equal(storage.writes, 0);
  assert.deepEqual(storage.data, before);
});

test("quota preflight subtracts the replaced collection and counts UTF-8 values", async (t) => {
  const profiles = createProfiles(1);
  const renamed = [{ ...profiles[0], name: "\u4fdd\u5b58\u72b6\u6001" }];
  const quota = bytesForEntry(SITE_PROFILES_KEY, renamed);
  const storage = installStorage(t, profiles, { quota });

  assert.deepEqual(await saveSiteProfiles(renamed), renamed);
  assert.deepEqual(storage.data[SITE_PROFILES_KEY], renamed);
});

test("Chrome quota rejection stays actionable when space changes after preflight", async (t) => {
  const profiles = createProfiles(1);
  const message = "QUOTA_BYTES quota exceeded";
  const storage = installStorage(t, profiles, { writeError: message });
  const renamed = [renameSiteProfile(profiles[0], "Changed name")];

  await assert.rejects(saveSiteProfiles(renamed), (error) => {
    assert.equal(error.code, "SAVED_STATE_QUOTA_EXCEEDED");
    assert.match(error.message, /Extension storage is full/);
    assert.match(error.message, /delete unused states/);
    assert.equal(error.cause.message, message);
    return true;
  });
  assert.equal(storage.writes, 1);
  assert.deepEqual(storage.data[SITE_PROFILES_KEY], profiles);
});

test("unrelated Chrome storage errors are propagated without changing saved states", async (t) => {
  const profiles = createProfiles(1);
  const storage = installStorage(t, profiles, { writeError: "Extension context invalidated" });

  await assert.rejects(saveSiteProfiles([renameSiteProfile(profiles[0], "Changed name")]), {
    message: "Extension context invalidated"
  });
  assert.deepEqual(storage.data[SITE_PROFILES_KEY], profiles);
});
