import type { AudioPlayer } from "../audio/AudioPlayer";
import type { ProviderRegistry } from "../tts/registry";
import type { VoiceProfile } from "../settings/types";
import { isCancellation } from "../errors";
import { prepareForSpeech, type PreparationSettings } from "./prepare";
import type { SpeakOutcome } from "./outcomes";

export interface SpeakDeps {
	providers: ProviderRegistry;
	player: AudioPlayer;
	settings: PreparationSettings;
}

/** Prepare `rawText`, then speak it. */
export async function speak(
	deps: SpeakDeps,
	rawText: string,
	profile: VoiceProfile,
): Promise<SpeakOutcome> {
	const text = prepareForSpeech(deps.settings, rawText);
	if (!text) return { ok: false, reason: "empty-text" };
	return speakPrepared(deps, text, profile);
}

/**
 * Speak text that is already prepared.
 *
 * Separate from `speak` because the read path prepares first, detects the
 * language on the prepared text, and must not strip it a second time.
 */
export async function speakPrepared(
	deps: SpeakDeps,
	text: string,
	profile: VoiceProfile,
): Promise<SpeakOutcome> {
	const provider = deps.providers.get(profile.provider);
	if (!provider) {
		return { ok: false, reason: "unknown-provider", detail: profile.provider };
	}
	if (!provider.isConfigured()) {
		return { ok: false, reason: "not-configured", detail: provider.displayName };
	}

	try {
		await deps.player.play(provider, profile, text);
		return { ok: true };
	} catch (err) {
		if (isCancellation(err)) return { ok: false, reason: "cancelled" };
		return { ok: false, reason: "failed", error: err };
	}
}
