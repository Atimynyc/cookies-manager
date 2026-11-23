import assert from "node:assert/strict";
import test from "node:test";
import { getSiteCookiePermissionPatterns } from "../../src/shared/url.js";
import { hasSitePermission, requestSitePermission } from "../../src/shared/cookie-api.js";

test("site cookie access covers both schemes and exact parent domains", () => {
  assert.deepEqual(getSiteCookiePermissionPatterns("https://tools.z-trip.cn/dashboard"), [
    "http://tools.z-trip.cn/*", "https://tools.z-trip.cn/*", "http://z-trip.cn/*", "https://z-trip.cn/*"
  ]);
  assert.deepEqual(getSiteCookiePermissionPatterns("http://a.b.example.co.uk:8080/"), [
    "http://a.b.example.co.uk/*", "https://a.b.example.co.uk/*", "http://b.example.co.uk/*", "https://b.example.co.uk/*",
    "http://example.co.uk/*", "https://example.co.uk/*", "http://co.uk/*", "https://co.uk/*"
  ]);
});

test("IP, IPv6 and local hosts never produce suffix or sibling permissions", () => {
  for (const [url, host] of [
    ["http://127.0.0.1:8080/", "127.0.0.1"],
    ["http://[::1]:8080/", "[::1]"],
    ["http://localhost:8080/", "localhost"],
    ["https://example.com/", "example.com"]
  ]) assert.deepEqual(getSiteCookiePermissionPatterns(url), [`http://${host}/*`, `https://${host}/*`]);
  assert.deepEqual(getSiteCookiePermissionPatterns("chrome://extensions"), []);
});

test("permission checks and requests require the same complete cookie scope", async (t) => {
  const previousChrome = globalThis.chrome;
  const calls = [];
  const expected = { origins: ["http://tools.z-trip.cn/*", "https://tools.z-trip.cn/*", "http://z-trip.cn/*", "https://z-trip.cn/*"] };
  globalThis.chrome = {
    runtime: {}, permissions: {
      contains(options, callback) { calls.push(options); callback(false); },
      request(options, callback) { calls.push(options); callback(true); }
    }
  };
  t.after(() => {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  });
  assert.equal(await hasSitePermission("https://tools.z-trip.cn/"), false);
  assert.equal(await requestSitePermission("https://tools.z-trip.cn/"), true);
  assert.deepEqual(calls, [expected, expected]);
});
