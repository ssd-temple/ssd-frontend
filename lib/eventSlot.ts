import { formatHHMMDisplay, formatTempleDate } from "./datetime";

/** The slot an Event line was booked on, as stored on carts, orders and bookings. */
export type EventSlotInfo = {
  slotName: string;
  date: string;
  startTime: string;
  endTime: string;
};

/** "Evening Aarti · 11 Oct 2026 · 6:30 PM – 8:00 PM" - one line, for receipts, lists and the customer display. */
export function formatEventSlot(slot: EventSlotInfo): string {
  return `${slot.slotName} · ${formatTempleDate(new Date(slot.date))} · ${formatHHMMDisplay(slot.startTime)} – ${formatHHMMDisplay(slot.endTime)}`;
}
