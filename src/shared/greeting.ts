// The time of day as people say it, for hellos on screen and by text.

export type DayPart = "morning" | "afternoon" | "evening";

/** Morning before noon, afternoon until six, evening after. */
export function dayPart(date = new Date()): DayPart {
  const hour = date.getHours();
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

/**
 * A text after a quiet stretch opens with a hello, the way a friend's would;
 * one in an ongoing exchange does not. `since` is how long since the last
 * message either way.
 */
export const GREET_AFTER_MS = 3 * 60 * 60_000;

export function withHello(body: string, since: number, date = new Date()): string {
  if (since < GREET_AFTER_MS) return body;
  return `${dayPart(date) === "morning" ? "Morning!" : "Hey!"} ${body}`;
}
