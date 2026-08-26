import { describe, expect, it } from "vitest";
import { mapSpeechErrorCode } from "./SystemProvider";

describe("mapSpeechErrorCode", () => {
	it("maps browser-blocked codes to blocked", () => {
		expect(mapSpeechErrorCode("not-allowed").kind).toBe("blocked");
		expect(mapSpeechErrorCode("audio-busy").kind).toBe("blocked");
		expect(mapSpeechErrorCode("audio-hardware").kind).toBe("blocked");
	});

	it("maps voice codes to no-voice", () => {
		expect(mapSpeechErrorCode("language-unavailable").kind).toBe("no-voice");
		expect(mapSpeechErrorCode("voice-unavailable").kind).toBe("no-voice");
	});

	it("maps request codes to invalid-request", () => {
		expect(mapSpeechErrorCode("text-too-long").kind).toBe("invalid-request");
		expect(mapSpeechErrorCode("invalid-argument").kind).toBe("invalid-request");
	});

	it("maps network to network", () => {
		expect(mapSpeechErrorCode("network").kind).toBe("network");
	});

	it("keeps an unrecognized code as unknown, with the code as detail", () => {
		const result = mapSpeechErrorCode("synthesis-unavailable");
		expect(result.kind).toBe("unknown");
		expect(result.detail).toBe("synthesis-unavailable");
	});

	it("gives every mapped code a non-empty detail", () => {
		const codes = [
			"not-allowed",
			"audio-busy",
			"audio-hardware",
			"language-unavailable",
			"voice-unavailable",
			"text-too-long",
			"invalid-argument",
			"network",
		];
		for (const code of codes) {
			expect(mapSpeechErrorCode(code).detail.length).toBeGreaterThan(0);
		}
	});
});
