/**
 * Owner-vs-buyer access for show pages and ticket purchase.
 * Pure: unit-tested. A comedian must never buy/claim tickets for their
 * own show — they get management CTAs instead, and the purchase API
 * rejects them with 403.
 */

interface Owned {
  comedian_id: string;
}

/** True when the viewer owns the show (comedian id matches). Logged-out viewers are never owners. */
export function isShowOwner(viewerId: string | null | undefined, show: Owned): boolean {
  return typeof viewerId === 'string' && viewerId.length > 0 && viewerId === show.comedian_id;
}

export type TicketSectionMode = 'owner' | 'held' | 'buy';

/**
 * Which ticket section to render on the show page. Owner wins even when a
 * legacy ticket row exists: the owner manages the show, they never buy it.
 */
export function ticketSectionMode(opts: { isOwner: boolean; ticketHeld: boolean }): TicketSectionMode {
  if (opts.isOwner) return 'owner';
  return opts.ticketHeld ? 'held' : 'buy';
}

/**
 * Server-side purchase guard. Returns a rejection reason when the buyer
 * owns the show, null when the purchase may proceed. The tickets API
 * turns a non-null reason into a 403 that cannot be bypassed from the UI.
 */
export function ownerPurchaseBlockReason(buyerId: string, show: Owned): string | null {
  if (buyerId === show.comedian_id) {
    return 'comedians cannot buy tickets for their own show';
  }
  return null;
}
