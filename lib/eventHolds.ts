"use client";

import { useEffect, useRef } from "react";
import { api, extractErrorMessage, unwrap, type ApiEnvelope } from "./api";

/**
 * Event seat holds for a booking cart (POS counter or Admin Booking).
 *
 * Adding an event to the cart HOLDS its seats on the server, so nobody else
 * can sell them while the cart is open. The hold is given back when the line
 * is removed or edited, the cart is cleared, or - if the terminal is simply
 * closed - when it times out. Confirming the booking turns the held seats
 * into booked seats. All of that is decided by the server; this file only
 * asks. See SSD-Backend common/utils/event-seats.js.
 */

/** "/pos/booking" for the POS counter, "/pos/admin/booking" for the Admin Booking screen. */
export type HoldBase = "/pos/booking" | "/pos/admin/booking";

export type SeatHold = { holdId: string | null; expiresAt: string | null; seats: number };

const CLIENT_ID_KEY = "ssd_event_hold_client";
let memoryClientId: string | null = null;

/**
 * An id for THIS browser tab. It survives a refresh (sessionStorage) but not a
 * new tab, so after a refresh the page can find the holds its old cart left
 * behind - without ever touching a cart open in another tab or terminal.
 */
export function getHoldClientId(): string {
  try {
    const stored = sessionStorage.getItem(CLIENT_ID_KEY);
    if (stored) return stored;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(CLIENT_ID_KEY, fresh);
    return fresh;
  } catch {
    memoryClientId ??= crypto.randomUUID();
    return memoryClientId;
  }
}

/**
 * Run once when a booking screen loads. Its cart starts empty, so any seats
 * its tab's previous cart was still holding (the page was refreshed or
 * crashed) are given back at once instead of waiting for the timeout.
 */
export async function releaseOrphanHolds(base: HoldBase): Promise<void> {
  try {
    await api.post(`${base}/events/holds/release-orphans`, { clientId: getHoldClientId() });
  } catch {
    // Not fatal - the holds expire on their own.
  }
}

/**
 * Best effort when the tab is closed or navigated away: the request is allowed
 * to outlive the page (keepalive), so the seats are freed immediately rather
 * than after the timeout. If it never arrives the hold simply expires.
 */
export function releaseHoldsOnPageHide(base: HoldBase, holdIds: string[]): void {
  if (holdIds.length === 0) return;
  const token = localStorage.getItem("ssd_admin_token");
  const root = api.defaults.baseURL ?? "";
  for (const id of holdIds) {
    try {
      void fetch(`${root}${base}/events/holds/${id}`, {
        method: "DELETE",
        keepalive: true,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      // ignore - expiry is the safety net
    }
  }
}

/** What a cart line needs held: one seat per named devotee when the event asks for family members, otherwise one. */
export function seatsForEvent(event: { isFamilyMembersRequired?: boolean }, devoteeCount: number): number {
  return event.isFamilyMembersRequired ? Math.max(1, devoteeCount) : 1;
}

/**
 * Holds seats - or, with `replaceHoldId`, moves an existing hold (an edited
 * cart line). Throws an Error whose message is ready to show the cashier
 * (e.g. "Only 2 seat(s) left on …"); the old hold is untouched in that case.
 */
export async function holdEventSeats(
  base: HoldBase,
  body: { eventId: string; slotKey: string; seats: number; replaceHoldId?: string | null }
): Promise<SeatHold> {
  try {
    const r = await api.post<ApiEnvelope<SeatHold>>(`${base}/events/holds`, { ...body, clientId: getHoldClientId() });
    return unwrap(r);
  } catch (err) {
    throw new Error(extractErrorMessage(err));
  }
}

/** Gives the seats back. Never throws - a hold that is already gone is fine, and the server times the rest out. */
export async function releaseEventHold(base: HoldBase, holdId: string | null | undefined): Promise<void> {
  if (!holdId) return;
  try {
    await api.delete(`${base}/events/holds/${holdId}`);
  } catch {
    // The hold expires on its own; nothing to tell the cashier.
  }
}

export type HoldRefreshEntry = { lineId: string; holdId: string | null; eventId: string; slotKey: string; seats: number };
export type HoldRefreshResult = { lineId: string; ok: boolean; holdId: string | null; message?: string };

async function refreshEventHolds(base: HoldBase, entries: HoldRefreshEntry[]): Promise<HoldRefreshResult[]> {
  const r = await api.post<
    ApiEnvelope<{ results: { holdId: string | null; ok: boolean; message?: string }[] }>
  >(`${base}/events/holds/refresh`, {
    clientId: getHoldClientId(),
    holds: entries.map(({ holdId, eventId, slotKey, seats }) => ({ holdId, eventId, slotKey, seats })),
  });
  return unwrap(r).results.map((res, i) => ({ lineId: entries[i].lineId, ok: res.ok, holdId: res.holdId, message: res.message }));
}

const HEARTBEAT_MS = 3 * 60 * 1000;

/**
 * Keeps the cart's seat holds alive while the cart is open: every few
 * minutes it extends each hold (and takes it again if it had run out and the
 * seats are still free). `onResult` receives one outcome per line so the
 * screen can store a new hold id, or warn about exactly the line that lost
 * its seats.
 */
export function useEventHoldHeartbeat(
  base: HoldBase,
  entries: HoldRefreshEntry[],
  active: boolean,
  onResult: (results: HoldRefreshResult[]) => void
) {
  const latest = useRef({ entries, onResult });
  useEffect(() => {
    latest.current = { entries, onResult };
  });

  // Closing or leaving the page lets go of the cart's holds right away.
  const holdIdsKey = entries.map((e) => e.holdId).filter(Boolean).join(",");
  useEffect(() => {
    if (!active || !holdIdsKey) return;
    const ids = holdIdsKey.split(",");
    const onHide = () => releaseHoldsOnPageHide(base, ids);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [active, base, holdIdsKey]);

  const hasHolds = active && entries.length > 0;
  useEffect(() => {
    if (!hasHolds) return;
    const timer = setInterval(async () => {
      const current = latest.current.entries;
      if (current.length === 0) return;
      try {
        latest.current.onResult(await refreshEventHolds(base, current));
      } catch {
        // Offline for a moment - the next beat tries again.
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [base, hasHolds]);
}
