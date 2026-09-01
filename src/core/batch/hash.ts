import type { VoiceProfile } from "../settings/types";

/**
 * A fingerprint of everything that decides how a clip sounds.
 *
 * This is what makes a second run free and an edited card not free. "The file
 * exists" alone cannot tell that a typo was corrected in a card, or that the
 * target now names a different voice: both leave the old clip in place and the
 * old link pointing at it.
 *
 * Deliberately not `crypto.subtle`. This is a cache key rather than a checksum,
 * so the value of a synchronous function is higher than the value of a stronger
 * digest: `planBatch` stays pure and needs no injected dependency to be tested.
 * A collision would skip one card that deserved a new clip, at odds near 1 in
 * 4 billion per edit, and clearing the property regenerates it.
 *
 * The audio format is absent on purpose. It changes the file extension, so the
 * destination path already changes with it and the clip is remade anyway.
 */
export interface SynthesisInputs {
	/** Prepared exactly as it will be sent, not the raw property. */
	text: string;
	locale: string;
	voiceId: string;
	rate: number;
	pitch: number;
	volume: number;
	style?: string | undefined;
	styleDegree?: number | undefined;
	role?: string | undefined;
}

/** The delivery half of the inputs, taken from the profile a target names. */
export function synthesisInputs(profile: VoiceProfile, text: string): SynthesisInputs {
	return {
		text,
		locale: profile.locale,
		voiceId: profile.voiceId,
		rate: profile.rate,
		pitch: profile.pitch,
		volume: profile.volume,
		style: profile.style,
		styleDegree: profile.styleDegree,
		role: profile.role,
	};
}

/** 16 hex characters. Stable across runs, platforms and property order. */
export function synthesisHash(inputs: SynthesisInputs): string {
	const canonical = JSON.stringify([
		inputs.text,
		inputs.locale,
		inputs.voiceId,
		inputs.rate,
		inputs.pitch,
		inputs.volume,
		inputs.style ?? "",
		inputs.styleDegree ?? 0,
		inputs.role ?? "",
	]);

	return half(canonical, FNV_OFFSET) + half(canonical, SECOND_OFFSET);
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** A second basis, so the two halves of the value do not move together. */
const SECOND_OFFSET = 0x27d4eb2f;

/** FNV-1a, 32 bits, as eight hex characters. */
function half(value: string, offset: number): string {
	let hash = offset;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
