import type { AudioClip } from "../ports";

/**
 * What a use case reports back.
 *
 * A refusal is a decision made before any request goes out. A transport failure
 * stays a thrown `TtsError` and travels as `reason: "failed"`, so there is one
 * error vocabulary rather than two. The caller words it with `userMessage`.
 */
export type Refusal =
	"no-profile" | "unknown-provider" | "not-configured" | "cannot-render" | "empty-text";

export type FailureReason = Refusal | "cancelled" | "failed";

export interface Refused {
	ok: false;
	reason: FailureReason;
	/** Context for the message, for example the display name of a provider. */
	detail?: string;
	/** Present when `reason` is "failed". */
	error?: unknown;
}

export type SpeakOutcome = { ok: true } | Refused;

/**
 * A save also hands back what it rendered.
 *
 * Playing that buffer is how "read and save" stays one synthesis rather than
 * two, which matters when the provider charges per character.
 */
export type SaveOutcome = { ok: true; path: string; clip: AudioClip } | Refused;
