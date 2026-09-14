import CountryCodeSelect from "./CountryCodeSelect.jsx";
import { EMERGENCY_SOURCES, deriveEmergencyContact } from "./contactModel.js";

const inputClass = (error) => `w-full min-w-0 px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-300 disabled:bg-gray-100 ${error ? "border-red-500 bg-red-50" : "border-gray-300 bg-white"}`;
const Required = () => <span className="text-red-500" aria-hidden="true">*</span>;

function Field({ name, label, form, errors, onChange, onBlur, type = "text", multiline }) {
  const Input = multiline ? "textarea" : "input";
  return <div className="min-w-0">
    <label htmlFor={name} className="block text-lg font-bold text-gray-700 mb-2">{label} <Required /></label>
    <Input id={name} name={name} value={form[name]} onChange={onChange} onBlur={onBlur} {...(multiline ? { rows: 3 } : { type })} aria-required="true" aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `${name}-error` : undefined} className={inputClass(errors[name])} />
    {errors[name] && <p id={`${name}-error`} className="text-red-600 text-sm mt-1">{errors[name]}</p>}
  </div>;
}

function Phone({ prefix, label, form, errors, onChange, onBlur }) {
  const country = `${prefix}MobileCountry`;
  const mobile = `${prefix}Mobile`;
  const describedBy = `${mobile}-help ${mobile}-error`;
  return <div className="min-w-0">
    <label htmlFor={mobile} className="block text-lg font-bold text-gray-700 mb-2">{label} <Required /></label>
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] sm:grid-cols-[8.75rem_minmax(0,1fr)] gap-2">
      <CountryCodeSelect id={country} name={country} value={form[country]} onChange={onChange} onBlur={onBlur} aria-label={`${label} country code`} aria-required="true" aria-invalid={Boolean(errors[country])} aria-describedby={describedBy} className={inputClass(errors[country])} />
      <input id={mobile} name={mobile} type="tel" inputMode="numeric" maxLength={15} value={form[mobile]} onChange={onChange} onBlur={onBlur} placeholder="Phone number" aria-required="true" aria-invalid={Boolean(errors[mobile])} aria-describedby={describedBy} className={inputClass(errors[mobile])} />
    </div>
    <p id={`${mobile}-help`} className="text-sm text-gray-600 mt-1">Enter the number without the selected country code.</p>
    <p id={`${mobile}-error`} className="text-red-600 text-sm mt-1">{errors[country] || errors[mobile]}</p>
  </div>;
}

function Radios({ name, label, options, form, errors, onChange, onBlur }) {
  return <fieldset className="min-w-0" aria-describedby={errors[name] ? `${name}-error` : undefined}>
    <legend className="text-lg font-bold text-gray-700 mb-3">{label} <Required /></legend>
    <div className="flex flex-wrap gap-x-6 gap-y-3">
      {options.map((option) => {
        const disabled = option === "Jaipur Local Contact" && form.hasJaipurContact !== "Yes";
        return <label key={option} className={`flex items-center gap-2 ${disabled ? "text-gray-500" : "text-gray-700"}`}>
          <input type="radio" name={name} value={option} checked={form[name] === option} disabled={disabled} onChange={onChange} onBlur={onBlur} required aria-invalid={Boolean(errors[name])} className="text-blue-500 focus:ring-blue-300" />
          {option}{disabled ? " (add a Jaipur contact first)" : ""}
        </label>;
      })}
    </div>
    {errors[name] && <p id={`${name}-error`} className="text-red-600 text-sm mt-2">{errors[name]}</p>}
  </fieldset>;
}

export default function ContactDetails({ form, errors, sectionRef, onChange, onBlur }) {
  const shared = { form, errors, onChange, onBlur };
  const emergency = deriveEmergencyContact(form);
  return <section className="mb-12" ref={sectionRef} aria-labelledby="contacts-heading">
    <h3 id="contacts-heading" className="text-2xl font-bold mb-3 pb-3 text-[#003366]">2. Contact Details</h3>
    <div className="space-y-8">
      {[["father", "Father"], ["mother", "Mother"]].map(([prefix, label]) => <fieldset key={prefix} className="min-w-0">
        <legend className="text-xl font-bold text-[#003366] mb-4">{label}</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field name={`${prefix}Name`} label={`${label}'s Name`} {...shared} />
          <Phone prefix={prefix} label={`${label}'s Mobile Number`} {...shared} />
          <Field name={`${prefix}Email`} label={`${label}'s E-mail ID`} type="email" {...shared} />
          <Field name={`${prefix}Occupation`} label={`${label}'s Occupation`} {...shared} />
        </div>
      </fieldset>)}
      <section className="space-y-5" aria-labelledby="jaipur-heading">
        <h4 id="jaipur-heading" className="text-xl font-bold text-[#003366]">Jaipur Local Contact</h4>
        <Radios name="hasJaipurContact" label="Do you have a relative, local guardian, or known contact in Jaipur?" options={["Yes", "No"]} {...shared} />
        {form.hasJaipurContact === "Yes" && <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field name="jaipurContactName" label="Full Name" {...shared} />
          <Field name="jaipurContactRelationship" label="Relationship with Student" {...shared} />
          <Phone prefix="jaipurContact" label="Mobile Number" {...shared} />
          <Field name="jaipurContactAddress" label="Address in Jaipur" multiline {...shared} />
        </div>}
      </section>
      <section className="space-y-5" aria-labelledby="emergency-heading">
        <h4 id="emergency-heading" className="text-xl font-bold text-[#003366]">Emergency Contact Details</h4>
        <Radios name="emergencyContactSource" label="Who Should be Contacted in Case of an Emergency?" options={EMERGENCY_SOURCES} {...shared} />
        {form.emergencyContactSource === "Other" && <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Field name="emergencyOtherName" label="Emergency Contact Name" {...shared} />
          <Field name="emergencyOtherRelationship" label="Relationship with Student" {...shared} />
          <Phone prefix="emergencyOther" label="Emergency Contact Mobile Number" {...shared} />
        </div>}
        {emergency && form.emergencyContactSource !== "Other" && <div className="rounded-xl border-l-4 border-[#f4b221] bg-amber-50 p-4 text-gray-800 break-words" aria-live="polite">
          <p className="font-bold">Selected emergency contact: {emergency.source}</p>
          <p>{emergency.name || "Enter the contact name above"}</p>
          <p>{emergency.relationship}{emergency.mobile ? ` · ${emergency.countryCode} ${emergency.mobile}` : " · Enter the mobile number above"}</p>
          <p className="text-sm mt-2">These details update automatically from the contact information above.</p>
        </div>}
      </section>
    </div>
  </section>;
}
