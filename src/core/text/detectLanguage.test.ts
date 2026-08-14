import { describe, expect, it } from "vitest";
import { selectProfile, type DetectOptions } from "./detectLanguage";
import { isDetectable, languageSubtag, toIso6391, toIso6393 } from "./languages";
import { francDetector } from "../../adapters/francDetector";
import { createProfile, type VoiceProfile } from "../settings/types";

const opts: DetectOptions = { enabled: true, minChars: 30 };

const profile = (name: string, locale: string, auto = true): VoiceProfile =>
	createProfile({ name, locale, useForAutoDetect: auto, voiceId: `${locale}-voice` });

const FRENCH =
	"Bonjour, ceci est un texte assez long en français pour permettre la détection.";
const ENGLISH =
	"Hello there, this is a reasonably long English sentence for detection purposes.";

describe("language code mapping", () => {
	it("extracts the language subtag from a locale", () => {
		expect(languageSubtag("fr-FR")).toBe("fr");
		expect(languageSubtag("zh-CN")).toBe("zh");
		expect(languageSubtag("EN_us")).toBe("en");
		expect(languageSubtag("de")).toBe("de");
	});

	it("uses the individual codes franc actually emits", () => {
		expect(toIso6393("zh-CN")).toBe("cmn");
		expect(toIso6393("ar-EG")).toBe("arb");
		expect(toIso6393("fa-IR")).toBe("pes");
		expect(toIso6393("sw-KE")).toBe("swh");
		expect(toIso6393("sq-AL")).toBe("als");
	});

	it("round-trips the common languages", () => {
		for (const locale of ["fr-FR", "en-US", "de-DE", "ja-JP", "zh-CN", "es-ES"]) {
			const three = toIso6393(locale)!;
			expect(toIso6391(three)).toBe(languageSubtag(locale));
		}
	});

	it("prefers nb over no for Norwegian Bokmal", () => {
		expect(toIso6391("nob")).toBe("nb");
	});

	it("reports unmapped languages rather than guessing", () => {
		expect(toIso6393("xx-XX")).toBeNull();
		expect(isDetectable("xx-XX")).toBe(false);
		expect(isDetectable("fr-FR")).toBe(true);
	});
});

describe("selectProfile", () => {
	const fr = profile("French narrator", "fr-FR");
	const en = profile("English reader", "en-US");

	it("returns null when there are no profiles at all", () => {
		expect(selectProfile(FRENCH, [], null, opts, francDetector)).toBeNull();
	});

	// The real integration: franc's own model, not a stub.
	it("picks the French profile for French text", () => {
		const result = selectProfile(FRENCH, [fr, en], en, opts, francDetector)!;
		expect(result.profile.id).toBe(fr.id);
		expect(result.detected).toBe("fr");
		expect(result.reason).toBe("detected");
	});

	it("picks the English profile for English text", () => {
		const result = selectProfile(ENGLISH, [fr, en], fr, opts, francDetector)!;
		expect(result.profile.id).toBe(en.id);
		expect(result.detected).toBe("en");
	});

	it("falls back on text shorter than the threshold", () => {
		const result = selectProfile("Bonjour", [fr, en], en, opts, francDetector)!;
		expect(result.profile.id).toBe(en.id);
		expect(result.reason).toBe("too-short");
	});

	it("falls back when detection is disabled", () => {
		const result = selectProfile(
			FRENCH,
			[fr, en],
			en,
			{ ...opts, enabled: false },
			francDetector,
		)!;
		expect(result.profile.id).toBe(en.id);
		expect(result.reason).toBe("disabled");
	});

	it("does not guess when every candidate is the same language", () => {
		const fr2 = profile("Other French", "fr-CA");
		const result = selectProfile(ENGLISH, [fr, fr2], fr, opts, francDetector)!;
		expect(result.reason).toBe("no-candidates");
		expect(result.profile.id).toBe(fr.id);
	});

	it("ignores profiles opted out of auto-detection", () => {
		const optedOut = profile("French narrator", "fr-FR", false);
		const result = selectProfile(FRENCH, [optedOut, en], en, opts, francDetector)!;
		expect(result.profile.id).toBe(en.id);
	});

	it("uses list order as the tie-break between same-language profiles", () => {
		const frA = profile("French A", "fr-FR");
		const frB = profile("French B", "fr-CA");
		const result = selectProfile(FRENCH, [frA, frB, en], en, opts, francDetector)!;
		expect(result.profile.id).toBe(frA.id);
	});

	it("falls back when the detected language has no profile", () => {
		const detector = () => "deu";
		const result = selectProfile(FRENCH, [fr, en], en, opts, detector)!;
		expect(result.reason).toBe("no-match");
		expect(result.detected).toBe("de");
		expect(result.profile.id).toBe(en.id);
	});

	it("falls back when franc cannot decide", () => {
		const detector = () => "und";
		const result = selectProfile(FRENCH, [fr, en], en, opts, detector)!;
		expect(result.reason).toBe("undetermined");
		expect(result.profile.id).toBe(en.id);
	});

	it("distinguishes scripts, not just Latin languages", () => {
		const ja = profile("Japanese", "ja-JP");
		const text = "これは日本語のテキストです。自動検出をテストするために書かれました。";
		const result = selectProfile(text, [ja, en], en, opts, francDetector)!;
		expect(result.profile.id).toBe(ja.id);
		expect(result.detected).toBe("ja");
	});
});
