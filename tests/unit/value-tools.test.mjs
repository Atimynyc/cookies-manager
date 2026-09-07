import assert from "node:assert/strict";
import test from "node:test";

import { classifyValueType } from "../../src/shared/value-tools.js";

const JWT = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiZGV2Iiwicm9sZXMiOlsicWEiXX0.";

test("classifies signed-token-shaped values as JWT", () => {
  assert.equal(classifyValueType(JWT), "jwt");
  assert.equal(classifyValueType(`Bearer ${JWT}`), "jwt");
});

test("classifies JSON objects and arrays, including URL-encoded JSON", () => {
  assert.equal(classifyValueType('{"enabled":true}'), "json");
  assert.equal(classifyValueType('["one",2]'), "json");
  assert.equal(classifyValueType("%7B%22enabled%22%3Atrue%7D"), "json");
});

test("does not mark plain values, JSON primitives, or malformed tokens", () => {
  for (const value of ["", "plain", "42", "true", "null", '"text"', "a.b.c", "e30.e30.extra.part"]) {
    assert.equal(classifyValueType(value), null, value);
  }
});
