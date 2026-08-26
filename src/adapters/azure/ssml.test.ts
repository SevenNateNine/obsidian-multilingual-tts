import { describe, expect, it } from "vitest";
import { DOMParser, onErrorStopParsing } from "@xmldom/xmldom";
import { buildSsml, escapeXml, supportedRole, supportedStyle } from "./ssml";
import type { VoiceProfile } from "../../core/settings/types";
import type { VoiceInfo } from "../../core/tts/types";

const profile = (overrides: Partial<VoiceProfile> = {}): VoiceProfile => ({
	id: "p1",
	name: "Test",
	description: "",
	providerId: "azure",
	locale: "en-US",
	voiceId: "en-US-JennyNeural",
	rate: 1,
	pitch: 0,
	volume: 100,
	useForAutoDetect: true,
	...overrides,
});

const voice = (overrides: Partial<VoiceInfo> = {}): VoiceInfo => ({
	id: "en-US-JennyNeural",
	displayName: "Jenny",
	locale: "en-US",
	styles: [],
	roles: [],
	...overrides,
});

describe("escapeXml", () => {
	it("escapes the five XML entities", () => {
		expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
	});

	it("escapes ampersand first so entities are not doubled", () => {
		expect(escapeXml("&lt;")).toBe("&amp;lt;");
	});

	it("removes control characters XML cannot represent", () => {
		const input = `a${String.fromCharCode(12)}b${String.fromCharCode(0)}c`;
		expect(escapeXml(input)).toBe("abc");
	});

	it("keeps tab, newline and carriage return", () => {
		expect(escapeXml("a\tb\nc\rd")).toBe("a\tb\nc\rd");
	});

	it("leaves ordinary text alone", () => {
		expect(escapeXml("Ordinary sentence.")).toBe("Ordinary sentence.");
	});
});

describe("buildSsml", () => {
	it("produces a well-formed document for the simplest case", () => {
		const ssml = buildSsml({ text: "Hello.", profile: profile(), voice: voice() });
		expect(ssml).toContain('<voice name="en-US-JennyNeural">');
		expect(ssml).toContain('xml:lang="en-US"');
		expect(ssml).toContain("Hello.");
		expect(ssml.startsWith("<speak")).toBe(true);
		expect(ssml.endsWith("</speak>")).toBe(true);
	});

	// The exact regression from the original plugin's issue #75.
	it("escapes text that would otherwise break the XML", () => {
		const ssml = buildSsml({
			text: "Tom & Jerry <b> a < b",
			profile: profile(),
			voice: voice(),
		});
		expect(ssml).toContain("Tom &amp; Jerry &lt;b&gt; a &lt; b");
		expect(parseXml(ssml)).toBe("ok");
	});

	it("stays parseable with quotes and apostrophes in the text", () => {
		const ssml = buildSsml({
			text: `She said "it's fine" & left`,
			profile: profile(),
			voice: voice(),
		});
		expect(parseXml(ssml)).toBe("ok");
	});

	it("omits prosody entirely at default delivery", () => {
		const ssml = buildSsml({ text: "Hi.", profile: profile(), voice: voice() });
		expect(ssml).not.toContain("<prosody");
	});

	it("emits only the prosody attributes that differ from default", () => {
		const ssml = buildSsml({
			text: "Hi.",
			profile: profile({ rate: 1.25, pitch: -10, volume: 80 }),
			voice: voice(),
		});
		expect(ssml).toContain('rate="1.25"');
		expect(ssml).toContain('pitch="-10%"');
		expect(ssml).toContain('volume="80"');
	});

	it("signs a positive pitch", () => {
		const ssml = buildSsml({
			text: "Hi.",
			profile: profile({ pitch: 15 }),
			voice: voice(),
		});
		expect(ssml).toContain('pitch="+15%"');
	});

	it("omits express-as when the voice supports no styles", () => {
		const ssml = buildSsml({
			text: "Hi.",
			profile: profile({ style: "cheerful", role: "Girl" }),
			voice: voice({ styles: [], roles: [] }),
		});
		expect(ssml).not.toContain("express-as");
	});

	it("emits express-as when the voice does support the style", () => {
		const ssml = buildSsml({
			text: "Hi.",
			profile: profile({ style: "cheerful" }),
			voice: voice({ styles: ["cheerful", "sad"] }),
		});
		expect(ssml).toContain('<mstts:express-as style="cheerful">');
	});

	it("drops a style the voice does not advertise", () => {
		const ssml = buildSsml({
			text: "Hi.",
			profile: profile({ style: "advertisement_upbeat" }),
			voice: voice({ styles: ["cheerful"] }),
		});
		expect(ssml).not.toContain("express-as");
	});

	it("includes styledegree only alongside a supported style", () => {
		const supported = buildSsml({
			text: "Hi.",
			profile: profile({ style: "sad", styleDegree: 1.5 }),
			voice: voice({ styles: ["sad"] }),
		});
		expect(supported).toContain('styledegree="1.5"');

		const unsupported = buildSsml({
			text: "Hi.",
			profile: profile({ style: "sad", styleDegree: 1.5 }),
			voice: voice({ styles: [] }),
		});
		expect(unsupported).not.toContain("styledegree");
	});

	it("omits styledegree at its default of 1", () => {
		const ssml = buildSsml({
			text: "Hi.",
			profile: profile({ style: "sad", styleDegree: 1 }),
			voice: voice({ styles: ["sad"] }),
		});
		expect(ssml).toContain('style="sad"');
		expect(ssml).not.toContain("styledegree");
	});

	it("emits a role only when the voice advertises it", () => {
		const ssml = buildSsml({
			text: "Hi.",
			profile: profile({ role: "Boy" }),
			voice: voice({ roles: ["Boy", "Girl"] }),
		});
		expect(ssml).toContain('role="Boy"');
	});

	it("emits nothing expressive when the voice is unknown", () => {
		const ssml = buildSsml({
			text: "Hi.",
			profile: profile({ style: "cheerful", role: "Boy" }),
			voice: null,
		});
		expect(ssml).not.toContain("express-as");
		expect(parseXml(ssml)).toBe("ok");
	});

	it("stays parseable with every feature enabled at once", () => {
		const ssml = buildSsml({
			text: "Complex & <tricky> text.",
			profile: profile({
				style: "newscast",
				styleDegree: 1.8,
				role: "YoungAdultFemale",
				rate: 0.9,
				pitch: 5,
				volume: 60,
			}),
			voice: voice({ styles: ["newscast"], roles: ["YoungAdultFemale"] }),
		});
		expect(parseXml(ssml)).toBe("ok");
	});
});

describe("capability gating helpers", () => {
	it("supportedStyle returns null for an unsupported style", () => {
		expect(
			supportedStyle(profile({ style: "x" }), voice({ styles: ["y"] })),
		).toBeNull();
		expect(supportedStyle(profile({ style: "y" }), voice({ styles: ["y"] }))).toBe("y");
		expect(supportedStyle(profile({ style: "y" }), null)).toBeNull();
	});

	it("supportedRole returns null for an unsupported role", () => {
		expect(supportedRole(profile({ role: "x" }), voice({ roles: ["y"] }))).toBeNull();
		expect(supportedRole(profile({ role: "y" }), voice({ roles: ["y"] }))).toBe("y");
	});
});

/**
 * Parse with a real XML parser so malformed SSML fails the test for real,
 * rather than being waved through by a string assertion.
 */
function parseXml(xml: string): string {
	try {
		new DOMParser({ onError: onErrorStopParsing }).parseFromString(
			xml,
			"application/xml",
		);
		return "ok";
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}
