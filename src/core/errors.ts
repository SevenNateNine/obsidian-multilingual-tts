/**
 * Typed failure reasons.
 *
 * The original plugin reported every failure as "Did you set the speech resource
 * key and region values?". That message sent people to look for a credentials
 * problem when the real cause was a network timeout or malformed SSML.
 */
export type TtsErrorKind =
	| "not-configured"
	| "locked"
	| "auth"
	| "quota"
	| "network"
	| "invalid-request"
	| "no-voice"
	| "playback"
	| "corrupt-audio"
	| "blocked"
	| "cancelled"
	| "unknown";

export class TtsError extends Error {
	constructor(
		readonly kind: TtsErrorKind,
		message: string,
		readonly detail?: string,
	) {
		super(message);
		this.name = "TtsError";
	}
}

export function isCancellation(err: unknown): boolean {
	if (err instanceof TtsError) return err.kind === "cancelled";
	return err instanceof DOMException && err.name === "AbortError";
}

/** Map an HTTP status from the Azure REST surface onto a kind. */
export function kindFromHttpStatus(status: number): TtsErrorKind {
	if (status === 401 || status === 403) return "auth";
	if (status === 429) return "quota";
	if (status === 400 || status === 415) return "invalid-request";
	if (status >= 500) return "network";
	return "unknown";
}

const MESSAGES: Record<TtsErrorKind, string> = {
	"not-configured": "This profile isn't fully configured yet.",
	locked: "The speech key is locked. Enter your passphrase to unlock it.",
	auth: "Azure rejected the credentials. Check the speech key and region in settings.",
	quota: "Azure rate limit or quota exceeded. Wait a moment and try again.",
	network: "Couldn't reach the speech service. Check your connection.",
	"invalid-request": "The speech service rejected the request.",
	"no-voice": "The voice this profile uses isn't available.",
	playback: "The audio was generated, but could not play.",
	"corrupt-audio":
		"The speech service returned audio that could not be used. Try again.",
	blocked: "Speech playback was blocked. Try again after clicking into the note.",
	cancelled: "Playback stopped.",
	unknown: "Speech synthesis failed.",
};

export function userMessage(err: unknown): string {
	if (err instanceof TtsError) {
		return err.detail ? `${MESSAGES[err.kind]} (${err.detail})` : MESSAGES[err.kind];
	}
	if (err instanceof Error && err.message) return err.message;
	return MESSAGES.unknown;
}
