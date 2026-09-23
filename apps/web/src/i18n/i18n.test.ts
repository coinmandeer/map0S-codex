import assert from "node:assert/strict";
import test from "node:test";
import { cs } from "./cs";
import { en } from "./en";
import { activeLocale, intlLocale, setActiveLocale, t } from "./index";

test("English and Czech describe exactly the same set of strings", () => {
  const czech = Object.keys(cs).sort();
  const english = Object.keys(en).sort();
  assert.deepEqual(english, czech, "a key present in one language and not the other");
  for (const key of english) {
    assert.notEqual(en[key as keyof typeof en].trim(), "", `${key} is empty in English`);
  }
});

test("the app opens in English and follows the reader's choice", () => {
  setActiveLocale("en");
  assert.equal(activeLocale(), "en");
  assert.equal(t("mode.planning"), "Planning");
  assert.equal(intlLocale(), "en-GB");

  setActiveLocale("cs");
  assert.equal(t("mode.planning"), "Plánování");
  assert.equal(intlLocale(), "cs-CZ");
  setActiveLocale("en");
});
