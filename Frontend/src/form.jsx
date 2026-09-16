import { useState, useEffect, useRef } from "react";
import axios from "axios";
import ThankYouPopup from "./ThankYouPopup";
import DeclarationDetails from "./DeclarationDetails.jsx";
import StudentDetails from "./StudentDetails.jsx";
import AviationWorkflow from "./AviationWorkflow.jsx";
import EducationDetails from "./EducationDetails.jsx";
import ContactDetails from "./ContactDetails.jsx";
import EnrollmentDetails from "./EnrollmentDetails.jsx";
import { INDIVIDUAL_SUBJECTS, sanitizeEnrollment, validateEnrollment } from "./enrollmentModel.js";
import { CONTACT_MOBILE_FIELDS, CONTACT_PHONE_PREFIXES, sanitizeContacts, hiddenContactFields, validateContacts } from "./contactModel.js";
import { sanitizeEducation, validateEducation } from "./educationModel.js";
import { hiddenAviationFields, omitFields, sanitizeAviationForm, validateAviationWorkflow } from "./aviationWorkflowModel.js";
import { ADDRESS_PAIRS, FOREIGN_FIELDS, synchronizeAddress, updateFormField, validateStudentDetails } from "./studentDetailsModel.js";
import { FORM_NAME, DRAFT_VERSION, DRAFT_KEY, DRAFT_TIMESTAMP_KEY, DRAFT_TTL, UPLOAD_FIELDS, normalizeForm, readDraft, validateUpload, validateImageUpload, validateSelectedImages, validateFormUploads, isUploadVisible, createSubmission } from "./formState";
import { submissionFeedback } from "./submissionFeedback.js";

const PRISTINE_FORM = JSON.stringify(normalizeForm());
const SUCCESS_MESSAGE = "Your Ground School admission form has been submitted successfully. A confirmation has been sent to your registered email address.";
const EMPTY_STATUS = { type: "", message: "" };

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(DRAFT_TIMESTAMP_KEY);
  } catch { /* Keep the form usable without local storage. */ }
}

export default function GroundSchoolForm() {
  const [draft] = useState(() => {
    try { return readDraft(window.localStorage); }
    catch { return { form: normalizeForm(), sameAddress: false, disclaimerAccepted: false }; }
  });
  const [form, setForm] = useState(draft.form);
  const [files, setFiles] = useState({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [fileErrors, setFileErrors] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(draft.disclaimerAccepted);
  const [sameAddress, setSameAddress] = useState(draft.sameAddress);
  const [recaptchaLoaded, setRecaptchaLoaded] = useState(false);
  const [showThankYou, setShowThankYou] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [validatingFiles, setValidatingFiles] = useState({});

  const formRef = useRef(null);
  const statusRef = useRef(null);
  // Blocks a second submit before the disabled state has re-rendered.
  const submittingRef = useRef(false);
  const uploadVersions = useRef({});
  const studentDetailsRef = useRef(null);
  const parentDetailsRef = useRef(null);
  const academicDetailsRef = useRef(null);
  const enrollmentRef = useRef(null);
  const aviationBackgroundRef = useRef(null);
  const declarationRef = useRef(null);
  const recaptchaRef = useRef(null);

  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");

  // Save a draft only when there is something to restore; a reset form clears it.
  useEffect(() => {
    const pristine = JSON.stringify(form) === PRISTINE_FORM && !sameAddress && !disclaimerAccepted;
    if (pristine) {
      clearDraft();
      return undefined;
    }
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: DRAFT_VERSION, form, sameAddress, disclaimerAccepted }));
      localStorage.setItem(DRAFT_TIMESTAMP_KEY, Date.now().toString());
    } catch { /* Draft persistence is optional when browser storage is unavailable. */ }
    const timeout = setTimeout(clearDraft, DRAFT_TTL);
    return () => clearTimeout(timeout);
  }, [form, sameAddress, disclaimerAccepted]);

  // Load reCAPTCHA script
  useEffect(() => {
    window.onRecaptchaVerify = () => setFieldErrors((prev) => omitFields(prev, ["recaptcha"]));
    window.onRecaptchaExpired = () => {};

    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => setRecaptchaLoaded(true);
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
      delete window.onRecaptchaVerify;
      delete window.onRecaptchaExpired;
    };
  }, []);

  // Backend keep-alive
  useEffect(() => {
    const pingBackend = async () => {
      try {
        await fetch(`${API_URL}/health`);
        console.log("✓ Backend awake");
      } catch (error) {
        console.log("Ping failed:", error.message);
      }
    };

    pingBackend();
    const interval = setInterval(pingBackend, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [API_URL]);

  // Move keyboard focus to the first rendered (therefore visible) invalid control.
  // Conditional fields that are hidden are not rendered, so they are never targeted.
  useEffect(() => {
    if (!focusRequest) return;
    const root = formRef.current;
    const target = root?.querySelector('[aria-invalid="true"]:not(:disabled)') || root?.querySelector("[data-error-anchor]") || statusRef.current;
    if (!target) return;
    // Jump instantly: a smooth scroll across a long mobile page can be interrupted
    // and leave the focused field off-screen.
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: "auto", block: "center" });
  }, [focusRequest]);

  const handleChange = (e) => {
    const { name } = e.target;
    const value = (name === "mobile" || CONTACT_MOBILE_FIELDS.includes(name)) ? e.target.value.replace(/\D/g, "") : e.target.value;
    const nextForm = sanitizeEnrollment(sanitizeContacts(sanitizeEducation(sanitizeAviationForm(updateFormField(form, name, value, sameAddress))), name));
    setForm((prev) => sanitizeEnrollment(sanitizeContacts(sanitizeEducation(sanitizeAviationForm(updateFormField(prev, name, value, sameAddress))), name)));
    const hidden = [...hiddenAviationFields(nextForm), ...hiddenContactFields(nextForm)];
    if (nextForm.highestQualification !== "Other") hidden.push("otherQualification");
    if (nextForm.nationality !== "Indian National") hidden.push("aadhar");
    const cleared = [name];
    if (nextForm.courseSelection !== INDIVIDUAL_SUBJECTS) cleared.push("individualSubjects");
    if (name === "hasJaipurContact" && form.emergencyContactSource === "Jaipur Local Contact" && value !== "Yes") cleared.push("emergencyContactSource");
    CONTACT_PHONE_PREFIXES.forEach((prefix) => {
      if (name === prefix + "MobileCountry") cleared.push(prefix + "Mobile", prefix + "MobileCountryCode");
    });
    if (name === "mobileCountry") cleared.push("mobile", "mobileCountryCode");
    if (sameAddress && name in ADDRESS_PAIRS) cleared.push(ADDRESS_PAIRS[name]);
    if (name === "nationality" && value !== "Foreign National") hidden.push(...FOREIGN_FIELDS, "passport");

    // Hidden uploads and errors are removed together. Invalidate any pending file read too.
    hidden.forEach((key) => {
      if (key in UPLOAD_FIELDS) uploadVersions.current[key] = (uploadVersions.current[key] || 0) + 1;
    });
    setFiles((prev) => omitFields(prev, hidden));
    setFileErrors((prev) => omitFields(prev, hidden));
    setValidatingFiles((prev) => omitFields(prev, hidden));
    setFieldErrors((prev) => omitFields(prev, [...cleared, ...hidden]));
  };

  const handleStudentBlur = (e) => {
    const { name } = e.target;
    const errors = validateStudentDetails(form);
    setFieldErrors((prev) => ({ ...prev, [name]: errors[name] || "" }));
  };

  const handleEnrollmentBlur = (e) => {
    const { name } = e.target;
    const errors = validateEnrollment(form);
    setFieldErrors((prev) => ({ ...prev, [name]: errors[name] || "" }));
  };

  const handleEnrollmentSubjectsChange = (e) => {
    const { value, checked } = e.target;
    setForm((prev) => sanitizeEnrollment({
      ...prev,
      individualSubjects: checked ? [...prev.individualSubjects, value] : prev.individualSubjects.filter((subject) => subject !== value),
    }));
    setFieldErrors((prev) => omitFields(prev, ["individualSubjects"]));
  };

  const handleContactBlur = (e) => {
    const { name } = e.target;
    const errors = validateContacts(form);
    setFieldErrors((prev) => ({ ...prev, [name]: errors[name] || "" }));
  };

  const handleEducationBlur = (e) => {
    const { name } = e.target;
    const errors = validateEducation(form);
    setFieldErrors((prev) => ({ ...prev, [name]: errors[name] || "" }));
  };

  const handleAviationBlur = (e) => {
    const { name } = e.target;
    const errors = validateAviationWorkflow(form);
    if (name === "previousFlyingExperience" && !form[name]) errors[name] = "Please select flying experience status";
    setFieldErrors((prev) => ({ ...prev, [name]: errors[name] || "" }));
  };

  const handleDGCASubjectChange = (e) => {
    const { value, checked } = e.target;
    setForm((prev) => sanitizeAviationForm({
      ...prev,
      dgcaSubjects: checked ? [...new Set([...prev.dgcaSubjects, value])] : prev.dgcaSubjects.filter((subject) => subject !== value),
    }));

    if (fieldErrors.dgcaSubjects) {
      setFieldErrors((prev) => ({ ...prev, dgcaSubjects: "" }));
    }
  };

  const handleSameAddressChange = (e) => {
    const checked = e.target.checked;
    setSameAddress(checked);

    if (checked) {
      setForm(synchronizeAddress);
      setFieldErrors((prev) => ({ ...prev, ...Object.fromEntries(Object.values(ADDRESS_PAIRS).map((key) => [key, ""])) }));
    }
  };

  const handleDeclarationChange = (e) => {
    setDisclaimerAccepted(e.target.checked);
    setFieldErrors((prev) => omitFields(prev, ["declarationAccepted"]));
  };

  const handleFile = async (e) => {
    const input = e.target;
    const name = input.name;
    if (!isUploadVisible(name, form)) return;
    const file = input.files[0];
    const version = (uploadVersions.current[name] || 0) + 1;
    uploadVersions.current[name] = version;
    setFiles((prev) => { const next = { ...prev }; delete next[name]; return next; });
    setFieldErrors((prev) => ({ ...prev, [name]: "" }));
    setFileErrors((prev) => ({ ...prev, [name]: "" }));
    setValidatingFiles((prev) => ({ ...prev, [name]: false }));
    if (!file) return;
    // Type and size first, then decode the image and check its dimensions.
    let error = validateUpload(file, name);
    if (!error && UPLOAD_FIELDS[name].width) {
      setValidatingFiles((prev) => ({ ...prev, [name]: true }));
      error = await validateImageUpload(file, name);
    }
    if (uploadVersions.current[name] !== version) return;
    setValidatingFiles((prev) => ({ ...prev, [name]: false }));
    if (error) {
      input.value = "";
      setFileErrors((prev) => ({ ...prev, [name]: error }));
      return;
    }
    setFiles((prev) => ({ ...prev, [name]: file }));
    setStatus(EMPTY_STATUS);
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const validateForm = () => {
    const errors = validateStudentDetails(form);
    Object.assign(errors, validateContacts(form), validateEducation(form), validateEnrollment(form));
    if (!form.previousFlyingExperience) errors.previousFlyingExperience = "Please select flying experience status";
    Object.assign(errors, validateAviationWorkflow(form), validateFormUploads(form, files, fileErrors, validatingFiles));
    return errors;
  };

  const showErrors = (errors, message) => {
    setFieldErrors(errors);
    setStatus({ type: "error", message });
    setFocusRequest((request) => request + 1);
  };

  // Clears every piece of applicant state, including pending image checks and the saved draft.
  const resetForm = () => {
    Object.keys(UPLOAD_FIELDS).forEach((key) => {
      uploadVersions.current[key] = (uploadVersions.current[key] || 0) + 1;
    });
    setForm(normalizeForm());
    setFiles({});
    setFileErrors({});
    setFieldErrors({});
    setValidatingFiles({});
    setDisclaimerAccepted(false);
    setSameAddress(false);
    window.grecaptcha?.reset();
    formRef.current?.reset();
    clearDraft();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    // Held during the async image re-check so a second click cannot start another submission.
    submittingRef.current = true;

    const errors = validateForm();
    const imageErrors = await validateSelectedImages(form, files);
    Object.entries(imageErrors).forEach(([name, error]) => { if (!errors[name]) errors[name] = error; });
    if (!disclaimerAccepted) errors.declarationAccepted = "Please accept the Declaration & Undertaking to proceed";
    const token = window.grecaptcha?.getResponse?.();
    if (!token) {
      errors.recaptcha = recaptchaLoaded
        ? "Please complete the security verification (\"I'm not a robot\")."
        : "Security verification is still loading. Please wait a moment and try again.";
    }
    const count = Object.values(errors).filter(Boolean).length;
    if (count) {
      submittingRef.current = false;
      showErrors(errors, count === 1 ? "Please correct the highlighted field before submitting." : `Please correct the ${count} highlighted fields before submitting.`);
      return;
    }

    setLoading(true);
    setStatus(EMPTY_STATUS);

    try {
      await Promise.all([
        axios.post(`${API_URL}/api/submit`, createSubmission(form, files, token, disclaimerAccepted), {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 120000,
        }),
        delay(5000),
      ]);
      // The response (including any job details) is intentionally not displayed.
      resetForm();
      setStatus({ type: "success", message: SUCCESS_MESSAGE });
      setShowThankYou(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      const { message, fields } = submissionFeedback(error);
      window.grecaptcha?.reset();
      showErrors(fields, `${message} Please complete the security verification again before resubmitting.`);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 sm:py-12 px-3 sm:px-6 lg:px-8">
      <ThankYouPopup
        isOpen={showThankYou}
        message={SUCCESS_MESSAGE}
        returnFocusRef={statusRef}
        onClose={() => setShowThankYou(false)}
      />

      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8 sm:mb-12">
          <h2
            className="text-3xl sm:text-5xl font-bold mb-2"
            style={{ color: "black" }}
          >
            {FORM_NAME}
          </h2>
          <p className="text-xl font-bold" style={{ color: "#f4b221" }}>
            SkyPro Aviation Academy
          </p>
        </div>

        <form
          ref={formRef}
          aria-label={FORM_NAME}
          aria-busy={loading}
          noValidate
          onSubmit={handleSubmit}
          className="bg-white shadow-2xl rounded-3xl p-4 sm:p-8 lg:p-12 border border-gray-200"
        >
          {status.message && (
            <div
              ref={statusRef}
              tabIndex={-1}
              role={status.type === "error" ? "alert" : "status"}
              className={`mb-8 p-4 rounded-2xl text-center font-medium text-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f4b221] ${
                status.type === "success"
                  ? "bg-green-100 text-green-800 border-2 border-green-200"
                  : "bg-red-100 text-red-800 border-2 border-red-200"
              }`}
            >
              {status.message}
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite">{loading ? "Submitting your application. Please wait." : ""}</p>

          <fieldset disabled={loading} className="min-w-0 m-0 border-0 p-0">
            <section aria-labelledby="important-instructions" className="mb-12 rounded-2xl border-2 border-[#f4b221] bg-amber-50 p-5 sm:p-8">
              <h3 id="important-instructions" className="text-2xl font-bold text-[#003366] mb-3">Important Instructions</h3>
              <h4 className="text-lg font-bold text-gray-900 mb-3">File Format and Size Requirements</h4>
              <ul className="list-disc pl-6 space-y-2 text-gray-800 leading-relaxed">
                <li>All documents must be uploaded in PDF format, maximum 2 MB per document.</li>
                <li>Applicants should compress documents before uploading if necessary.</li>
                <li>Passport-size photograph and signatures must be JPG, JPEG or PNG format, maximum 2 MB each.</li>
                <li>
                  The photo must be exactly {UPLOAD_FIELDS.photo.width} × {UPLOAD_FIELDS.photo.height} pixels ({UPLOAD_FIELDS.photo.sizeNote}); the student and parent signatures must be exactly {UPLOAD_FIELDS.signature.width} × {UPLOAD_FIELDS.signature.height} pixels. Resize images using{" "}
                  <a href="https://www.reduceimages.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Reduce Images</a> if needed.
                </li>
                <li>Incorrect file format or files over the size limit must not be accepted.</li>
              </ul>
              <p className="mt-4 text-gray-800">
                Fields marked <span className="text-red-500 font-bold" aria-hidden="true">*</span><span className="sr-only">with an asterisk</span> are required.
              </p>
            </section>

            <StudentDetails
              form={form} errors={fieldErrors} files={files} fileErrors={fileErrors}
              validatingFiles={validatingFiles} sameAddress={sameAddress} sectionRef={studentDetailsRef}
              onChange={handleChange} onBlur={handleStudentBlur}
              onSameAddressChange={handleSameAddressChange} onFile={handleFile}
            />

            <ContactDetails form={form} errors={fieldErrors} sectionRef={parentDetailsRef} onChange={handleChange} onBlur={handleContactBlur} />

            <EducationDetails
              form={form} errors={fieldErrors} files={files} fileErrors={fileErrors}
              validatingFiles={validatingFiles} sectionRef={academicDetailsRef}
              onChange={handleChange} onBlur={handleEducationBlur} onFile={handleFile}
            />

            <EnrollmentDetails form={form} errors={fieldErrors} sectionRef={enrollmentRef} onChange={handleChange} onBlur={handleEnrollmentBlur} onSubjectsChange={handleEnrollmentSubjectsChange} />

            <AviationWorkflow
              form={form} errors={fieldErrors} files={files} fileErrors={fileErrors}
              validatingFiles={validatingFiles} sectionRef={aviationBackgroundRef}
              onChange={handleChange} onBlur={handleAviationBlur}
              onSubjectsChange={handleDGCASubjectChange} onFile={handleFile}
            />

            <DeclarationDetails
              fullName={form.fullName} accepted={disclaimerAccepted}
              onAccept={handleDeclarationChange} sectionRef={declarationRef}
              files={files} errors={fieldErrors} fileErrors={fileErrors}
              validatingFiles={validatingFiles} onFile={handleFile}
            />

            {/* reCAPTCHA Section */}
            <section className="mb-8" ref={recaptchaRef} aria-label="Security verification">
              <div className="flex justify-center">
                {/* The widget is a fixed 304px wide; scale it down on very narrow screens. */}
                <div className="max-[360px]:scale-[0.85]">
                  <div
                    className="g-recaptcha"
                    data-sitekey={siteKey}
                    data-callback="onRecaptchaVerify"
                    data-expired-callback="onRecaptchaExpired"
                  ></div>
                </div>
              </div>
              {!recaptchaLoaded && (
                <p className="text-center text-gray-500 text-sm mt-2">
                  Loading security verification...
                </p>
              )}
              {fieldErrors.recaptcha && (
                <p data-error-anchor tabIndex={-1} className="text-center text-red-600 text-sm mt-2 focus:outline-none">
                  {fieldErrors.recaptcha}
                </p>
              )}
            </section>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#003366] hover:bg-black disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold py-4 px-8 rounded-2xl text-xl shadow-xl hover:shadow-2xl transition-all duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f4b221] focus-visible:ring-offset-2"
            >
              {loading ? "Submitting..." : "Submit Application"}
            </button>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
