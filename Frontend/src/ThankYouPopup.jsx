import { useEffect, useRef } from "react";

export default function ThankYouPopup({ isOpen, onClose, message, returnFocusRef }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Modal behaviour: focus the dialog, trap Tab, close on Escape, restore focus on close.
  useEffect(() => {
    if (!isOpen) return undefined;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll("button, a[href]")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const returnTarget = returnFocusRef;
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      returnTarget?.current?.focus({ preventScroll: true });
    };
  }, [isOpen, returnFocusRef]);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-white/30 z-40 transition-opacity duration-300"
        aria-hidden="true"
        onClick={onClose}
      ></div>

      {/* Popup */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="thank-you-title"
          aria-describedby="thank-you-message"
          className="pointer-events-auto bg-white rounded-3xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 transform transition-all duration-300 animate-bounce-in relative"
        >
          {/* Cross Button */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 rounded-lg transition-colors duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f4b221]"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Success Icon */}
          <div className="flex justify-center mb-6" aria-hidden="true">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          <h2 id="thank-you-title" className="text-3xl font-bold text-center text-gray-900 mb-4">
            Thank You!
          </h2>

          <p id="thank-you-message" className="text-center text-gray-700 mb-6 text-lg">
            {message}
          </p>

          <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-6">
            <p className="text-sm text-blue-800">
              Please check your inbox, including the spam folder, for the confirmation email.
            </p>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="w-full bg-[#003366] hover:bg-black text-white font-bold py-3 px-6 rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f4b221] focus-visible:ring-offset-2"
          >
            Close
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bounce-in {
          0% { opacity: 0; transform: scale(0.3); }
          50% { transform: scale(1.05); }
          70% { transform: scale(0.9); }
          100% { opacity: 1; transform: scale(1); }
        }
        .animate-bounce-in { animation: bounce-in 0.6s ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .animate-bounce-in { animation: none; }
        }
      `}</style>
    </>
  );
}
