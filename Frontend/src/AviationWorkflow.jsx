import UploadField from "./UploadField";
import { UPLOAD_FIELDS } from "./formState";
import { COMPUTER_NUMBER_OPTIONS, YES_NO_OPTIONS, MEDICAL_CLASSES, DGCA_SUBJECTS, aviationVisibility } from "./aviationWorkflowModel.js";

const Required = () => <span className="text-red-500" aria-hidden="true">*</span>;

function Choice({ name, label, options, form, errors, onChange, onBlur }) {
  return (
    <fieldset className="min-w-0" aria-describedby={errors[name] ? `${name}-error` : undefined}>
      <legend className="text-lg font-bold text-gray-700 mb-3">{label} <Required /></legend>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 text-gray-700">
            <input type="radio" name={name} value={option} checked={form[name] === option} onChange={onChange} onBlur={onBlur} required aria-invalid={Boolean(errors[name])} className="text-blue-500 focus:ring-blue-300" />
            {option}
          </label>
        ))}
      </div>
      {errors[name] && <p id={`${name}-error`} className="text-red-600 text-sm mt-2">{errors[name]}</p>}
    </fieldset>
  );
}

function Detail({ name, label, form, errors, onChange, onBlur, type = "text", describedBy }) {
  return (
    <div className="min-w-0">
      <label htmlFor={name} className="block text-lg font-bold text-gray-700 mb-2">{label} <Required /></label>
      <input
        id={name} name={name} value={form[name]} type={type} onChange={onChange} onBlur={onBlur}
        aria-required="true" aria-invalid={Boolean(errors[name])}
        aria-describedby={[describedBy, errors[name] && `${name}-error`].filter(Boolean).join(" ") || undefined}
        className={`w-full min-w-0 px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-300 disabled:bg-gray-100 ${errors[name] ? "border-red-500 bg-red-50" : "border-gray-300 bg-white"}`}
      />
      {errors[name] && <p id={`${name}-error`} className="text-red-600 text-sm mt-1">{errors[name]}</p>}
    </div>
  );
}

export default function AviationWorkflow({ form, errors, files, fileErrors, validatingFiles, sectionRef, onChange, onBlur, onSubjectsChange, onFile }) {
  const visible = aviationVisibility(form);
  const shared = { form, errors, onChange, onBlur };
  const upload = (name) => <UploadField name={name} rule={UPLOAD_FIELDS[name]} file={files[name]} error={fileErrors[name] || errors[name]} pending={validatingFiles[name]} onChange={onFile} />;
  const sectionClass = "space-y-5 rounded-2xl border border-blue-100 bg-blue-50/30 p-4 sm:p-6";

  return (
    <section className="mb-12" ref={sectionRef} aria-labelledby="aviation-heading">
      <h3 id="aviation-heading" className="text-2xl font-bold mb-3 pb-3 text-[#003366]">5. Aviation Background</h3>
      <div className="space-y-6">
        <section className={sectionClass} aria-labelledby="computer-number-heading">
          <h4 id="computer-number-heading" className="text-xl font-bold text-[#003366]">DGCA Computer Number</h4>
          <Choice name="hasDgcaComputerNumber" label="Do You Have a DGCA Computer Number?" options={COMPUTER_NUMBER_OPTIONS} {...shared} />
          {visible.dgcaComputerNumber && <Detail name="dgcaComputerNumber" label="Enter DGCA Computer Number" {...shared} />}
        </section>

        {visible.dgcaPapersCleared && (
          <section className={sectionClass} aria-labelledby="dgca-papers-heading">
            <h4 id="dgca-papers-heading" className="text-xl font-bold text-[#003366]">DGCA Papers</h4>
            <Choice name="dgcaPapersCleared" label="Have You Cleared Any DGCA Papers?" options={YES_NO_OPTIONS} {...shared} />
            {visible.dgcaSubjects && (
              <fieldset className="min-w-0" aria-describedby={errors.dgcaSubjects ? "dgcaSubjects-error" : undefined}>
                <legend className="text-lg font-bold text-gray-700 mb-3">Cleared DGCA Subjects <Required /><span className="sr-only"> (select at least one)</span></legend>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {DGCA_SUBJECTS.map((subject) => (
                    <label key={subject} className="flex items-start gap-3 text-gray-700">
                      <input type="checkbox" name="dgcaSubjects" value={subject} checked={form.dgcaSubjects.includes(subject)} onChange={onSubjectsChange} onBlur={onBlur} aria-invalid={Boolean(errors.dgcaSubjects)} className="mt-1 h-4 w-4 shrink-0 text-blue-500 focus:ring-blue-300" />
                      {subject}
                    </label>
                  ))}
                </div>
                {errors.dgcaSubjects && <p id="dgcaSubjects-error" className="text-red-600 text-sm mt-2">{errors.dgcaSubjects}</p>}
              </fieldset>
            )}
            {visible.dgcaExamResult && upload("dgcaExamResult")}
            {visible.dgcaExamResultDate && (
              <div className="space-y-3">
                <Detail name="dgcaExamResultDate" label="Exam Result Date" type="date" describedBy="exam-result-date-help" {...shared} />
                <div id="exam-result-date-help" className="rounded-xl border-l-4 border-[#f4b221] bg-amber-50 p-4 text-gray-800">
                  <p className="font-bold mb-2">To get the Exam Result Date:</p>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Log in to your eGCA portal</li>
                    <li>Click 'CPL' on the left menu</li>
                    <li>Go to Examination Details</li>
                  </ol>
                </div>
              </div>
            )}
          </section>
        )}

        <section className={sectionClass} aria-labelledby="egca-heading">
          <h4 id="egca-heading" className="text-xl font-bold text-[#003366]">eGCA</h4>
          <Choice name="hasEgcaId" label="Do You Have an eGCA ID?" options={YES_NO_OPTIONS} {...shared} />
          {visible.egcaId && <Detail name="egcaId" label="Enter eGCA ID" {...shared} />}
        </section>

        {visible.hasDgcaMedical && (
          <section className={sectionClass} aria-labelledby="medical-heading">
            <h4 id="medical-heading" className="text-xl font-bold text-[#003366]">DGCA Medical</h4>
            <Choice name="hasDgcaMedical" label="Do You Have a DGCA Medical?" options={YES_NO_OPTIONS} {...shared} />
            {visible.dgcaMedicalClass && <Choice name="dgcaMedicalClass" label="DGCA Medical Type" options={MEDICAL_CLASSES} {...shared} />}
            {visible.dgcaMedicalAssessment && upload("dgcaMedicalAssessment")}
          </section>
        )}

        <Choice name="previousFlyingExperience" label="Previous Flying Experience" options={YES_NO_OPTIONS} {...shared} />
      </div>
    </section>
  );
}
