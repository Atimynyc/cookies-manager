import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { messageKey } from "../src/shared/i18n.js";
import { UI_LANGUAGES } from "../src/shared/ui-preferences.js";
import { collectUiMessages } from "./i18n-source.mjs";

const locales = UI_LANGUAGES.map(language => language.value);
const load = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const base = await load("_locales/en/messages.json");
const keys = Object.keys(base).sort();
const errors = [];
for (const unit of await collectUiMessages()) {
  assert.ok(base[unit.key], `Missing source message: ${unit.source} (${unit.files.join(", ")})`);
  assert.equal(base[unit.key].description, unit.source, `Source message changed: ${unit.key}`);
}
const slots = message => [...message.matchAll(/\$slot_[1-9]\$/g)].map(match => match[0]).sort();
for (const locale of locales) {
  const catalog = await load(`_locales/${locale}/messages.json`);
  try {
    assert.deepEqual(Object.keys(catalog).sort(), keys, `${locale}: missing or unexpected message keys`);
    assert.ok(catalog.extensionDescription.message.length <= 132, `${locale}: extension description exceeds Chrome's 132-character limit`);
    const storeLocale = { zh_CN: "zh-CN", zh_TW: "zh-TW", pt_BR: "pt-BR" }[locale] || locale;
    const listing = await readFile(new URL(`../store-assets/store-listing-${storeLocale}.txt`, import.meta.url), "utf8");
    const paragraphs = listing.trim().split(/\r?\n\s*\r?\n/);
    assert.equal(paragraphs.length, 12, `${locale}: incomplete store listing`);
    assert.ok(paragraphs[2].trim().length <= 80, `${locale}: store short description exceeds 80 characters`);
    for (const [key, entry] of Object.entries(catalog)) {
      assert.ok(entry.message?.trim(), `${locale}/${key}: empty translation`);
      if (key.startsWith("m_")) assert.equal(key, messageKey(base[key].description));
      assert.deepEqual(slots(entry.message), slots(base[key].message), `${locale}/${key}: changed placeholders`);
      assert.deepEqual(entry.placeholders, base[key].placeholders, `${locale}/${key}: changed placeholder definitions`);
      assert.ok(!/\{\{(?:ARG|TERM)\d+\}\}/.test(entry.message), `${locale}/${key}: unreplaced translation marker`);
    }
    console.log(`${locale}: ${keys.length} messages verified`);
  } catch (error) { errors.push(error); }
}
const manifest = await load("manifest.json");
assert.equal(manifest.default_locale, "en");
assert.equal(manifest.name, "__MSG_extensionName__");
assert.equal(manifest.description, "__MSG_extensionDescription__");
if (errors.length) throw new AggregateError(errors, "Locale verification failed");
