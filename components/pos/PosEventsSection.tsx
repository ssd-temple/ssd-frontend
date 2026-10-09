"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { ListboxOption } from "../divine/DivineListbox";
import PosEventBooking, { type EventSelection } from "./PosEventBooking";
import { CalendarIcon, UsersIcon } from "../divine/icons";
import { formatHHMMDisplay, formatTempleDate, parseISODateString, toISODateString } from "../../lib/datetime";
import { resolveImageUrl } from "../../lib/imageUrl";

export type PosEventSlot = {
  slotName: string;
  date: string;
  startTime: string;
  endTime: string;
  totalSeats: number;
  bookedSeats?: number;
  /** Seats temporarily held by open carts - taken off the free seats until they are booked or let go. */
  heldSeats?: number;
};

export type PosEvent = {
  _id: string;
  code: string;
  name: string;
  tamilName?: string;
  description?: string;
  image: string | null;
  sliderImage: string | null;
  category: { _id: string; name: string; color?: string } | null;
  deityMapping: { _id: string; name: string; tamilName?: string; image?: string | null; color?: string }[];
  dateType?: "SINGLE" | "MULTIPLE" | "RANGE";
  eventDates?: string[];
  startDate: string;
  endDate: string;
  salePrice: number;
  isSlotRequired: boolean;
  slotDetails: PosEventSlot[];
  isFamilyMembersRequired?: boolean;
  maxFamilyMembers?: number;
  termsAndConditions?: string;
};

/** Used for any event that has no picture of its own (or whose picture fails to load). */
export const DEFAULT_EVENT_IMAGE = "/sample-events/chaturthi.svg";

export function eventImageSrc(event: Pick<PosEvent, "image" | "sliderImage">): string {
  return resolveImageUrl(event.image || event.sliderImage) ?? DEFAULT_EVENT_IMAGE;
}

/** Swaps in the default picture if the event's own one cannot be loaded. */
export function fallbackToDefaultEventImage(e: { currentTarget: HTMLImageElement }) {
  const img = e.currentTarget;
  if (!img.src.endsWith(DEFAULT_EVENT_IMAGE)) img.src = DEFAULT_EVENT_IMAGE;
}

/** Slots have no id of their own: name + day + start time identify one (mirrors the server's slotKeyOf). */
export function slotKeyOf(slot: Pick<PosEventSlot, "slotName" | "date" | "startTime">): string {
  return `${slot.slotName}|${slot.date.slice(0, 10)}|${slot.startTime}`;
}

const iso = (value: string) => value.slice(0, 10);
const asDate = (value: string) => parseISODateString(iso(value));

function shortDay(value: string) {
  const d = asDate(value);
  return d ? d.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" }) : "";
}

function daysBetween(fromIso: string, toIso: string) {
  const a = parseISODateString(fromIso);
  const b = parseISODateString(toIso);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** "Happening today" / "Tomorrow" / "In 5 days" — what the cashier can say out loud to a devotee. */
function statusBadge(event: PosEvent, today: string) {
  const start = iso(event.startDate);
  const end = iso(event.endDate);
  if (event.dateType === "MULTIPLE") {
    const upcoming = [...(event.eventDates ?? [])].map(iso).sort().filter((d) => d >= today);
    if (upcoming[0] === today) return { label: "Today", tone: "live" as const };
    if (upcoming[0]) return badgeFromDays(daysBetween(today, upcoming[0]));
  }
  if (today >= start && today <= end) {
    return { label: start === end ? "Today" : "Happening now", tone: "live" as const };
  }
  return badgeFromDays(daysBetween(today, start));
}

function badgeFromDays(days: number) {
  if (days <= 0) return { label: "Today", tone: "live" as const };
  if (days === 1) return { label: "Tomorrow", tone: "soon" as const };
  return { label: `In ${days} days`, tone: days <= 7 ? ("soon" as const) : ("later" as const) };
}

function EventDates({ event, today }: { event: PosEvent; today: string }) {
  if (event.dateType === "MULTIPLE") {
    const dates = [...(event.eventDates ?? [])].map(iso).sort();
    const upcoming = dates.filter((d) => d >= today);
    const shown = (upcoming.length > 0 ? upcoming : dates).slice(0, 4);
    const extra = (upcoming.length > 0 ? upcoming : dates).length - shown.length;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((d) => (
          <span
            key={d}
            className="rounded-md border border-[#7c1527]/20 bg-[#7c1527]/5 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-[#7c1527]"
          >
            {shortDay(d)}
          </span>
        ))}
        {extra > 0 && <span className="text-[12px] font-medium text-ink-500">+{extra} more</span>}
      </div>
    );
  }

  const start = formatTempleDate(asDate(event.startDate));
  if (event.dateType === "SINGLE" || iso(event.startDate) === iso(event.endDate)) {
    return <span className="text-[13.5px] font-semibold text-ink-100">{shortDay(event.startDate)}, {start.slice(-4)}</span>;
  }
  return (
    <span className="text-[13.5px] font-semibold tabular-nums text-ink-100">
      {shortDay(event.startDate)} <span className="mx-1 text-[#7c1527]/60">→</span> {shortDay(event.endDate)}
      <span className="ml-1.5 text-[12px] font-medium text-ink-500">
        ({daysBetween(iso(event.startDate), iso(event.endDate)) + 1} days)
      </span>
    </span>
  );
}

const GOLD_RIBBON = {
  live: "from-emerald-600 via-emerald-500 to-emerald-400 shadow-[0_8px_18px_-6px_rgba(16,185,129,0.7)]",
  soon: "from-[#b8860b] via-[#e0a82e] to-[#f2c14e] shadow-[0_8px_18px_-6px_rgba(184,134,11,0.75)]",
  later: "from-[#b8860b] via-[#e0a82e] to-[#f2c14e] shadow-[0_8px_18px_-6px_rgba(184,134,11,0.75)]",
};

/**
 * Ribbon style, compact: artwork on the left with a gold ribbon and a sweep
 * across its foot, a short summary on the right. Slots, deities and family
 * details live in the booking flow that opens when the card is picked.
 */
function EventCard({
  event,
  today,
  index,
  onSelect,
}: {
  event: PosEvent;
  today: string;
  index: number;
  onSelect: (event: PosEvent) => void;
}) {
  const banner = eventImageSrc(event);
  const badge = statusBadge(event, today);
  const firstSlot = event.isSlotRequired ? event.slotDetails?.[0] : undefined;
  const slotCount = event.isSlotRequired ? (event.slotDetails ?? []).length : 0;

  return (
    <motion.article
      role="button"
      tabIndex={0}
      aria-label={`${event.name} - book`}
      onClick={() => onSelect(event)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(event);
        }
      }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.06, 0.3) }}
      className="group relative grid shrink-0 cursor-pointer grid-cols-[minmax(0,34%)_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[#e8d2a6]/70 bg-gradient-to-br from-white via-[#fffdf8] to-[#fbf3e4] shadow-[0_12px_28px_-18px_rgba(124,21,39,0.5)] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-20px_rgba(124,21,39,0.6)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c1851a]"
    >
      {/* Artwork side */}
      <div className="relative min-h-[8.75rem] overflow-hidden bg-gradient-to-br from-[#7c1527] to-[#c1440e]">
        {banner && (
          <img
            src={banner}
            onError={fallbackToDefaultEventImage}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-black/10" />

        <div className="absolute bottom-1 left-0 z-20">
          <span className="absolute -left-3 top-0 h-full w-6 rounded-l-md bg-gradient-to-b from-[#8a6208] to-[#b8860b]" aria-hidden="true" />
          <span
            className={`relative flex items-center gap-1.5 rounded-r-xl bg-gradient-to-r py-1.5 pl-3.5 pr-3 text-[12px] font-bold tracking-wide text-white ${GOLD_RIBBON[badge.tone]}`}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {badge.label}
          </span>
        </div>

        <svg
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 w-full"
          viewBox="0 0 400 80"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`ribbon-gold-${event._id}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#b8860b" />
              <stop offset="0.5" stopColor="#f2c14e" />
              <stop offset="1" stopColor="#d9a21f" />
            </linearGradient>
          </defs>
          <path d="M0 22 C120 22 250 52 400 80 L0 80 Z" fill={`url(#ribbon-gold-${event._id})`} />
          <path d="M0 36 C120 36 245 62 400 80 L0 80 Z" fill="#fffdf8" />
        </svg>
      </div>

      {/* Details side */}
      <div className="flex min-w-0 flex-col gap-1.5 p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-display text-[19px] font-extrabold leading-tight tracking-tight text-[#4a0d1a]">{event.name}</h3>
            {event.tamilName && <p className="truncate text-[13px] font-semibold text-[#b8860b]">{event.tamilName}</p>}
          </div>
          {event.category && (
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-[#e8d2a6] bg-white/80 px-2.5 py-0.5 text-[11px] font-semibold text-[#7c1527] sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c1851a]" />
              {event.category.name}
            </span>
          )}
        </div>

        {event.description && <p className="line-clamp-2 text-[12.5px] leading-snug text-[#5d6479]">{event.description}</p>}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[#3d3550]">
          <span className="text-[#c1851a]">
            <CalendarIcon className="h-4 w-4" />
          </span>
          <EventDates event={event} today={today} />
          {firstSlot && (
            <>
              <span className="h-3.5 w-px bg-[#c1851a]/50" aria-hidden="true" />
              <span className="text-[12.5px] tabular-nums text-[#5d6479]">
                {formatHHMMDisplay(firstSlot.startTime)} – {formatHHMMDisplay(firstSlot.endTime)}
                {slotCount > 1 && <span className="ml-1 font-semibold text-[#7c1527]">+{slotCount - 1}</span>}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-[#6b5a4b]">
            <span className="text-[#c1851a]">
              <UsersIcon />
            </span>
            {event.isFamilyMembersRequired ? `Up to ${event.maxFamilyMembers ?? 2} family members` : "Open to all devotees"}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-gradient-to-r from-[#7c1527] to-[#b01b2e] px-3.5 py-1 text-[14px] font-bold tabular-nums text-white shadow-[0_8px_16px_-8px_rgba(124,21,39,0.8)]">
              ${Number(event.salePrice).toFixed(2)}
            </span>
            <span className="hidden rounded-full border border-[#7c1527]/30 px-3 py-1 text-[12px] font-semibold text-[#7c1527] transition-colors group-hover:bg-[#7c1527] group-hover:text-white sm:inline">
              Book
            </span>
          </span>
        </div>
      </div>
    </motion.article>
  );
}

/**
 * POS Portal "Events" tab body — live and upcoming temple events as banner
 * cards (image, dates, description, slot availability). Display only for
 * now: events are not added to the cart from here.
 */
export default function PosEventsSection({
  events,
  nakshatraOptions,
  onSubmitSelection,
  editing,
  onCancelEdit,
  cartHolds,
  onRefresh,
}: {
  events: PosEvent[];
  nakshatraOptions: ListboxOption[];
  /** Seats this cart already holds, per event and slot (eventId -> slotKey -> seats). */
  cartHolds?: Record<string, Record<string, number>>;
  /** Re-reads the events list so seat counts are current (called when a card is opened). */
  onRefresh?: () => void;
  /** Adds a cart line, or - when lineId is set - updates the one being edited. */
  onSubmitSelection: (event: PosEvent, selection: EventSelection, lineId: string | null) => boolean | Promise<boolean>;
  /** Set when a cart line's Edit button was pressed: the flow opens on that event, pre-filled. */
  editing: { event: PosEvent; selection: EventSelection; lineId: string } | null;
  onCancelEdit: () => void;
}) {
  const today = toISODateString(new Date());
  // Kept as an id and looked up in the live list, so a refresh while the booking
  // flow is open shows the current seat counts.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = events.find((e) => e._id === selectedId) ?? null;

  if (editing) {
    return (
      <PosEventBooking
        key={editing.lineId}
        event={events.find((e) => e._id === editing.event._id) ?? editing.event}
        initial={editing.selection}
        cartHolds={cartHolds?.[editing.event._id]}
        nakshatraOptions={nakshatraOptions}
        onBack={onCancelEdit}
        onSubmit={(selection) => void onSubmitSelection(editing.event, selection, editing.lineId)}
      />
    );
  }

  if (selected) {
    return (
      <PosEventBooking
        event={selected}
        nakshatraOptions={nakshatraOptions}
        cartHolds={cartHolds?.[selected._id]}
        onBack={() => setSelectedId(null)}
        onSubmit={async (selection) => {
          // Stay in the flow if the line could not be added (e.g. no customer could be resolved).
          if (await onSubmitSelection(selected, selection, null)) setSelectedId(null);
        }}
      />
    );
  }

  return (
    <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-1 content-start gap-4 overflow-y-auto pb-2 pr-1 2xl:grid-cols-2">
      {events.map((event, i) => (
        <EventCard
          key={event._id}
          event={event}
          today={today}
          index={i}
          onSelect={(e) => {
            onRefresh?.(); // seat counts may have moved since the list was loaded
            setSelectedId(e._id);
          }}
        />
      ))}
    </div>
  );
}
