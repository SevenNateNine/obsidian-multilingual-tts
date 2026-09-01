import type { VoiceProfile } from "../settings/types";
import { languageSubtag, toIso6391, toIso6393 } from "./languages";
import { identifiesLanguageByScript } from "./scripts";

export type SelectionReason =
	"detected" | "too-short" | "undetermined" | "no-candidates" | "no-match" | "disabled";

export interface ProfileSelection {
	profile: VoiceProfile;
	/** Detected language as a 639-1 subtag, or null when we fell back. */
	detected: string | null;
	reason: SelectionReason;
}

export interface DetectOptions {
	enabled: boolean;
	minChars: number;
}

/**
 * Language identification, injected rather than imported.
 *
 * The implementation is a detail and lives in `adapters/francDetector.ts`. This
 * module stays free of it, so policy has no dependency on the model of franc.
 */
export type Detector = (text: string, only: string[]) => string;

/**
 * Choose the profile to read `text` with.
 *
 * Detection runs against only the languages that the profiles of the user
 * cover, not all 80-odd languages that franc knows. A choice between "the
 * French one" and "the English one" is much more reliable on a short
 * selection than open-world identification. That difference makes this
 * function useful instead of a coin flip on a two-line quote.
 *
 * Always returns a profile when one exists. Detection only changes which one.
 */
export function selectProfile(
	text: string,
	profiles: VoiceProfile[],
	fallback: VoiceProfile | null,
	opts: DetectOptions,
	detect: Detector,
): ProfileSelection | null {
	const chosenFallback = fallback ?? profiles[0];
	if (!chosenFallback) return null;

	if (!opts.enabled) {
		return { profile: chosenFallback, detected: null, reason: "disabled" };
	}
	// The minimum length protects against a guess from too few words. A script
	// that only one language uses needs no words at all, so it skips the gate.
	if (text.trim().length < opts.minChars && !identifiesLanguageByScript(text)) {
		return { profile: chosenFallback, detected: null, reason: "too-short" };
	}

	const candidates = profiles.filter((p) => p.useForAutoDetect);

	// The language of the fallback joins the candidate set, so that a single
	// opted-in profile still has something to be distinguished from. With one
	// language franc has no choice to make and always "detects" that language.
	const languages = new Set<string>();
	for (const profile of candidates) {
		const code = toIso6393(profile.locale);
		if (code) languages.add(code);
	}
	const fallbackCode = toIso6393(chosenFallback.locale);
	if (fallbackCode) languages.add(fallbackCode);

	if (languages.size < 2) {
		return { profile: chosenFallback, detected: null, reason: "no-candidates" };
	}

	const code = detect(text, [...languages]);
	const subtag = code === "und" ? null : toIso6391(code);
	if (!subtag) {
		return { profile: chosenFallback, detected: null, reason: "undetermined" };
	}

	// First match wins, so the settings list order is the tie-break.
	const match = candidates.find((p) => languageSubtag(p.locale) === subtag);
	if (!match) {
		return { profile: chosenFallback, detected: subtag, reason: "no-match" };
	}

	return { profile: match, detected: subtag, reason: "detected" };
}

/**
 * True when detection changed the outcome.
 *
 * The common case stays quiet, and a surprising pick is always traceable.
 */
export function shouldAnnounce(selection: ProfileSelection): boolean {
	return selection.reason === "detected" || selection.reason === "no-match";
}

/** Short explanation for the Notice, so a surprising choice is traceable. */
export function describeSelection(selection: ProfileSelection): string {
	switch (selection.reason) {
		case "detected":
			return `${selection.profile.name} · detected ${selection.detected}`;
		case "no-match":
			return `${selection.profile.name} · no profile for ${selection.detected}`;
		case "too-short":
			return `${selection.profile.name} · text too short to detect`;
		case "undetermined":
			return `${selection.profile.name} · language unclear`;
		case "no-candidates":
			return `${selection.profile.name} · nothing to compare against`;
		case "disabled":
			return selection.profile.name;
	}
}
