// Built from the rule so the help text always shows the enforced dimensions.
const imageHelp = (rule) => `Required dimensions: ${rule.width} x ${rule.height} pixels${rule.sizeNote ? ` (${rule.sizeNote})` : ""}, JPG/JPEG/PNG only, Max 2MB.`;

export default function UploadField({ name, rule, file, error, pending, onChange }) {
  const inputId = `upload-${name}`;
  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="block text-lg font-bold text-gray-700 mb-2">
        {rule.label} ({rule.formats}) <span className="text-red-500" aria-hidden="true">*</span>
      </label>
      <input
        id={inputId}
        type="file"
        name={name}
        accept={rule.accept}
        aria-required="true"
        aria-invalid={Boolean(error)}
        aria-describedby={`${inputId}-help ${inputId}-status`}
        className={`w-full min-w-0 px-4 py-3 border-2 border-dashed rounded-xl focus:ring-2 focus:ring-blue-300 transition-all duration-200 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-50 file:text-gray-700 hover:file:bg-gray-100 disabled:bg-gray-100 ${error ? "border-red-400 bg-red-50" : "border-gray-300"}`}
        onChange={onChange}
      />
      <p id={`${inputId}-help`} className="text-sm text-gray-600 mt-1">
        {rule.width ? (
          <>
            {imageHelp(rule)} If your image does not match these requirements, resize/compress it using{" "}
            <a href="https://www.reduceimages.com/" target="_blank" rel="noopener noreferrer nofollow" className="text-blue-600 hover:underline">Reduce Images</a>.
          </>
        ) : `${rule.formats} only. Maximum 2 MB.`}
      </p>
      <p id={`${inputId}-status`} aria-live="polite" className={`text-sm mt-1 break-words ${error ? "text-red-600" : "text-green-700"}`}>
        {error || (pending ? "Checking image..." : file ? `✓ ${file.name}` : "")}
      </p>
    </div>
  );
}
