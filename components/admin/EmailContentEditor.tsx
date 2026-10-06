"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FORM_CONTROL_SHELL, FORM_LABEL } from "../divine/formFieldStyles";
import { resolveImageUrl } from "../../lib/imageUrl";

export type EmailPlaceholder = { token: string; label: string };

type Props = {
  label: string;
  value: string;
  onChange: (html: string) => void;
  placeholders?: EmailPlaceholder[];
  /** Logo uploaded on Entity Master. The preview shell uses this; the saved text does not. */
  logoUrl?: string | null;
  rows?: number;
  hint?: string;
  error?: string;
  required?: boolean;
};

type Mode = "write" | "preview" | "edit";

type Action = {
  label: string;
  title: string;
  command?: string;
  value?: string;
  block?: boolean;
  before?: string;
  after?: string;
};

const ACTIONS: Action[] = [
  { label: "B", title: "Bold", command: "bold", before: "<strong>", after: "</strong>" },
  { label: "I", title: "Italic", command: "italic", before: "<em>", after: "</em>" },
  { label: "U", title: "Underline", command: "underline", before: "<u>", after: "</u>" },
  { label: "S", title: "Strikethrough", command: "strikeThrough", before: "<s>", after: "</s>" },
  { label: "H2", title: "Heading", command: "formatBlock", value: "H2", before: "<h2>", after: "</h2>", block: true },
  { label: "H3", title: "Sub-heading", command: "formatBlock", value: "H3", before: "<h3>", after: "</h3>", block: true },
  { label: "¶", title: "Paragraph", command: "formatBlock", value: "P", before: "<p>", after: "</p>", block: true },
  { label: "• List", title: "Bullet list", command: "insertUnorderedList", before: "<ul>\n  <li>", after: "</li>\n</ul>", block: true },
  { label: "1. List", title: "Numbered list", command: "insertOrderedList", before: "<ol>\n  <li>", after: "</li>\n</ol>", block: true },
  { label: "Left", title: "Align left", command: "justifyLeft", before: '<div style="text-align:left">', after: "</div>", block: true },
  { label: "Center", title: "Align center", command: "justifyCenter", before: '<div style="text-align:center">', after: "</div>", block: true },
  { label: "Right", title: "Align right", command: "justifyRight", before: '<div style="text-align:right">', after: "</div>", block: true },
  { label: "Quote", title: "Quote", command: "formatBlock", value: "BLOCKQUOTE", before: "<blockquote>", after: "</blockquote>", block: true },
  { label: "Line", title: "Horizontal line", command: "insertHorizontalRule", before: "<hr>", after: "", block: true },
  { label: "Clear", title: "Clear formatting", command: "removeFormat" },
];

const PALETTE = ["#2a2013", "#5c4d33", "#7c1527", "#b8892a", "#1f4d3a", "#1d4e89", "#ffffff", "#111111"];

const TOOL_BUTTON = "rounded px-1.5 py-1 text-[12px] font-semibold text-maroon transition hover:bg-ivory-50";

const SIZES = [
  { label: "S", title: "Small text", px: "13px" },
  { label: "M", title: "Normal text", px: "15px" },
  { label: "L", title: "Large text", px: "18px" },
  { label: "XL", title: "Title text", px: "22px" },
];

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buttonHtml(href: string, text: string, fill: string, ink: string) {
  return `<div align="center" style="margin:28px 0;text-align:center;"><a href="${href}" target="_blank" style="background-color:${fill};color:${ink};display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:20px;text-align:center;text-decoration:none;padding:14px 36px;border-radius:8px;">${text}</a></div>`;
}

/**
 * A saved message sometimes still contains an older full email (its own logo
 * and card). The shell is added around the text when the mail is sent, so
 * that extra card is peeled off and only the message is kept.
 */
export function extractMessageHtml(html: string): string {
  let current = String(html || "").trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const next = peelEmailShell(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function peelEmailShell(raw: string): string {
  if (!raw) return "";
  const wrapped =
    /ssd-email-shell/i.test(raw) ||
    /<!doctype html/i.test(raw) ||
    /<html[\s>]/i.test(raw) ||
    /font-family:\s*Georgia,serif;background:\s*#fbf6ea/i.test(raw) ||
    (/<img\b/i.test(raw) && /<h1\b/i.test(raw) && /<table\b/i.test(raw));
  if (!wrapped || typeof DOMParser === "undefined") return raw;

  const doc = new DOMParser().parseFromString(raw, "text/html");
  doc.querySelectorAll("img").forEach((img) => img.remove());
  doc.querySelectorAll("p").forEach((p) => {
    const text = (p.textContent || "").replace(/\s+/g, " ").trim();
    if (/^sri siva durga temple$/i.test(text)) p.remove();
  });

  const heading = doc.querySelector("h1");
  const container = heading?.parentElement || richestCell(doc) || doc.body;
  return container.innerHTML.replace(/<!--\s*ssd-email-shell\s*-->/gi, "").trim();
}

function richestCell(doc: Document) {
  const cells = [...doc.querySelectorAll("td")];
  return cells.sort((a, b) => b.innerHTML.length - a.innerHTML.length)[0];
}

/**
 * Message body for an email template or mapping. The saved value is only the
 * inner text. Preview draws the standard card and the entity logo around it.
 * Edit preview changes that text in place; it does not store the card or logo.
 */
export default function EmailContentEditor({
  label,
  value,
  onChange,
  placeholders = [],
  logoUrl,
  rows = 12,
  hint,
  error,
  required = false,
}: Props) {
  const writeRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const savedRange = useRef<Range | null>(null);
  const normalized = useRef(false);
  const [mode, setMode] = useState<Mode>("write");
  const [query, setQuery] = useState("");
  const [textColor, setTextColor] = useState("#5c4d33");
  const [highlightColor, setHighlightColor] = useState("#fff3c4");
  const [buttonFill, setButtonFill] = useState("#7c1527");
  const [buttonInk, setButtonInk] = useState("#ffffff");

  const logo = resolveImageUrl(logoUrl);
  const message = useMemo(() => extractMessageHtml(value), [value]);

  useEffect(() => {
    if (normalized.current || !value) return;
    normalized.current = true;
    const next = extractMessageHtml(value);
    if (next !== value) onChange(next);
  }, [value, onChange]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || focused.current || mode === "write") return;
    if (el.innerHTML !== message) el.innerHTML = message || "<p><br></p>";
  }, [message, mode]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return placeholders;
    return placeholders.filter(
      (item) => item.token.toLowerCase().includes(q) || item.label.toLowerCase().includes(q)
    );
  }, [placeholders, query]);

  function publishFromPreview() {
    const html = bodyRef.current?.innerHTML || "";
    onChange(html === "<p><br></p>" || html === "<br>" ? "" : html);
  }

  function insert(text: string) {
    if (mode === "edit") {
      bodyRef.current?.focus();
      document.execCommand("insertHTML", false, text);
      publishFromPreview();
      return;
    }
    const el = writeRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + text.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  function wrapWrite(before: string, after: string, empty = "Text") {
    const el = writeRef.current;
    const start = el?.selectionStart ?? message.length;
    const end = el?.selectionEnd ?? message.length;
    const selected = message.slice(start, end) || empty;
    const text = `${before}${selected}${after}`;
    onChange(message.slice(0, start) + text + message.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + text.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  function rememberSelection() {
    if (mode !== "edit") return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !bodyRef.current?.contains(sel.anchorNode)) return;
    savedRange.current = sel.getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    const range = savedRange.current;
    if (!range) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function paint(command: "foreColor" | "hiliteColor", color: string, style: string) {
    if (mode === "edit") {
      restoreSelection();
      bodyRef.current?.focus();
      document.execCommand("styleWithCSS", false, "true");
      const applied = document.execCommand(command, false, color);
      if (!applied && command === "hiliteColor") document.execCommand("backColor", false, color);
      publishFromPreview();
      return;
    }
    const el = writeRef.current;
    if (!el || el.selectionStart === el.selectionEnd) return;
    wrapWrite(`<span style="${style}:${color}">`, "</span>");
  }

  function applySize(px: string) {
    if (mode === "edit") {
      const selected = window.getSelection()?.toString() || "Text";
      insert(`<span style="font-size:${px}">${escapeHtml(selected)}</span>`);
      return;
    }
    wrapWrite(`<span style="font-size:${px}">`, "</span>");
  }

  function apply(action: Action) {
    if (mode === "edit" && action.command) {
      bodyRef.current?.focus();
      document.execCommand(action.command, false, action.value);
      publishFromPreview();
      return;
    }
    if (!action.before && !action.after) return;
    const el = writeRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || (action.label === "Link" ? "link" : "");
    const lead = action.block && start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    insert(`${lead}${action.before}${selected}${action.after}`);
  }

  function addLink() {
    const url = window.prompt("Link address", "https://");
    if (!url) return;
    if (mode === "edit") {
      bodyRef.current?.focus();
      document.execCommand("createLink", false, url);
      publishFromPreview();
      return;
    }
    const el = writeRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || url;
    insert(`<a href="${url.replace(/"/g, "&quot;")}">${selected}</a>`);
  }

  function recolorSelectedButton(fill: string, ink: string) {
    if (mode !== "edit") return;
    restoreSelection();
    const node = window.getSelection()?.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    const anchor = el?.closest("a");
    if (!anchor) return;
    const style = anchor.getAttribute("style") || "";
    if (!/background/i.test(style)) return;
    anchor.style.background = fill;
    anchor.style.color = ink;
    anchor.style.textDecoration = "none";
    publishFromPreview();
  }

  function addButton() {
    const text = window.prompt("Button label", "Open");
    if (!text) return;
    const url = window.prompt("Button link", "https://");
    if (!url) return;
    insert(buttonHtml(url.replace(/"/g, "&quot;"), escapeHtml(text), buttonFill, buttonInk));
  }

  const showTools = mode !== "preview";

  return (
    <div className="w-full">
      <span className={FORM_LABEL}>
        {label}
        {required && <span className="text-crimson-500"> *</span>}
      </span>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className={`${FORM_CONTROL_SHELL} overflow-hidden ${error ? "!border-crimson-500" : ""}`}>
          <div className="border-b border-[#f0b4a0]/60 bg-ivory-50">
            <div className="flex items-start justify-between gap-2 px-2 py-1.5">
              {showTools ? (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <ToolGroup>
                    {ACTIONS.slice(0, 4).map((action) => (
                      <ToolButton key={action.label} action={action} onApply={apply} />
                    ))}
                  </ToolGroup>
                  <ToolGroup>
                    {ACTIONS.slice(4, 7).map((action) => (
                      <ToolButton key={action.label} action={action} onApply={apply} />
                    ))}
                  </ToolGroup>
                  <ToolGroup>
                    {ACTIONS.slice(7, 9).map((action) => (
                      <ToolButton key={action.label} action={action} onApply={apply} />
                    ))}
                  </ToolGroup>
                  <ToolGroup>
                    {ACTIONS.slice(9, 12).map((action) => (
                      <ToolButton key={action.label} action={action} onApply={apply} />
                    ))}
                  </ToolGroup>
                  <ToolGroup>
                    {ACTIONS.slice(12).map((action) => (
                      <ToolButton key={action.label} action={action} onApply={apply} />
                    ))}
                    <button type="button" title="Link" onMouseDown={(e) => e.preventDefault()} onClick={addLink} className={TOOL_BUTTON}>
                      Link
                    </button>
                    <button type="button" title="Insert a button using the button colours below" onMouseDown={(e) => e.preventDefault()} onClick={addButton} className={TOOL_BUTTON}>
                      Button
                    </button>
                  </ToolGroup>
                </div>
              ) : (
                <span />
              )}
              <div className="flex shrink-0 overflow-hidden rounded-md border border-[#f0b4a0]/70 text-[12px] font-semibold">
                {(
                  [
                    ["write", "Write"],
                    ["preview", "Preview"],
                    ["edit", "Edit preview"],
                  ] as const
                ).map(([id, name]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMode(id)}
                    className={`px-3 py-1 transition ${mode === id ? "bg-maroon text-white" : "bg-white text-ink-300 hover:text-maroon"}`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            {showTools && (
              <div className="grid grid-cols-1 gap-1.5 border-t border-[#f0b4a0]/50 px-2 py-2 sm:grid-cols-2 xl:grid-cols-3">
                <ColorChoice
                  onRemember={rememberSelection}
                  label="Text"
                  value={textColor}
                  onApply={() => paint("foreColor", textColor, "color")}
                  onPick={(color) => {
                    setTextColor(color);
                    paint("foreColor", color, "color");
                  }}
                />
                <ColorChoice
                  onRemember={rememberSelection}
                  label="Highlight"
                  value={highlightColor}
                  onApply={() => paint("hiliteColor", highlightColor, "background-color")}
                  onPick={(color) => {
                    setHighlightColor(color);
                    paint("hiliteColor", color, "background-color");
                  }}
                />
                <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-[#f0b4a0]/70 bg-white px-2">
                  <span className="w-[5.75rem] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-maroon">Size</span>
                  <span className="inline-flex overflow-hidden rounded border border-[#f0b4a0]/80">
                    {SIZES.map((size) => (
                      <button
                        key={size.px}
                        type="button"
                        title={size.title}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applySize(size.px)}
                        className="h-6 min-w-7 px-1.5 text-[12px] font-semibold text-maroon hover:bg-ivory-50"
                      >
                        {size.label}
                      </button>
                    ))}
                  </span>
                </div>
                <ColorChoice
                  onRemember={rememberSelection}
                  label="Button"
                  value={buttonFill}
                  onPick={(color) => {
                    setButtonFill(color);
                    recolorSelectedButton(color, buttonInk);
                  }}
                />
                <ColorChoice
                  onRemember={rememberSelection}
                  label="Button text"
                  value={buttonInk}
                  onPick={(color) => {
                    setButtonInk(color);
                    recolorSelectedButton(buttonFill, color);
                  }}
                />
              </div>
            )}
          </div>

          {mode === "write" ? (
            <textarea
              ref={writeRef}
              value={message}
              rows={rows}
              onChange={(e) => onChange(e.target.value)}
              spellCheck
              className="block w-full resize-y bg-white px-3.5 py-3 font-mono text-[13px] leading-6 text-ink-100 outline-none"
            />
          ) : (
            <div className="bg-[#fbf6ea] px-4 py-6 sm:px-6">
              <div className="mx-auto max-w-[600px] overflow-hidden rounded-xl border border-[#e6d3a1] bg-white shadow-[0_8px_24px_-16px_rgba(42,32,19,0.45)]">
                <div className="bg-[#fffaf0] px-8 pb-4 pt-7 text-center">
                  {logo ? (
                    <img src={logo} alt="Entity logo" className="mx-auto h-auto w-40 max-w-full" />
                  ) : (
                    <p className="text-[12px] uppercase tracking-[0.18em] text-[#96691b]">Upload a logo in Entity Master</p>
                  )}
                </div>
                <div className="h-1 bg-[#7c1527]" />
                <div
                  ref={bodyRef}
                  contentEditable={mode === "edit"}
                  suppressContentEditableWarning
                  role={mode === "edit" ? "textbox" : undefined}
                  aria-label={mode === "edit" ? "Edit email text" : undefined}
                  onFocus={() => {
                    focused.current = true;
                  }}
                  onBlur={() => {
                    focused.current = false;
                    publishFromPreview();
                  }}
                  onInput={publishFromPreview}
                  className={`min-h-[220px] px-8 py-7 font-serif text-[15px] leading-relaxed text-[#5c4d33] outline-none [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[#d4af37] [&_blockquote]:pl-3 [&_h2]:text-[22px] [&_h2]:text-[#2a2013] [&_h3]:text-[18px] [&_h3]:text-[#2a2013] [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 ${
                    mode === "edit" ? "cursor-text ring-2 ring-inset ring-[#e8590c]/40" : ""
                  }`}
                />
              </div>
              {mode === "edit" && (
                <p className="mx-auto mt-3 max-w-[600px] text-center text-[12px] text-[#7d6c4d]">
                  Select text, then choose a text or highlight colour. Button colours update the button under the cursor, and the next button you insert. The logo and the card stay as they are on the sent email.
                </p>
              )}
            </div>
          )}
        </div>

        <aside className="rounded-lg border border-[#f0b4a0] bg-ivory-50 p-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-maroon">Placeholders</p>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="mt-2 w-full rounded-md border border-[#f0b4a0] bg-white px-2.5 py-1.5 text-[13px] text-ink-100 outline-none placeholder:text-gray-400 focus:border-[#e8590c]"
          />
          <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">
            {visible.length === 0 && <p className="px-1 py-2 text-[12px] text-ink-500">No placeholders.</p>}
            {visible.map((item) => (
              <button
                key={item.token}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(`{{${item.token}}}`)}
                className="block w-full rounded-md px-2 py-1.5 text-left transition hover:bg-white"
              >
                <span className="block font-mono text-[12px] text-maroon">{`{{${item.token}}}`}</span>
                <span className="block text-[11px] text-ink-500">{item.label}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
      {hint && !error && <p className="mt-1 text-[11.5px] text-ink-500">{hint}</p>}
      {error && <p className="mt-1 text-[12px] text-crimson-500">{error}</p>}
    </div>
  );
}

function ToolGroup({ children }: { children: ReactNode }) {
  return <div className="inline-flex items-center rounded-md border border-[#f0b4a0]/60 bg-white p-0.5">{children}</div>;
}

function ToolButton({ action, onApply }: { action: Action; onApply: (action: Action) => void }) {
  return (
    <button
      type="button"
      title={action.title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onApply(action)}
      className={TOOL_BUTTON}
    >
      {action.label}
    </button>
  );
}

function ColorChoice({
  label,
  value,
  onPick,
  onApply,
  onRemember,
}: {
  label: string;
  value: string;
  onPick: (color: string) => void;
  onApply?: () => void;
  onRemember?: () => void;
}) {
  return (
    <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-[#f0b4a0]/70 bg-white px-2">
      <button
        type="button"
        title={onApply ? `Apply ${label.toLowerCase()} colour to the selection` : label}
        onMouseDown={(e) => {
          onRemember?.();
          e.preventDefault();
        }}
        onClick={onApply}
        className="w-[5.75rem] shrink-0 truncate text-left text-[11px] font-semibold uppercase tracking-wide text-maroon"
      >
        {label}
      </button>
      <label
        className="relative h-5 w-5 shrink-0 cursor-pointer overflow-hidden rounded border border-[#e6d3a1]"
        style={{ backgroundColor: value }}
        title={`${label} colour`}
        onMouseDown={() => onRemember?.()}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onPick(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={label}
        />
      </label>
      <span className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            onMouseDown={(e) => {
              onRemember?.();
              e.preventDefault();
            }}
            onClick={() => onPick(color)}
            className={`h-3.5 w-3.5 shrink-0 rounded-full border ${value.toLowerCase() === color ? "border-maroon ring-1 ring-maroon" : "border-black/15"}`}
            style={{ backgroundColor: color }}
          />
        ))}
      </span>
    </div>
  );
}
