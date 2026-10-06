"use client";

import { useState } from "react";
import { FORM_CONTROL, FORM_CONTROL_ERROR, FORM_LABEL } from "../divine/formFieldStyles";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  label: string;
  value: string[];
  onChange: (emails: string[]) => void;
  error?: string;
  placeholder?: string;
};

/** CC / BCC: type an address and press Enter. Duplicates are ignored. */
export default function EmailAddressListField({ label, value, onChange, error, placeholder = "Enter an email and press Enter" }: Props) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function add(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      setLocalError("Enter a valid email address.");
      return;
    }
    setLocalError(null);
    if (!value.some((item) => item.toLowerCase() === email)) onChange([...value, email]);
    setDraft("");
  }

  const shown = localError || error;

  return (
    <div className="w-full">
      <span className={FORM_LABEL}>{label}</span>
      <div className={`${FORM_CONTROL} h-auto min-h-10 flex-wrap py-1.5 ${shown ? FORM_CONTROL_ERROR : ""}`}>
        {value.map((email) => (
          <span key={email} className="inline-flex items-center gap-1 rounded-full bg-ivory-100 px-2 py-0.5 text-[12px] text-maroon">
            {email}
            <button
              type="button"
              aria-label={`Remove ${email}`}
              onClick={() => onChange(value.filter((item) => item !== email))}
              className="text-ink-400 hover:text-crimson-500"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (localError) setLocalError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
              if (!draft.trim() && e.key === "Tab") return;
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim()) add(draft);
          }}
          placeholder={value.length === 0 ? placeholder : ""}
          className="min-w-[12rem] flex-1 bg-transparent py-1 text-[14px] text-ink-100 outline-none placeholder:text-gray-400"
        />
      </div>
      {shown && <p className="mt-1 text-[12px] text-crimson-500">{shown}</p>}
    </div>
  );
}
