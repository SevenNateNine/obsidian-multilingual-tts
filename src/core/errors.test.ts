import { describe, expect, it } from "vitest";
import { TtsError, isCancellation, kindFromHttpStatus, userMessage } from "./errors";

describe("kindFromHttpStatus", () => {
	it("maps auth statuses", () => {
		expect(kindFromHttpStatus(401)).toBe("auth");
		expect(kindFromHttpStatus(403)).toBe("auth");
	});

	it("maps quota, invalid-request, and network ranges", () => {
		expect(kindFromHttpStatus(429)).toBe("quota");
		expect(kindFromHttpStatus(400)).toBe("invalid-request");
		expect(kindFromHttpStatus(415)).toBe("invalid-request");
		expect(kindFromHttpStatus(500)).toBe("network");
		expect(kindFromHttpStatus(503)).toBe("network");
	});

	it("falls back to unknown for an unmapped status", () => {
		expect(kindFromHttpStatus(418)).toBe("unknown");
	});
});

describe("isCancellation", () => {
	it("recognizes a cancelled TtsError", () => {
		expect(isCancellation(new TtsError("cancelled", "aborted"))).toBe(true);
	});

	it("recognizes a DOMException AbortError", () => {
		expect(isCancellation(new DOMException("aborted", "AbortError"))).toBe(true);
	});

	it("rejects any other error", () => {
		expect(isCancellation(new TtsError("network", "offline"))).toBe(false);
		expect(isCancellation(new Error("plain"))).toBe(false);
	});
});

describe("userMessage", () => {
	it("renders the kind's generic message with no detail", () => {
		expect(userMessage(new TtsError("unknown", "Speech synthesis failed"))).toBe(
			"Speech synthesis failed.",
		);
	});

	it("appends the detail in parentheses when present", () => {
		expect(
			userMessage(new TtsError("auth", "Azure rejected the credentials", "401")),
		).toBe(
			"Azure rejected the credentials. Check the speech key and region in settings. (401)",
		);
	});

	it("reports a playback failure distinctly from a synthesis failure", () => {
		expect(
			userMessage(new TtsError("playback", "Could not play the generated audio")),
		).toBe("The audio was generated, but could not play.");
	});

	it("reports corrupt or missing audio distinctly from a synthesis failure", () => {
		expect(userMessage(new TtsError("corrupt-audio", "No audio was produced"))).toBe(
			"The speech service returned audio that could not be used. Try again.",
		);
	});

	it("reports a blocked-playback failure with an actionable hint", () => {
		expect(
			userMessage(new TtsError("blocked", "the browser blocked speech playback")),
		).toBe("Speech playback was blocked. Try again after clicking into the note.");
	});

	it("falls back to a plain Error's own message", () => {
		expect(userMessage(new Error("disk full"))).toBe("disk full");
	});

	it("falls back to the generic message for a non-Error value", () => {
		expect(userMessage("not an error")).toBe("Speech synthesis failed.");
	});
});
