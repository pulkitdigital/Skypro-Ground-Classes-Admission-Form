import UploadField from "./UploadField";
import { UPLOAD_FIELDS, isUploadVisible } from "./formState";
import { QUALIFICATION_OPTIONS, PHYSICS_MATHEMATICS_OPTIONS } from "./educationModel.js";

const controlClass = (error) => `w-full min-w-0 px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-300 disabled:bg-gray-100 ${error ? "border-red-500 bg-red-50" : "border-gray-300 bg-white"}`;
const Required = () => <span className="text-red-500" aria-hidden="true">*</span>;

function Selection({ name, label, options, form, errors, onChange, onBlur }) {
  return (
    <div className="min-w-0">
      <label htmlFor={name} className="block text-lg font-bold text-gray-700 mb-2">{label} <Required /></label>
      <select id={name} name={name} value={form[name]} onChange={onChange} onBlur={onBlur} aria-required="true" aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `${name}-error` : undefined} className={controlClass(errors[name])}>
        <option value="">Please select an option</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      {errors[name] && <p id={`${name}-error`} className="text-red-600 text-sm mt-1">{errors[name]}</p>}
    </div>
  );
}

export default function EducationDetails({ form, errors, files, fileErrors, validatingFiles, sectionRef, onChange, onBlur, onFile }) {
  const shared = { form, errors, onChange, onBlur };
  const upload = (name) => <UploadField name={name} rule={UPLOAD_FIELDS[name]} file={files[name]} error={fileErrors[name] || errors[name]} pending={validatingFiles[name]} onChange={onFile} />;
  return (
    <section className="mb-12" ref={sectionRef} aria-labelledby="education-heading">
      <h3 id="education-heading" className="text-2xl font-bold mb-3 pb-3 text-[#003366]">3. Education Details</h3>
      <div className="space-y-6">
        <Selection name="highestQualification" label="Highest Educational Qualification" options={QUALIFICATION_OPTIONS} {...shared} />
        {form.highestQualification === "Other" && (
          <div className="min-w-0">
            <label htmlFor="otherQualification" className="block text-lg font-bold text-gray-700 mb-2">Please mention qualification <Required /></label>
            <input id="otherQualification" name="otherQualification" value={form.otherQualification} onChange={onChange} onBlur={onBlur} aria-required="true" aria-invalid={Boolean(errors.otherQualification)} aria-describedby={errors.otherQualification ? "otherQualification-error" : undefined} className={controlClass(errors.otherQualification)} />
            {errors.otherQualification && <p id="otherQualification-error" className="text-red-600 text-sm mt-1">{errors.otherQualification}</p>}
          </div>
        )}
        <Selection name="physicsMathematicsStatus" label="Physics & Mathematics at 10+2 Level" options={PHYSICS_MATHEMATICS_OPTIONS} {...shared} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {upload("marksheet10")}
          <div className="space-y-3 min-w-0">
            {upload("marksheet12")}
            <p className="rounded-xl border-l-4 border-[#f4b221] bg-amber-50 p-4 text-sm leading-relaxed text-gray-800">
              If you have completed Physics and Mathematics through NIOS or any other recognised board, please merge the relevant marksheet(s) with your Class 12 marksheet and upload them together as a single PDF file.
            </p>
          </div>
          {isUploadVisible("aadhar", form) && upload("aadhar")}
        </div>
      </div>
    </section>
  );
}
