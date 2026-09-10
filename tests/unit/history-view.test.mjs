import assert from "node:assert/strict";
import test from "node:test";

import { createHistoryView, getSingleRangeDiff } from "../../src/popup/popup-history-view.js";
import { createOperationContext } from "../../src/shared/operation-context.js";

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

test("history disables Undo during reads and writes while retaining target restrictions", (t) => {
  const previousDocument = globalThis.document;
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const makeElement = () => ({
    children: [], dataset: {}, attributes: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {}
  });
  globalThis.document = { createElement: makeElement };
  const elements = Object.fromEntries([
    "historyList", "historyEmpty", "clearHistoryButton", "historyCountBadge", "historyViewButton", "historyDetail"
  ].map((name) => [name, makeElement()]));
  elements.historyDetail.hidden = true;
  const tab = { id: 11, url: "https://example.test/", incognito: false };
  const snapshot = {
    itemKind: "localStorage", storageType: "local", raw: { origin: "https://example.test" },
    target: createOperationContext(tab)
  };
  const state = {
    tab, cookieStoreId: "", recentChanges: [{
      id: "change", itemKind: "localStorage", storageType: "local", name: "key", timestamp: 1,
      origin: "https://example.test"
    }],
    undoSnapshots: new Map([["change", snapshot]]), unreadHistoryIds: new Set(), selectedHistoryId: ""
  };
  const view = createHistoryView({
    state, elements, getHistoryItemKind: () => "localStorage", onSelectHistoryView() {}, onUndo() {}
  });
  const undoButton = () => elements.historyList.children[0].children[1].children
    .find((element) => element.className === "history-undo-button");
  view.renderHistory();
  assert.equal(undoButton().disabled, false);
  for (const flag of ["busy", "loading"]) {
    state[flag] = true;
    view.renderHistory();
    assert.equal(undoButton().disabled, true);
    assert.equal(elements.clearHistoryButton.disabled, true);
    state[flag] = false;
  }
  delete snapshot.target;
  view.renderHistory();
  assert.equal(undoButton().disabled, true);
  assert.match(undoButton().title, /older change/);
  assert.equal(elements.clearHistoryButton.disabled, false);
});
