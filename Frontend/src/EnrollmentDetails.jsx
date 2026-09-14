import { COURSE_OPTIONS, COMPLETE_PACKAGE, INDIVIDUAL_SUBJECTS, ENROLLMENT_SUBJECTS, CLASS_MODES } from "./enrollmentModel.js";

const Required = () => <span className="text-red-500" aria-hidden="true">*</span>;

export default function EnrollmentDetails({ form, errors, sectionRef, onChange, onBlur, onSubjectsChange }) {
  return (
    <section ref={sectionRef} className="mb-12" aria-labelledby="enrollment-heading">
      <h3 id="enrollment-heading" className="text-2xl font-bold mb-3 pb-3 text-[#003366]">4. Course &amp; Enrollment</h3>
      <div className="space-y-6">
        <fieldset className="min-w-0" aria-describedby={errors.courseSelection ? "courseSelection-error" : undefined}>
          <legend className="text-lg font-bold text-gray-700 mb-3">Course Selection <Required /></legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {COURSE_OPTIONS.map((option) => (
              <div key={option} className={`rounded-2xl border-2 p-4 sm:p-5 ${form.courseSelection === option ? "border-[#003366] bg-blue-50" : "border-gray-200"}`}>
                <label className="flex items-start gap-3 font-bold text-gray-800">
                  <input type="radio" name="courseSelection" value={option} checked={form.courseSelection === option} onChange={onChange} onBlur={onBlur} required aria-invalid={Boolean(errors.courseSelection)} className="mt-1 text-blue-500 focus:ring-blue-300" />
                  {option}
                </label>
                {option === COMPLETE_PACKAGE && <div className="mt-3 ml-7 text-gray-700">
                  <p className="font-semibold mb-2">Includes:</p>
                  <ul className="list-disc pl-5 space-y-1">{ENROLLMENT_SUBJECTS.map((subject) => <li key={subject}>{subject}</li>)}</ul>
                </div>}
              </div>
            ))}
          </div>
          {errors.courseSelection && <p id="courseSelection-error" className="text-red-600 text-sm mt-2">{errors.courseSelection}</p>}
        </fieldset>
        {form.courseSelection === INDIVIDUAL_SUBJECTS && (
          <fieldset className="min-w-0" aria-describedby={errors.individualSubjects ? "individualSubjects-error" : undefined}>
            <legend className="text-lg font-bold text-gray-700 mb-3">Select Individual Subject(s) <Required /><span className="sr-only"> (select at least one)</span></legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ENROLLMENT_SUBJECTS.map((subject) => <label key={subject} className="flex items-start gap-3 text-gray-700">
                <input type="checkbox" name="individualSubjects" value={subject} checked={form.individualSubjects.includes(subject)} onChange={onSubjectsChange} onBlur={onBlur} aria-invalid={Boolean(errors.individualSubjects)} className="mt-1 h-4 w-4 shrink-0 text-blue-500 focus:ring-blue-300" />
                {subject}
              </label>)}
            </div>
            {errors.individualSubjects && <p id="individualSubjects-error" className="text-red-600 text-sm mt-2">{errors.individualSubjects}</p>}
          </fieldset>
        )}
        <fieldset className="min-w-0" aria-describedby={errors.modeOfClass ? "modeOfClass-error" : undefined}>
          <legend className="text-lg font-bold text-gray-700 mb-3">Mode of Classes <Required /></legend>
          <div className="flex flex-wrap gap-6">
            {CLASS_MODES.map((mode) => <label key={mode} className="flex items-center gap-2 text-gray-700">
              <input type="radio" name="modeOfClass" value={mode} checked={form.modeOfClass === mode} onChange={onChange} onBlur={onBlur} required aria-invalid={Boolean(errors.modeOfClass)} className="text-blue-500 focus:ring-blue-300" />
              {mode}
            </label>)}
          </div>
          {errors.modeOfClass && <p id="modeOfClass-error" className="text-red-600 text-sm mt-2">{errors.modeOfClass}</p>}
        </fieldset>
        <div className="min-w-0">
          <label htmlFor="heardAboutSkypro" className="block text-lg font-bold text-gray-700 mb-2">How Did You Hear About SkyPro Aviation? <span className="font-normal text-gray-600">(optional)</span></label>
          <input id="heardAboutSkypro" name="heardAboutSkypro" value={form.heardAboutSkypro} onChange={onChange} placeholder="Optional" className="w-full min-w-0 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-300 disabled:bg-gray-100" />
        </div>
      </div>
    </section>
  );
}
