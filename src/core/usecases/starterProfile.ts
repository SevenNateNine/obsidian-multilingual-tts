import { createProfile, type VoiceProfile } from "../settings/types";
import type { VoiceInfo } from "../tts/types";

/**
 * The profile a fresh install starts with.
 *
 * A new install has no profiles, so nothing can play. Seeding one from the
 * default voice of the platform makes "Read selection" work immediately, with
 * no account and no configuration.
 */
export function starterProfile(voice: VoiceInfo | null): VoiceProfile {
	return createProfile({
		name: voice ? `System — ${voice.displayName}` : "System voice",
		description: "Created automatically. Edit or replace it in settings.",
		provider: "system",
		locale: voice?.locale ?? "en-US",
		voiceId: voice?.id ?? "",
	});
}
