import test from "node:test";
import assert from "node:assert/strict";
import { PHONE_COUNTRIES, searchPhoneCountries } from "./studentDetailsModel.js";
import { normalizeForm } from "./formState.js";

test("country code search finds India by name, dial code and ISO code", () => {
  for (const query of ["i", "in", "IN", "ind", " ind ", "India", "INDIA", "+91", "91", " +91 "]) {
    assert.equal(searchPhoneCountries(query)[0]?.country, "IN", JSON.stringify(query));
  }
});

test("country code search handles other countries, empty and unmatched queries", () => {
  assert.equal(searchPhoneCountries("singa")[0].country, "SG");
  assert.equal(searchPhoneCountries("+65")[0].country, "SG");
  assert.equal(searchPhoneCountries("gb")[0].country, "GB");
  assert.equal(searchPhoneCountries("united kingdom")[0].country, "GB");
  assert.equal(searchPhoneCountries("cote")[0].country, "CI", "accent-insensitive");
  assert.ok(searchPhoneCountries("+1").every((item) => item.callingCode.startsWith("+1")));
  assert.equal(searchPhoneCountries("   ").length, PHONE_COUNTRIES.length);
  assert.deepEqual(searchPhoneCountries("zzzz"), []);
});

test("India (+91) remains the default phone country", () => {
  const form = normalizeForm();
  for (const prefix of ["mobile", "fatherMobile", "motherMobile", "jaipurContactMobile", "emergencyOtherMobile"]) {
    assert.equal(form[`${prefix}Country`], "IN");
    assert.equal(form[`${prefix}CountryCode`], "+91");
  }
});
