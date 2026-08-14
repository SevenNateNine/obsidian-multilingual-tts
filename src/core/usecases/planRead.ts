import type { PluginSettings } from "../settings/types";
import { resolveDefaultProfile } from "../settings/types";
import {
	selectProfile,
	type Detector,
	type ProfileSelection,
} from "../text/detectLanguage";
import { prepareForSpeech } from "./prepare";

export type ReadPlan =
	| { ok: true; text: string; selection: ProfileSelection }
	| { ok: false; reason: "empty-text" | "no-profile" };

/**
 * Decide what to read and with which profile.
 *
 * Detection runs on the prepared text, because markdown syntax and URLs skew
 * the result. The caller speaks `text` directly and must not prepare it again.
 */
export function planRead(
	settings: PluginSettings,
	rawText: string,
	detect: Detector,
): ReadPlan {
	const text = prepareForSpeech(settings, rawText);
	if (!text) return { ok: false, reason: "empty-text" };

	const selection = selectProfile(
		text,
		settings.profiles,
		resolveDefaultProfile(settings),
		settings.autoDetect,
		detect,
	);
	if (!selection) return { ok: false, reason: "no-profile" };

	return { ok: true, text, selection };
}
