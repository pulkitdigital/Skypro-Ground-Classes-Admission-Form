import useCurrentDate from "./useCurrentDate.js";
import UploadField from "./UploadField";
import CountryCodeSelect from "./CountryCodeSelect.jsx";
import { UPLOAD_FIELDS } from "./formState";
import { NATIONALITIES, calculateAge } from "./studentDetailsModel.js";

const controlClass = (error) => `w-full min-w-0 px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-300 transition-all duration-200 ${error ? "border-red-500 bg-red-50" : "border-gray-300 bg-white"} disabled:bg-gray-100`;
const Required = () => <span className="text-red-500" aria-hidden="true">*</span>;

function Field({ name, label, value, error, onChange, onBlur, multiline, optional, ...props }) {
  const Input = multiline ? "textarea" : "input";
  return (
    <div className="min-w-0">
      <label htmlFor={name} className="block text-lg font-bold text-gray-700 mb-2">
        {label} {!optional && <Required />}
      </label>
      <Input
        id={name} name={name} value={value} onChange={onChange} onBlur={onBlur}
        aria-required={!optional} aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        className={controlClass(error)} {...(multiline ? { rows: 3 } : {})} {...props}
      />
      {error && <p id={`${name}-error`} className="text-red-600 text-sm mt-1">{error}</p>}
    </div>
  );
}

function RadioGroup({ name, label, options, value, error, onChange, onBlur }) {
  return (
    <fieldset className="min-w-0" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="text-lg font-bold text-gray-700 mb-2">{label} <Required /></legend>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 text-gray-700">
            <input type="radio" name={name} value={option} checked={value === option} onChange={onChange} onBlur={onBlur} required aria-invalid={Boolean(error)} className="text-blue-500 focus:ring-blue-300" />
            {option}
          </label>
        ))}
      </div>
      {error && <p id={`${name}-error`} className="text-red-600 text-sm mt-1">{error}</p>}
    </fieldset>
  );
}

export default function StudentDetails({ form, errors, files, fileErrors, validatingFiles, sameAddress, sectionRef, onChange, onBlur, onSameAddressChange, onFile }) {
  const today = useCurrentDate();

  const field = (name, label, props = {}) => (
    <Field name={name} label={label} value={form[name]} error={errors[name]} onChange={onChange} onBlur={onBlur} {...props} />
  );
  const upload = (name) => (
    <UploadField name={name} rule={UPLOAD_FIELDS[name]} file={files[name]} error={fileErrors[name] || errors[name]} pending={validatingFiles[name]} onChange={onFile} />
  );

  return (
    <section className="mb-12" ref={sectionRef} aria-labelledby="student-details-heading">
      <h3 id="student-details-heading" className="text-2xl font-bold mb-3 pb-3 text-[#003366]">1. Student Details</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="md:col-span-2">{field("fullName", "Full Name (as per official records)", { autoComplete: "name", placeholder: "Enter your full name" })}</div>
        {field("dob", "Date of Birth", { type: "date", max: today, autoComplete: "bday" })}
        <Field name="age" label="Age (years)" value={calculateAge(form.dob, new Date(`${today}T00:00:00`))} readOnly optional placeholder="Calculated from date of birth" />
        <RadioGroup name="gender" label="Gender" options={["Male", "Female"]} value={form.gender} error={errors.gender} onChange={onChange} onBlur={onBlur} />
        <div className="min-w-0">
          <label htmlFor="mobile" className="block text-lg font-bold text-gray-700 mb-2">Mobile Number (WhatsApp) <Required /></label>
          <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] sm:grid-cols-[8.75rem_minmax(0,1fr)] gap-2">
            <CountryCodeSelect
              id="mobileCountry" name="mobileCountry" value={form.mobileCountry} onChange={onChange} onBlur={onBlur}
              aria-label="Phone country code" aria-required="true" aria-invalid={Boolean(errors.mobileCountry)}
              aria-describedby={errors.mobileCountry ? "mobileCountry-error" : undefined} className={controlClass(errors.mobileCountry)}
            />
            <input
              id="mobile" name="mobile" type="tel" inputMode="numeric" autoComplete="tel-national"
              value={form.mobile} onChange={onChange} onBlur={onBlur} maxLength={15} placeholder="Phone number"
              aria-required="true" aria-invalid={Boolean(errors.mobile)} aria-describedby="mobile-help mobile-error"
              className={controlClass(errors.mobile)}
            />
          </div>
          <p id="mobile-help" className="text-sm text-gray-600 mt-1">Enter the number without the selected country code ({form.mobileCountryCode}).</p>
          {errors.mobileCountry && <p id="mobileCountry-error" className="text-red-600 text-sm mt-1">{errors.mobileCountry}</p>}
          <p id="mobile-error" className="text-red-600 text-sm mt-1">{errors.mobile}</p>
        </div>
        {field("email", "Email ID", { type: "email", autoComplete: "email", placeholder: "your@email.com" })}
        {upload("photo")}
        <div className="md:col-span-2">
          <RadioGroup name="nationality" label="Nationality" options={NATIONALITIES} value={form.nationality} error={errors.nationality} onChange={onChange} onBlur={onBlur} />
        </div>
        {form.nationality === "Foreign National" && (
          <fieldset className="md:col-span-2 min-w-0 rounded-2xl border border-blue-200 bg-blue-50/50 p-4 sm:p-6">
            <legend className="px-2 text-lg font-bold text-[#003366]">Foreign National Details</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {field("countryOfCitizenship", "Country of Citizenship", { placeholder: "Enter country of citizenship" })}
              {field("passportNumber", "Passport Number", { autoComplete: "off", placeholder: "Enter passport number" })}
              {field("passportExpiryDate", "Passport Expiry Date", { type: "date" })}
              {upload("passport")}
            </div>
          </fieldset>
        )}
        <fieldset className="md:col-span-2 min-w-0">
          <legend className="text-lg font-bold text-[#003366] mb-3">Permanent Address</legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {field("permanentState", "State", { autoComplete: "section-permanent address-level1" })}
            {field("permanentCity", "City", { autoComplete: "section-permanent address-level2" })}
            <div className="md:col-span-2">{field("permanentAddress", "Address", { multiline: true, autoComplete: "section-permanent street-address" })}</div>
          </div>
        </fieldset>
        <label htmlFor="sameAddress" className="md:col-span-2 flex items-start gap-3 text-gray-700 font-medium">
          <input id="sameAddress" name="sameAddress" type="checkbox" checked={sameAddress} onChange={onSameAddressChange} className="mt-1 h-4 w-4 shrink-0 text-blue-500 focus:ring-blue-300" />
          Current Address Same as Permanent Address
        </label>
        <fieldset className="md:col-span-2 min-w-0">
          <legend className="text-lg font-bold text-[#003366] mb-3">Current Address</legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {field("currentState", "State", { disabled: sameAddress, autoComplete: "section-current address-level1" })}
            {field("currentCity", "City", { disabled: sameAddress, autoComplete: "section-current address-level2" })}
            <div className="md:col-span-2">{field("currentAddress", "Address", { multiline: true, disabled: sameAddress, autoComplete: "section-current street-address" })}</div>
          </div>
        </fieldset>
      </div>
    </section>
  );
}
