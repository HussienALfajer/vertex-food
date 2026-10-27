/**
 * The `signed_in` ticket between the sign-in screen and the registration of this PC (spec S02 rule
 * 44): kept in memory only, never in the URL or storage. It lasts 10 minutes on the server.
 */
let held: string | null = null;

export function holdTicket(ticket: string): void {
  held = ticket;
}

export function heldTicket(): string | null {
  return held;
}

export function dropTicket(): void {
  held = null;
}
