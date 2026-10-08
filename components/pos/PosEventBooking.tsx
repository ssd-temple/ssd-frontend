"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import DivineListbox, { type ListboxOption } from "../divine/DivineListbox";
import DevoteeNameField from "./DevoteeNameField";
import { CalendarIcon, CheckIcon, ChevronIcon, ClockIcon, PlusIcon, TrashIcon, UsersIcon } from "../divine/icons";
import { formatHHMMDisplay, parseISODateString } from "../../lib/datetime";
import { resolveImageUrl } from "../../lib/imageUrl";
import { eventImageSrc, fallbackToDefaultEventImage, type PosEvent, type PosEventSlot } from "./PosEventsSection";

type Devotee = { name: string; nakshatra: string };
type Deity = PosEvent["deityMapping"][number];

export type EventSelection = {
  eventId: string;
  slot: PosEventSlot | null;
  deityIds: string[];
  devotees: Devotee[];
};

type StepKey = "slot" | "deity" | "family" | "terms" | "payment";

const iso = (v: string) => v.slice(0, 10);
const dayLabel = (v: string) => {
  const d = parseISODateString(iso(v));
  return d ? d.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" }) : "";
};

function seatState(slot: PosEventSlot) {
  const total = slot.totalSeats;
  const booked = slot.bookedSeats ?? 0;
  if (!total) return { left: null as number | null, pct: 0, tone: "bg-emerald-500", full: false };
  const left = Math.max(0, total - booked);
  const pct = Math.min(100, Math.round((booked / total) * 100));
  return { left, pct, tone: pct >= 90 ? "bg-rose-500" : pct >= 60 ? "bg-amber-500" : "bg-emerald-500", full: left === 0 };
}

const PRIMARY_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#7c1527] to-[#b01b2e] px-5 py-2 text-[13.5px] font-bold text-white shadow-[0_8px_16px_-8px_rgba(124,21,39,0.8)] transition-[transform,box-shadow,opacity] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_22px_-10px_rgba(124,21,39,0.9)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0";
const GHOST_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#7c1527]/30 bg-white px-4 py-2 text-[13.5px] font-semibold text-[#7c1527] transition-colors hover:bg-[#7c1527]/5";
const LABEL = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#7c1527]";

/** Shown for any deity that has no picture uploaded in the Deity master. */
const DEFAULT_DEITY_IMAGE = "/default-deity.svg";

/** The deity's own picture from the Deity master, or one shared default when none is uploaded. */
function DeityAvatar({ deity, size }: { deity: Deity; size: number }) {
  const src = resolveImageUrl(deity.image) ?? DEFAULT_DEITY_IMAGE;
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-2 ring-[#e8d2a6]"
      style={{ width: size, height: size }}
    >
      <img src={src} alt="" className="h-full w-full object-cover" />
    </span>
  );
}

/**
 * Event booking flow, shown inside the Events panel itself (no popup, no new
 * page): Slot -> Deities -> Family members -> Review. A step is only present
 * when the event needs it. Collects the selection only - nothing is saved or
 * charged from here yet.
 */
export default function PosEventBooking({
  event,
  nakshatraOptions,
  onBack,
}: {
  event: PosEvent;
  nakshatraOptions: ListboxOption[];
  onBack: () => void;
}) {
  const steps = useMemo(() => {
    const list: { key: StepKey; label: string }[] = [{ key: "slot", label: event.isSlotRequired ? "Slot" : "Details" }];
    if (event.deityMapping.length > 0) list.push({ key: "deity", label: "Deities" });
    if (event.isFamilyMembersRequired) list.push({ key: "family", label: "Family" });
    if (event.termsAndConditions?.trim()) list.push({ key: "terms", label: "Terms" });
    list.push({ key: "payment", label: "Summary" });
    return list;
  }, [event]);

  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [slotIndex, setSlotIndex] = useState<number | null>(null);
  const [slotDate, setSlotDate] = useState<string>(() => (event.slotDetails[0] ? iso(event.slotDetails[0].date) : ""));
  const [deityIds, setDeityIds] = useState<string[]>([]);
  const [devotees, setDevotees] = useState<Devotee[]>([{ name: "", nakshatra: "" }]);
  const [showValidation, setShowValidation] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [proceeded, setProceeded] = useState(false);

  const step = steps[stepIndex].key;
  const maxMembers = event.maxFamilyMembers ?? 2;
  const slots = event.slotDetails;
  const slotDates = useMemo(() => Array.from(new Set(slots.map((s) => iso(s.date)))), [slots]);
  const chosenSlot = slotIndex !== null ? slots[slotIndex] : null;
  const banner = eventImageSrc(event);

  const namedDevotees = devotees.filter((d) => d.name.trim());
  const familyValid = namedDevotees.length > 0 && namedDevotees.every((d) => d.nakshatra);
  const chosenDeities = event.deityMapping.filter((d) => deityIds.includes(d._id));

  function canContinue(): boolean {
    if (step === "slot") return !event.isSlotRequired || chosenSlot !== null;
    if (step === "deity") return deityIds.length > 0;
    if (step === "family") return familyValid;
    if (step === "terms") return accepted;
    return true;
  }

  function go(delta: number) {
    setDirection(delta);
    setShowValidation(false);
    setStepIndex((i) => Math.min(steps.length - 1, Math.max(0, i + delta)));
  }

  function next() {
    if (!canContinue()) {
      setShowValidation(true);
      return;
    }
    go(1);
  }

  const dateText =
    event.dateType === "MULTIPLE"
      ? (event.eventDates ?? []).map(dayLabel).join(" · ")
      : iso(event.startDate) === iso(event.endDate)
        ? dayLabel(event.startDate)
        : `${dayLabel(event.startDate)} → ${dayLabel(event.endDate)}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      {/* Header: back, title, price */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className={`${GHOST_BTN} !px-3 !py-1.5 text-[12.5px]`} aria-label="Back to all events">
          <ChevronIcon className="h-3.5 w-3.5 rotate-90" /> Events
        </button>
        {banner && (
          <img src={banner} onError={fallbackToDefaultEventImage} alt="" className="hidden h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-[#e8d2a6] sm:block" />
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <h3 className="truncate font-display text-[18px] font-extrabold text-[#4a0d1a]">{event.name}</h3>
          <p className="truncate text-[12.5px] font-semibold text-[#b8860b]">{event.tamilName}</p>
        </div>
        <span className="rounded-full bg-gradient-to-r from-[#7c1527] to-[#b01b2e] px-3.5 py-1 text-[14px] font-bold tabular-nums text-white">
          ${Number(event.salePrice).toFixed(2)}
        </span>
      </div>

      {/* Stepper with animated progress */}
      <div className="rounded-xl border border-[#e8d2a6]/70 bg-white/70 px-3 pb-2 pt-2">
        <ol className="flex items-center justify-between gap-2">
          {steps.map((s, i) => {
            const done = i < stepIndex;
            const current = i === stepIndex;
            return (
              <li key={s.key} className="flex items-center gap-1.5">
                <motion.span
                  layout
                  animate={{ scale: current ? 1.08 : 1 }}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors duration-300 ${
                    done ? "bg-[#c1851a] text-white" : current ? "bg-[#7c1527] text-white" : "bg-[#7c1527]/10 text-[#7c1527]/60"
                  }`}
                >
                  {done ? <CheckIcon className="h-3 w-3" /> : i + 1}
                </motion.span>
                <span className={`text-[12.5px] font-semibold ${current ? "text-[#4a0d1a]" : done ? "text-[#8a6208]" : "text-ink-500"}`}>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#7c1527]/10">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#c1851a] to-[#7c1527]"
            animate={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
            transition={{ type: "spring", stiffness: 140, damping: 20 }}
          />
        </div>
      </div>

      {/* Step body */}
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={step}
          custom={direction}
          initial={{ opacity: 0, x: direction * 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -24 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {step === "slot" && (
            <div className="relative overflow-hidden rounded-3xl border border-[#e8d2a6] bg-gradient-to-b from-[#fffdf7] via-[#fffaf0] to-[#fbf0d8] shadow-[0_24px_44px_-28px_rgba(124,21,39,0.65)]">
              {/* Shimmering gold top edge */}
              <motion.div
                aria-hidden="true"
                className="h-1.5 w-full"
                style={{ backgroundImage: "linear-gradient(90deg,#b8860b,#f7d774,#b8860b,#f7d774,#b8860b)", backgroundSize: "200% 100%" }}
                animate={{ backgroundPositionX: ["0%", "200%"] }}
                transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
              />
              {/* Mandala watermark */}
              <svg
                aria-hidden="true"
                viewBox="0 0 200 200"
                className="pointer-events-none absolute -right-16 top-6 h-72 w-72 text-[#c1851a] opacity-[0.07]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              >
                {[90, 74, 58, 42, 26].map((r, i) => (
                  <circle key={r} cx="100" cy="100" r={r} strokeDasharray={i % 2 ? "2 5" : "10 6"} />
                ))}
                {Array.from({ length: 16 }).map((_, i) => (
                  <ellipse key={i} cx="100" cy="46" rx="6" ry="16" transform={`rotate(${i * 22.5} 100 100)`} />
                ))}
              </svg>

              <div className="relative space-y-4 p-4 sm:p-5">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
                  {/* Picture: gold frame with corner ornaments, shown whole */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="relative self-start"
                  >
                    <div className="rounded-2xl bg-gradient-to-br from-[#b8860b] via-[#f7d774] to-[#b8860b] p-[3px] shadow-[0_18px_32px_-16px_rgba(124,21,39,0.8)]">
                      <div className="overflow-hidden rounded-[13px] bg-[#1c0508]">
                        {banner ? (
                          <img src={banner} onError={fallbackToDefaultEventImage} alt={event.name} className="block h-auto w-full" />
                        ) : (
                          <div className="flex aspect-[12/5] items-center justify-center bg-gradient-to-br from-[#7c1527] to-[#c1440e] font-display text-xl text-white/80">
                            {event.name}
                          </div>
                        )}
                      </div>
                    </div>
                    {["-left-1 -top-1 border-l-2 border-t-2", "-right-1 -top-1 border-r-2 border-t-2", "-bottom-1 -left-1 border-b-2 border-l-2", "-bottom-1 -right-1 border-b-2 border-r-2"].map(
                      (c) => (
                        <span key={c} aria-hidden="true" className={`absolute h-4 w-4 border-[#7c1527] ${c}`} />
                      )
                    )}
                    <div className="mt-3 flex items-center justify-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.2em] text-[#8a6208]" aria-hidden="true">
                      <span className="h-px w-6 shrink-0 bg-[#c1851a]/60" /> <span className="truncate">{event.name}</span> <span className="h-px w-6 shrink-0 bg-[#c1851a]/60" />
                    </div>
                  </motion.div>

                  {/* Details */}
                  <motion.div
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                    className="min-w-0 space-y-3"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      {event.category && (
                        <span className="rounded-full bg-gradient-to-r from-[#7c1527] to-[#b01b2e] px-3 py-1 text-[11px] font-bold tracking-wide text-white shadow-[0_6px_12px_-6px_rgba(124,21,39,0.8)]">
                          {event.category.name}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e8d2a6] bg-white/90 px-3 py-1 text-[11.5px] font-semibold text-[#6b5a4b]">
                        <span className="text-[#c1851a]"><UsersIcon /></span>
                        {event.isFamilyMembersRequired ? `Up to ${maxMembers} family members` : "Open to all devotees"}
                      </span>
                    </div>

                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#8a6208]">
                        <CalendarIcon className="h-3.5 w-3.5" /> {event.dateType === "MULTIPLE" ? "Sacred dates" : "Sacred date"}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(event.dateType === "MULTIPLE" ? (event.eventDates ?? []).map(dayLabel) : [dateText]).map((t, i) => (
                          <motion.span
                            key={t + i}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 + i * 0.06 }}
                            className="rounded-xl border border-[#c1851a]/50 bg-gradient-to-b from-[#fff9e6] to-[#ffefc2] px-3 py-1 text-[13px] font-bold tabular-nums text-[#7c1527] shadow-[0_6px_12px_-8px_rgba(184,134,11,0.8)]"
                          >
                            {t}
                          </motion.span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2" aria-hidden="true">
                      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#c1851a]/60 to-[#c1851a]/10" />
                      <span className="text-[13px] text-[#c1851a]">&#10048;</span>
                      <span className="h-px flex-1 bg-gradient-to-l from-transparent via-[#c1851a]/60 to-[#c1851a]/10" />
                    </div>

                    {event.description && (
                      <p className="text-[13.5px] leading-relaxed text-[#4b4458]">
                        {event.description}
                      </p>
                    )}

                    {event.deityMapping.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#8a6208]">Presiding deities</p>
                        <div className="flex flex-wrap gap-2">
                          {event.deityMapping.map((d, i) => (
                            <motion.span
                              key={d._id}
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: 0.25 + i * 0.07 }}
                              className="inline-flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3.5 text-[12.5px] font-bold text-[#7c1527] shadow-[0_8px_16px_-10px_rgba(124,21,39,0.7)] ring-1 ring-[#e8d2a6]"
                            >
                              <DeityAvatar deity={d} size={32} />
                              {d.name}
                            </motion.span>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                </div>

                {/* Slot picker */}
                {event.isSlotRequired ? (
                  <div className="space-y-3 border-t border-dashed border-[#c1851a]/40 pt-4">
                    <div className="flex items-center justify-center gap-3" aria-hidden="true">
                      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#c1851a]/60" />
                      <span className="flex items-center gap-2 font-display text-[14px] font-bold uppercase tracking-[0.2em] text-[#7c1527]">
                        <motion.span
                          className="inline-block h-4 w-3 rounded-[50%_50%_50%_50%/65%_65%_35%_35%] bg-gradient-to-t from-[#ff7a00] to-[#ffe27a]"
                          animate={{ scaleY: [1, 1.18, 0.95, 1.1, 1], opacity: [1, 0.85, 1, 0.9, 1] }}
                          transition={{ duration: 1.6, repeat: Infinity }}
                        />
                        Choose your slot
                      </span>
                      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#c1851a]/60" />
                    </div>
                    {slotDates.length > 1 && (
                      <div className="flex flex-wrap justify-center gap-2">
                        {slotDates.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setSlotDate(d)}
                            className={`rounded-full border px-4 py-1.5 text-[12.5px] font-bold transition-[background-color,color,box-shadow,transform] hover:-translate-y-0.5 ${
                              slotDate === d
                                ? "border-[#7c1527] bg-gradient-to-r from-[#7c1527] to-[#b01b2e] text-white shadow-[0_8px_16px_-8px_rgba(124,21,39,0.9)]"
                                : "border-[#e8d2a6] bg-white text-[#7c1527] hover:bg-[#fff6dd]"
                            }`}
                          >
                            {dayLabel(d)}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
                      {slots.map((slot, i) => {
                        if (slotDates.length > 1 && iso(slot.date) !== slotDate) return null;
                        const st = seatState(slot);
                        const active = slotIndex === i;
                        return (
                          <motion.button
                            key={`${slot.slotName}-${slot.date}-${i}`}
                            type="button"
                            disabled={st.full}
                            onClick={() => setSlotIndex(i)}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 + i * 0.06 }}
                            whileHover={{ y: -3 }}
                            whileTap={{ scale: 0.97 }}
                            className={`relative flex items-center gap-3 overflow-hidden rounded-2xl border px-3.5 py-3 text-left transition-[box-shadow,border-color,background-color] duration-200 ${
                              active
                                ? "border-[#7c1527] bg-gradient-to-br from-[#fff1c9] via-[#fff9e6] to-white shadow-[0_14px_26px_-12px_rgba(124,21,39,0.8)]"
                                : "border-[#e8d2a6] bg-white hover:border-[#c1851a] hover:shadow-[0_12px_22px_-14px_rgba(184,134,11,0.9)]"
                            } ${st.full ? "cursor-not-allowed opacity-50" : ""}`}
                          >
                            <span
                              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-2 transition-colors ${
                                active ? "bg-[#7c1527] text-white ring-[#f2c14e]" : "bg-[#fff1c9] text-[#b8860b] ring-[#e8d2a6]"
                              }`}
                            >
                              <ClockIcon className="h-5 w-5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] font-bold text-[#3d1a24]">{slot.slotName}</span>
                              <span className="block text-[12px] tabular-nums text-[#5d6479]">
                                {dayLabel(slot.date)} · {formatHHMMDisplay(slot.startTime)} – {formatHHMMDisplay(slot.endTime)}
                              </span>
                              <span className="mt-1.5 flex items-center gap-2">
                                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10">
                                  <motion.span
                                    className={`block h-full rounded-full ${st.tone}`}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${st.pct}%` }}
                                    transition={{ duration: 0.7, delay: 0.25 }}
                                  />
                                </span>
                                <span className="text-[11.5px] font-bold tabular-nums text-[#5d6479]">
                                  {st.left === null ? "Open" : st.full ? "Full" : `${st.left} left`}
                                </span>
                              </span>
                            </span>
                            <AnimatePresence>
                              {active && (
                                <motion.span
                                  initial={{ scale: 0, rotate: -40 }}
                                  animate={{ scale: 1, rotate: 0 }}
                                  exit={{ scale: 0 }}
                                  transition={{ type: "spring", stiffness: 500, damping: 20 }}
                                  className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#7c1527] text-white shadow"
                                >
                                  <CheckIcon className="h-3 w-3" />
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </motion.button>
                        );
                      })}
                    </div>
                    {showValidation && !chosenSlot && <p className="text-center text-[12px] text-crimson-500">Pick a slot to continue.</p>}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-[#c1851a]/50 bg-[#fffaf0] px-3.5 py-2.5 text-center text-[12.5px] text-[#5d6479]">
                    <b className="text-[#7c1527]">No fixed slot.</b> Devotees can take part any time during the event dates.
                  </p>
                )}
              </div>
            </div>
          )}

          {step === "deity" && (
            <div className="space-y-2.5">
              <p className={LABEL}>Choose the deities ({deityIds.length} selected)</p>
              <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(118px,1fr))]">
                {event.deityMapping.map((d, i) => {
                  const on = deityIds.includes(d._id);
                  return (
                    <motion.button
                      key={d._id}
                      type="button"
                      onClick={() => setDeityIds((prev) => (on ? prev.filter((x) => x !== d._id) : [...prev, d._id]))}
                      initial={{ opacity: 0, scale: 0.9, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ delay: i * 0.05, type: "spring", stiffness: 260, damping: 20 }}
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.95 }}
                      className={`relative flex flex-col items-center gap-1.5 rounded-2xl border px-2 pb-2.5 pt-3 text-center transition-[box-shadow,border-color,background-color] duration-200 ${
                        on
                          ? "border-[#7c1527] bg-gradient-to-b from-[#7c1527]/10 to-white shadow-[0_12px_22px_-12px_rgba(124,21,39,0.8)]"
                          : "border-[#e8d2a6] bg-white hover:border-[#c1851a]"
                      }`}
                    >
                      <motion.span animate={{ scale: on ? 1.08 : 1 }} transition={{ type: "spring", stiffness: 300, damping: 16 }}>
                        <DeityAvatar deity={d} size={64} />
                      </motion.span>
                      <span className="text-[13px] font-bold leading-tight text-[#3d1a24]">{d.name}</span>
                      {d.tamilName && <span className="-mt-1 text-[11.5px] font-semibold text-[#b8860b]">{d.tamilName}</span>}
                      <AnimatePresence>
                        {on && (
                          <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            transition={{ type: "spring", stiffness: 500, damping: 20 }}
                            className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#7c1527] text-white shadow"
                          >
                            <CheckIcon className="h-3 w-3" />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  );
                })}
              </div>
              {showValidation && deityIds.length === 0 && <p className="text-[12px] text-crimson-500">Select at least one deity.</p>}
            </div>
          )}

          {step === "family" && (
            <div className="space-y-2">
              <p className={LABEL}>Devotees ({namedDevotees.length}/{maxMembers})</p>
              <AnimatePresence initial={false}>
                {devotees.map((devotee, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-visible"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)_auto] items-start gap-2 pb-1.5">
                      <DevoteeNameField
                        label={`Devotee ${idx + 1}`}
                        value={devotee.name}
                        onChange={(name) => setDevotees((prev) => prev.map((d, i) => (i === idx ? { ...d, name } : d)))}
                        error={showValidation && idx === 0 && !devotee.name.trim() ? "Enter at least one devotee" : undefined}
                      />
                      <DivineListbox
                        label="Nakshatra"
                        value={devotee.nakshatra}
                        onChange={(v) => setDevotees((prev) => prev.map((d, i) => (i === idx ? { ...d, nakshatra: v } : d)))}
                        options={nakshatraOptions}
                        placeholder="Select…"
                        error={showValidation && devotee.name.trim() && !devotee.nakshatra ? "Required" : undefined}
                      />
                      {devotees.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setDevotees((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label="Remove family member"
                          className="mt-[22px] flex h-10 w-10 items-center justify-center rounded-full bg-red-600 text-white shadow transition-transform hover:-translate-y-0.5"
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {devotees.length < maxMembers && (
                <button
                  type="button"
                  onClick={() => setDevotees((prev) => [...prev, { name: "", nakshatra: "" }])}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#c1851a] px-3.5 py-1 text-[12.5px] font-semibold text-amber-700 transition-colors hover:bg-amber-50"
                >
                  <PlusIcon /> Add family member
                </button>
              )}
            </div>
          )}

          {step === "terms" && (
            <div className="space-y-2.5">
              <p className={LABEL}>Terms &amp; conditions</p>
              <div className="max-h-52 overflow-y-auto whitespace-pre-line rounded-xl border border-[#e8d2a6]/70 bg-white px-4 py-3 text-[13px] leading-relaxed text-[#4b4458]">
                {event.termsAndConditions}
              </div>
              <button
                type="button"
                role="checkbox"
                aria-checked={accepted}
                onClick={() => setAccepted((v) => !v)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                  accepted ? "border-[#7c1527] bg-[#7c1527]/5" : "border-[#e8d2a6] bg-white hover:border-[#c1851a]"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                    accepted ? "border-[#7c1527] bg-[#7c1527]" : "border-[#c1851a] bg-white"
                  }`}
                >
                  <AnimatePresence>
                    {accepted && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 22 }}
                      >
                        <CheckIcon className="h-3.5 w-3.5 text-white" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span className="text-[13px] font-semibold text-[#3d1a24]">I have read and agree to the terms and conditions.</span>
              </button>
              {showValidation && !accepted && <p className="text-[12px] text-crimson-500">Tick the box to continue.</p>}
            </div>
          )}

          {step === "payment" && (
            <div className="overflow-hidden rounded-xl border border-[#e8d2a6]/70 bg-white">
              <p className="border-b border-[#e8d2a6]/60 bg-[#fbf3e4] px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7c1527]">
                Booking summary
              </p>
              {[
                { icon: <CalendarIcon className="h-4 w-4" />, k: "Event", v: <><b>{event.name}</b> <span className="text-[#b8860b]">{event.tamilName}</span></> },
                event.isSlotRequired && chosenSlot
                  ? {
                      icon: <ClockIcon className="h-4 w-4" />,
                      k: "Slot",
                      v: (
                        <>
                          <b>{chosenSlot.slotName}</b> · {dayLabel(chosenSlot.date)} · {formatHHMMDisplay(chosenSlot.startTime)} –{" "}
                          {formatHHMMDisplay(chosenSlot.endTime)}
                        </>
                      ),
                    }
                  : { icon: <ClockIcon className="h-4 w-4" />, k: "When", v: <>{dateText}</> },
                chosenDeities.length > 0
                  ? {
                      icon: <UsersIcon />,
                      k: "Deities",
                      v: (
                        <span className="flex flex-wrap gap-1.5">
                          {chosenDeities.map((d) => (
                            <span key={d._id} className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 py-0.5 pl-0.5 pr-2.5 text-[12px] font-semibold text-amber-900 ring-1 ring-amber-200">
                              <DeityAvatar deity={d} size={20} />
                              {d.name}
                            </span>
                          ))}
                        </span>
                      ),
                    }
                  : null,
                event.isFamilyMembersRequired
                  ? {
                      icon: <UsersIcon />,
                      k: `Devotees (${namedDevotees.length})`,
                      v: (
                        <span className="flex flex-wrap gap-1.5">
                          {namedDevotees.map((d, i) => (
                            <span key={i} className="rounded-full bg-[#7c1527]/8 px-2.5 py-0.5 text-[12px] font-semibold text-[#7c1527]">
                              {d.name} <span className="font-medium text-[#7a7f92]">· {d.nakshatra}</span>
                            </span>
                          ))}
                        </span>
                      ),
                    }
                  : null,
                event.termsAndConditions?.trim()
                  ? { icon: <CheckIcon className="h-4 w-4" />, k: "Terms", v: <span className="text-emerald-700">Accepted</span> }
                  : null,
              ]
                .filter((r): r is { icon: React.ReactNode; k: string; v: React.ReactNode } => r !== null)
                .map((row, i) => (
                  <motion.div
                    key={row.k}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.07 }}
                    className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 border-b border-[#e8d2a6]/50 px-3.5 py-2.5 text-[13px] text-[#3d1a24]"
                  >
                    <span className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-[#7c1527]">
                      <span className="text-[#c1851a]">{row.icon}</span>
                      {row.k}
                    </span>
                    <span className="min-w-0">{row.v}</span>
                  </motion.div>
                ))}
              <div className="space-y-1 bg-[#fbf3e4] px-3.5 py-2.5">
                <div className="flex items-center justify-between text-[12.5px] text-[#5d6479]">
                  <span>Event price</span>
                  <span className="tabular-nums">${Number(event.salePrice).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-[#c1851a]/30 pt-1.5">
                  <span className="text-[12px] font-bold uppercase tracking-wider text-[#7c1527]">Total</span>
                  <span className="font-display text-[22px] font-extrabold tabular-nums text-[#7c1527]">
                    ${Number(event.salePrice).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {proceeded && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] text-emerald-800"
          >
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              <CheckIcon className="h-2.5 w-2.5" />
            </span>
            Selection ready. Adding events to the cart is not connected yet, so nothing has been added, charged or saved.
          </motion.p>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-[#e8d2a6]/70 pt-3">
        <button type="button" onClick={() => (stepIndex === 0 ? onBack() : go(-1))} className={GHOST_BTN}>
          {stepIndex === 0 ? "Cancel" : "Back"}
        </button>
        {step === "payment" ? (
          <button type="button" onClick={() => setProceeded(true)} className={PRIMARY_BTN} disabled={proceeded}>
            Add to Cart
          </button>
        ) : (
          <button type="button" onClick={next} className={PRIMARY_BTN}>
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
