import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from "libphonenumber-js/min";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export const PHONE_COUNTRIES = getCountries().map((country) => ({
  country,
  name: regionNames.of(country),
  callingCode: `+${getCountryCallingCode(country)}`,
})).sort((a, b) => a.name.localeCompare(b.name));

const searchText = (value) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

// Case- and accent-insensitive search by country name, dial code (with or without "+"),
// or ISO code. Exact ISO/dial-code matches rank first, then name prefixes; India wins ties.
export function searchPhoneCountries(query, countries = PHONE_COUNTRIES) {
  const text = searchText(query);
  if (!text) return countries;
  const digits = /^\+?\d+$/.test(text) ? text.replace("+", "") : "";
  const rank = (item) => {
    const name = searchText(item.name);
    const code = item.callingCode.slice(1);
    if (item.country.toLowerCase() === text || (digits && code === digits) || name === text) return 0;
    if (name.startsWith(text)) return 1;
    if (digits && code.startsWith(digits)) return 2;
    if (name.split(/[\s,()'’.-]+/).some((word) => word.startsWith(text))) return 3;
    return name.includes(text) ? 4 : -1;
  };
  return countries
    .map((item, index) => ({ item, index, score: rank(item) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score || (b.item.country === "IN") - (a.item.country === "IN") || a.index - b.index)
    .map(({ item }) => item);
}

export const NATIONALITIES = ["Indian National", "Foreign National"];
export const FOREIGN_FIELDS = ["countryOfCitizenship", "passportNumber", "passportExpiryDate"];
export const ADDRESS_PAIRS = {
  permanentState: "currentState",
  permanentCity: "currentCity",
  permanentAddress: "currentAddress",
};
export const STUDENT_FIELDS = [
  "fullName", "dob", "gender", "mobileCountry", "mobileCountryCode", "mobile", "email",
  "nationality", ...FOREIGN_FIELDS, ...Object.keys(ADDRESS_PAIRS), ...Object.values(ADDRESS_PAIRS),
];

export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Parse calendar components locally: parsing YYYY-MM-DD as UTC can shift birthdays.
function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return null;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function calculateAge(dob, today = new Date()) {
  const birth = parseDate(dob);
  if (!birth || dob > localDateString(today)) return "";
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth()
    || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
  return age;
}

export function synchronizeAddress(form) {
  return {
    ...form,
    ...Object.fromEntries(Object.entries(ADDRESS_PAIRS).map(([source, target]) => [target, form[source]])),
  };
}

export function updateFormField(form, name, value, sameAddress) {
  const next = { ...form, [name]: value };
  if (name === "mobileCountry") {
    next.mobileCountryCode = PHONE_COUNTRIES.find((item) => item.country === value)?.callingCode || "";
  }
  if (name === "nationality" && value !== "Foreign National") {
    FOREIGN_FIELDS.forEach((key) => { next[key] = ""; });
  }
  return sameAddress && name in ADDRESS_PAIRS ? synchronizeAddress(next) : next;
}

export function validateStudentDetails(form, today = new Date()) {
  const errors = {};
  if (!form.fullName.trim()) errors.fullName = "Full name is required";
  if (!form.dob) errors.dob = "Date of birth is required";
  else if (calculateAge(form.dob, today) === "") errors.dob = "Enter a valid date of birth that is not in the future";
  if (!["Male", "Female"].includes(form.gender)) errors.gender = "Please select gender";

  const country = PHONE_COUNTRIES.find((item) => item.country === form.mobileCountry);
  if (!country || country.callingCode !== form.mobileCountryCode) {
    errors.mobileCountry = "Please select a country code";
  }
  if (!form.mobile.trim()) errors.mobile = "Mobile number is required";
  else {
    const phone = country && /^\d+$/.test(form.mobile)
      ? parsePhoneNumberFromString(form.mobile, country.country) : null;
    if (!phone?.isPossible() || phone.countryCallingCode !== country?.callingCode.slice(1)
      || phone.number.length > 16) {
      errors.mobile = "Enter a possible phone number for the selected country, without the country code";
    }
  }
  if (!form.email.trim()) errors.email = "Email ID is required";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Enter a valid email address";
  if (!NATIONALITIES.includes(form.nationality)) errors.nationality = "Please select nationality";
  if (form.nationality === "Foreign National") {
    if (!form.countryOfCitizenship.trim()) errors.countryOfCitizenship = "Country of citizenship is required";
    if (!form.passportNumber.trim()) errors.passportNumber = "Passport number is required";
    if (!form.passportExpiryDate) errors.passportExpiryDate = "Passport expiry date is required";
    else if (!parseDate(form.passportExpiryDate)) errors.passportExpiryDate = "Enter a valid passport expiry date";
  }
  Object.entries(ADDRESS_PAIRS).forEach(([permanent, current]) => {
    const label = permanent === "permanentAddress" ? "address" : permanent.replace("permanent", "").toLowerCase();
    if (!form[permanent].trim()) errors[permanent] = `Permanent ${label} is required`;
    if (!form[current].trim()) errors[current] = `Current ${label} is required`;
  });
  return errors;
}
