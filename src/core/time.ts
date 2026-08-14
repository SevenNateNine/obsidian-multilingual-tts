/**
 * Human-readable timestamps.
 *
 * Built on Intl so the wording follows the reader's own locale, and free of
 * Obsidian imports so both functions are directly unit testable.
 */

interface Unit {
	name: Intl.RelativeTimeFormatUnit;
	ms: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Largest first, so the biggest unit that fits is the one used. */
const UNITS: Unit[] = [
	{ name: "year", ms: 365 * DAY },
	{ name: "month", ms: 30 * DAY },
	{ name: "week", ms: 7 * DAY },
	{ name: "day", ms: DAY },
	{ name: "hour", ms: HOUR },
	{ name: "minute", ms: MINUTE },
];

/** Below this, "just now" reads better than "0 minutes ago". */
const JUST_NOW_MS = MINUTE;

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
	if (!Number.isFinite(timestamp)) return "unknown";

	const elapsed = now - timestamp;
	if (Math.abs(elapsed) < JUST_NOW_MS) return "just now";

	const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	for (const unit of UNITS) {
		if (Math.abs(elapsed) < unit.ms) continue;
		// Negative because the value is in the past relative to `now`.
		const value = Math.round(-elapsed / unit.ms);
		return formatter.format(value, unit.name);
	}

	return "just now";
}

export function formatAbsoluteTime(timestamp: number): string {
	if (!Number.isFinite(timestamp)) return "";
	return new Date(timestamp).toLocaleString();
}
