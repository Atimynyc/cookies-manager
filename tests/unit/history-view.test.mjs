import assert from "node:assert/strict";
import test from "node:test";

import { getSingleRangeDiff } from "../../src/popup/popup-history-view.js";

test("finds the minimal changed range for history value previews", () => {
  assert.deepEqual(getSingleRangeDiff("prefix-old-suffix", "prefix-new-suffix"), {
    beforeStart: 7,
    beforeEnd: 10,
    afterStart: 7,
    afterEnd: 10
  });
  assert.deepEqual(getSingleRangeDiff("same", "same"), {
    beforeStart: 4,
    beforeEnd: 4,
    afterStart: 4,
    afterEnd: 4
  });
});
