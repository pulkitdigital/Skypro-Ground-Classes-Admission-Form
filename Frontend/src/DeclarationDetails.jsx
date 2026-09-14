import UploadField from "./UploadField";
import { UPLOAD_FIELDS } from "./formState";
import useCurrentDate from "./useCurrentDate.js";

const paragraphs = [
  "I declare that the information provided by me in this admission form is true and correct to the best of my knowledge. I understand that providing incorrect or misleading information may affect my enrollment.",
  "I understand that submission of this form constitutes my enrollment with the SkyPro Aviation Ground School and does not, by itself, guarantee any DGCA examination result, licence, medical certification, or other regulatory approval.",
  "I confirm that all documents submitted/uploaded by me are genuine and belong to me.",
  "I acknowledge that I have read and accepted the applicable course terms, fee policy, cancellation/refund policy, and student guidelines.",
  "I consent to SkyPro Aviation collecting, storing, and using the information and documents submitted by me for the purposes of admission, student administration, academic records, fee/payment administration, and course-related communication.",
];

export default function DeclarationDetails({ fullName, accepted, onAccept, sectionRef, files, errors, fileErrors, validatingFiles, onFile }) {
  const today = useCurrentDate();
  const error = errors.declarationAccepted;
  return (
    <section className="mb-12" ref={sectionRef} aria-labelledby="declaration-heading">
      <h3 id="declaration-heading" className="text-2xl font-bold mb-3 pb-3 text-[#003366]">6. Declaration &amp; Undertaking</h3>
      <div className={`bg-blue-50 border-2 rounded-2xl p-5 sm:p-8 ${error ? "border-red-400" : "border-blue-200"}`}>
        <div className="space-y-4 text-gray-800 leading-relaxed">
          {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
        <label htmlFor="declarationAccepted" className="flex items-start gap-3 mt-6 text-gray-800 font-medium">
          <input
            id="declarationAccepted" name="declarationAccepted" type="checkbox" required checked={accepted} onChange={onAccept}
            aria-invalid={Boolean(error)} aria-describedby={error ? "declarationAccepted-error" : undefined}
            className="mt-1 h-4 w-4 shrink-0 text-blue-500 focus:ring-blue-300"
          />
          <span>I confirm that I have read, understood, and agree to the above Declaration &amp; Undertaking. <span className="text-red-500" aria-hidden="true">*</span></span>
        </label>
        {error && <p id="declarationAccepted-error" className="text-red-600 text-sm mt-2">{error}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-6">
        <div>
          <label htmlFor="declaration-name" className="block text-lg font-bold text-gray-700 mb-2">Student Full Name</label>
          <input id="declaration-name" value={fullName} readOnly className="w-full min-w-0 px-4 py-3 border border-gray-300 rounded-xl bg-gray-100" />
        </div>
        <div>
          <label htmlFor="declaration-date" className="block text-lg font-bold text-gray-700 mb-2">Date</label>
          <input id="declaration-date" type="date" value={today} readOnly className="w-full min-w-0 px-4 py-3 border border-gray-300 rounded-xl bg-gray-100" />
        </div>
        {Object.entries(UPLOAD_FIELDS).filter(([, rule]) => rule.section === "declaration").map(([name, rule]) => (
          <UploadField key={name} name={name} rule={rule} file={files[name]} error={fileErrors[name] || errors[name]} pending={validatingFiles[name]} onChange={onFile} />
        ))}
      </div>
    </section>
  );
}
