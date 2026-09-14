import { useEffect, useRef, useState } from "react";
import { PHONE_COUNTRIES, searchPhoneCountries } from "./studentDetailsModel.js";

// Searchable country-code combobox. Emits the same { target: { name, value } } shape as the
// previous <select>, where value is the ISO country code, so existing form handlers are unchanged.
export default function CountryCodeSelect({ id, name, value, onChange, onBlur, className, "aria-label": ariaLabel, ...inputProps }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const selected = PHONE_COUNTRIES.find((item) => item.country === value);
  const label = selected ? `${selected.callingCode} ${selected.country}` : "";
  const results = searchPhoneCountries(query);
  const active = open ? results[Math.min(activeIndex, results.length - 1)] : undefined;
  const listboxId = `${id}-listbox`;
  const activeOptionId = active ? `${id}-option-${active.country}` : undefined;

  useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  const openList = () => {
    setQuery("");
    setActiveIndex(Math.max(0, PHONE_COUNTRIES.findIndex((item) => item.country === value)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const choose = (item) => {
    if (item && item.country !== value) onChange({ target: { name, value: item.country } });
    close();
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return openList();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => Math.min(Math.max(Math.min(index, results.length - 1) + step, 0), Math.max(results.length - 1, 0)));
    } else if (event.key === "Enter") {
      // Never submit the form from this field.
      event.preventDefault();
      if (open) choose(active);
      else openList();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  };

  const handleInput = (event) => {
    // When closed the field shows the selected label; keep only what the user typed after it.
    const typed = !open && label && event.target.value.startsWith(label) ? event.target.value.slice(label.length) : event.target.value;
    setQuery(typed);
    setActiveIndex(0);
    setOpen(true);
  };

  return (
    <div className="relative min-w-0">
      <input
        ref={inputRef} id={id} type="text" role="combobox" autoComplete="off" spellCheck={false}
        aria-label={ariaLabel} aria-expanded={open} aria-controls={listboxId} aria-autocomplete="list"
        aria-activedescendant={open ? activeOptionId : undefined}
        value={open ? query : label}
        placeholder={open ? label || "Search country" : undefined}
        title={selected ? `${selected.name} (${selected.callingCode})` : undefined}
        onFocus={(event) => event.target.select()}
        onClick={() => { if (!open) openList(); }}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => { close(); onBlur?.({ target: { name } }); }}
        className={`${className} pr-8`}
        {...inputProps}
      />
      <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
      <span className="sr-only" aria-live="polite">{open ? `${results.length} ${results.length === 1 ? "country" : "countries"} found` : ""}</span>
      {open && (
        <ul
          id={listboxId} role="listbox" aria-label={ariaLabel}
          onMouseDown={(event) => event.preventDefault()}
          className="absolute left-0 top-full z-30 mt-1 max-h-64 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          {results.length ? results.map((item, index) => (
            <li
              key={item.country} id={`${id}-option-${item.country}`} role="option" aria-selected={item.country === value}
              onClick={() => choose(item)} onMouseEnter={() => setActiveIndex(index)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${item === active ? "bg-blue-50" : ""} ${item.country === value ? "font-semibold text-[#003366]" : "text-gray-700"}`}
            >
              <span className="min-w-0 truncate">{item.name}</span>
              <span className="shrink-0 text-gray-500">{item.callingCode} · {item.country}</span>
            </li>
          )) : <li className="px-3 py-2 text-sm text-gray-500">No matching country</li>}
        </ul>
      )}
    </div>
  );
}
