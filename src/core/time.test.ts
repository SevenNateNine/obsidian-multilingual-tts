import { describe, expect, it } from "vitest";
import { formatAbsoluteTime, formatRelativeTime } from "./time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NOW = new Date(2026, 7, 10, 12, 0, 0).getTime();
const ago = (ms: number) => formatRelativeTime(NOW - ms, NOW);

describe("formatRelativeTime", () => {
	it("collapses anything under a minute to 'just now'", () => {
		expect(ago(0)).toBe("just now");
		expect(ago(30_000)).toBe("just now");
		expect(ago(MINUTE - 1)).toBe("just now");
	});

	it("switches to minutes at exactly one minute", () => {
		expect(ago(MINUTE)).toMatch(/minute/);
		expect(ago(5 * MINUTE)).toMatch(/5 minutes/);
	});

	it("switches to hours at exactly one hour", () => {
		expect(ago(59 * MINUTE)).toMatch(/minute/);
		expect(ago(HOUR)).toMatch(/hour/);
		expect(ago(3 * HOUR)).toMatch(/3 hours/);
	});

	it("switches to days at exactly one day", () => {
		expect(ago(23 * HOUR)).toMatch(/hour/);
		expect(ago(DAY)).toMatch(/day|yesterday/);
		expect(ago(2 * DAY)).toMatch(/2 days/);
	});

	it("uses the largest unit that fits", () => {
		expect(ago(8 * DAY)).toMatch(/week/);
		expect(ago(45 * DAY)).toMatch(/month/);
		expect(ago(400 * DAY)).toMatch(/year/);
	});

	it("reads as the past, never the future, for an elapsed time", () => {
		expect(ago(3 * HOUR)).not.toMatch(/in \d/);
	});

	it("handles a timestamp slightly ahead of now without breaking", () => {
		expect(formatRelativeTime(NOW + 10_000, NOW)).toBe("just now");
	});

	it("returns a placeholder for a non-finite timestamp", () => {
		expect(formatRelativeTime(NaN, NOW)).toBe("unknown");
	});
});

describe("formatAbsoluteTime", () => {
	it("produces a non-empty local string", () => {
		expect(formatAbsoluteTime(NOW)).not.toBe("");
	});

	it("returns an empty string for a non-finite timestamp", () => {
		expect(formatAbsoluteTime(NaN)).toBe("");
	});
});
