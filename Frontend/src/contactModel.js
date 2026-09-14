import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { PHONE_COUNTRIES } from "./studentDetailsModel.js";

export const EMERGENCY_SOURCES = ["Mother", "Father", "Jaipur Local Contact", "Other"];
export const CONTACT_PHONE_PREFIXES = ["father", "mother", "jaipurContact", "emergencyOther"];
const phoneDefaults = (prefix) => ({ [`${prefix}MobileCountry`]: "IN", [`${prefix}MobileCountryCode`]: "+91", [`${prefix}Mobile`]: "" });
export const CONTACT_DEFAULTS = {
  fatherName: "", ...phoneDefaults("father"), fatherEmail: "", fatherOccupation: "",
  motherName: "", ...phoneDefaults("mother"), motherEmail: "", motherOccupation: "",
  hasJaipurContact: "", jaipurContactName: "", jaipurContactRelationship: "",
  ...phoneDefaults("jaipurContact"), jaipurContactAddress: "",
  emergencyContactSource: "", emergencyOtherName: "", emergencyOtherRelationship: "",
  ...phoneDefaults("emergencyOther"),
};
export const CONTACT_FIELDS = Object.keys(CONTACT_DEFAULTS);
export const CONTACT_MOBILE_FIELDS = CONTACT_PHONE_PREFIXES.map((prefix) => `${prefix}Mobile`);

export function hiddenContactFields(form) {
  return CONTACT_FIELDS.filter((key) =>
    (key.startsWith("jaipurContact") && form.hasJaipurContact !== "Yes")
    || (key.startsWith("emergencyOther") && form.emergencyContactSource !== "Other"));
}

export function sanitizeContacts(form, changedField) {
  const next = { ...form };
  if (next.hasJaipurContact !== "Yes" && next.emergencyContactSource === "Jaipur Local Contact") next.emergencyContactSource = "";
  CONTACT_PHONE_PREFIXES.forEach((prefix) => {
    const countryKey = `${prefix}MobileCountry`;
    const codeKey = `${prefix}MobileCountryCode`;
    const country = PHONE_COUNTRIES.find((item) => item.country === next[countryKey])
      || (changedField !== countryKey && PHONE_COUNTRIES.find((item) => item.callingCode === next[codeKey]))
      || PHONE_COUNTRIES.find((item) => item.country === "IN");
    next[countryKey] = country.country;
    next[codeKey] = country.callingCode;
  });
  hiddenContactFields(next).forEach((key) => { next[key] = ""; });
  return next;
}

function validatePhone(form, prefix, errors) {
  const countryKey = `${prefix}MobileCountry`;
  const mobileKey = `${prefix}Mobile`;
  const country = PHONE_COUNTRIES.find((item) => item.country === form[countryKey]);
  if (!country || country.callingCode !== form[`${prefix}MobileCountryCode`]) errors[countryKey] = "Please select a country code";
  const mobile = form[mobileKey];
  const phone = country && /^\d+$/.test(mobile) ? parsePhoneNumberFromString(mobile, country.country) : null;
  if (!mobile.trim()) errors[mobileKey] = "Mobile number is required";
  else if (!phone?.isPossible() || phone.countryCallingCode !== country?.callingCode.slice(1) || phone.number.length > 16) {
    errors[mobileKey] = "Enter a possible phone number for the selected country, without the country code";
  }
}

export function validateContacts(form) {
  const errors = {};
  const required = (key, label) => { if (!form[key].trim()) errors[key] = `${label} is required`; };
  for (const [prefix, label] of [["father", "Father"], ["mother", "Mother"]]) {
    required(`${prefix}Name`, `${label}'s name`);
    required(`${prefix}Occupation`, `${label}'s occupation`);
    required(`${prefix}Email`, `${label}'s email`);
    if (form[`${prefix}Email`].trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form[`${prefix}Email`].trim())) errors[`${prefix}Email`] = "Enter a valid email address";
    validatePhone(form, prefix, errors);
  }
  if (!["Yes", "No"].includes(form.hasJaipurContact)) errors.hasJaipurContact = "Please select whether you have a Jaipur contact";
  if (form.hasJaipurContact === "Yes") {
    required("jaipurContactName", "Full name");
    required("jaipurContactRelationship", "Relationship with student");
    required("jaipurContactAddress", "Address in Jaipur");
    validatePhone(form, "jaipurContact", errors);
  }
  if (!EMERGENCY_SOURCES.includes(form.emergencyContactSource)) errors.emergencyContactSource = "Please select one emergency contact";
  else if (form.emergencyContactSource === "Jaipur Local Contact" && form.hasJaipurContact !== "Yes") errors.emergencyContactSource = "Add a Jaipur local contact or select a different emergency contact";
  if (form.emergencyContactSource === "Other") {
    required("emergencyOtherName", "Emergency contact name");
    required("emergencyOtherRelationship", "Relationship with student");
    validatePhone(form, "emergencyOther", errors);
  }
  return errors;
}

export function deriveEmergencyContact(form) {
  const source = form.emergencyContactSource;
  const prefix = { Mother: "mother", Father: "father", "Jaipur Local Contact": "jaipurContact", Other: "emergencyOther" }[source];
  if (!prefix || (source === "Jaipur Local Contact" && form.hasJaipurContact !== "Yes")) return null;
  const country = PHONE_COUNTRIES.find((item) => item.country === form[`${prefix}MobileCountry`]);
  const phone = country && parsePhoneNumberFromString(form[`${prefix}Mobile`], country.country);
  return {
    source,
    name: form[`${prefix}Name`].trim(),
    relationship: source === "Mother" || source === "Father" ? source : form[`${prefix}Relationship`].trim(),
    countryCode: form[`${prefix}MobileCountryCode`],
    mobile: phone?.nationalNumber || form[`${prefix}Mobile`].trim(),
  };
}
