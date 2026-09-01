import type {
	SpeakingProvider,
	SynthesisRequest,
	VoiceInfo,
	VoiceListStatus,
} from "../../core/tts/types";
import { SYSTEM_PROVIDER_ID } from "../../core/tts/providerTypes";
import { TtsError, type TtsErrorKind } from "../../core/errors";

/**
 * Platform voices via the Web Speech API.
 *
 * Free, offline, no API key, and available on Obsidian desktop and mobile. It
 * cannot hand back audio data, so profiles using it can play but not save.
 *
 * There is exactly one of these, at a fixed id: the device is the account.
 */
export class SystemProvider implements SpeakingProvider {
	readonly kind = "speaking" as const;
	readonly type = "system" as const;
	readonly id = SYSTEM_PROVIDER_ID;
	readonly displayName = "System voices";

	/**
	 * Chromium stops speaking after roughly fifteen seconds of a single
	 * utterance, so system chunks have to be far smaller than Azure's.
	 */
	readonly maxChunkChars = 200;

	private voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

	isConfigured(): boolean {
		return typeof window !== "undefined" && "speechSynthesis" in window;
	}

	async listVoices(): Promise<VoiceInfo[]> {
		const voices = await this.loadVoices();
		return voices.map((v) => ({
			...toVoiceInfo(v),
			// The picker marks the platform default so the user can find it.
			displayName: v.default ? `${v.name} (default)` : v.name,
		}));
	}

	/**
	 * Ask the platform again, for a voice installed since Obsidian started.
	 *
	 * The enumeration is cached in a promise, so dropping it is the whole of a
	 * refresh. There is no remote catalog and nothing to invalidate on disk.
	 */
	async refreshVoices(): Promise<VoiceInfo[]> {
		this.voicesPromise = null;
		return this.listVoices();
	}

	async voiceListStatus(): Promise<VoiceListStatus> {
		if (!this.isConfigured()) {
			return { text: "This device has no speech engine.", warning: true };
		}

		const voices = await this.listVoices();
		if (voices.length === 0) {
			return { text: "No voices installed on this device.", warning: true };
		}

		const locales = new Set(voices.map((v) => v.locale)).size;
		return { text: `${voices.length} voices · ${locales} languages`, warning: false };
	}

	/**
	 * The platform's own default voice, used to seed the first profile.
	 *
	 * Returns the shared `VoiceInfo` shape rather than the DOM object, so the
	 * caller does not handle a Web Speech type. The name carries no "(default)"
	 * marker here, because it becomes part of a profile name.
	 */
	async defaultVoice(): Promise<VoiceInfo | null> {
		const voices = await this.loadVoices();
		const chosen = voices.find((v) => v.default) ?? voices[0];
		return chosen ? toVoiceInfo(chosen) : null;
	}

	async speak(req: SynthesisRequest, signal: AbortSignal): Promise<void> {
		if (!this.isConfigured()) {
			throw new TtsError("not-configured", "Web Speech API unavailable");
		}
		if (signal.aborted) throw new TtsError("cancelled", "aborted");

		const voices = await this.loadVoices();
		const voice = voices.find((v) => v.voiceURI === req.profile.voiceId) ?? null;
		if (!voice && req.profile.voiceId) {
			throw new TtsError(
				"no-voice",
				"Voice not installed",
				`"${req.profile.voiceId}" is not available on this device`,
			);
		}

		const utterance = new SpeechSynthesisUtterance(req.text);
		if (voice) utterance.voice = voice;
		utterance.lang = req.profile.locale || voice?.lang || "en-US";
		utterance.rate = clamp(req.profile.rate, 0.1, 10);
		utterance.pitch = clamp(1 + req.profile.pitch / 100, 0, 2);
		utterance.volume = clamp(req.profile.volume / 100, 0, 1);

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", onAbort);
				fn();
			};

			const onAbort = () => {
				window.speechSynthesis.cancel();
				finish(() => reject(new TtsError("cancelled", "aborted")));
			};

			utterance.onend = () => finish(resolve);
			utterance.onerror = (event) => {
				// Cancelling fires an error event in some Chromium builds.
				if (event.error === "canceled" || event.error === "interrupted") {
					finish(() => reject(new TtsError("cancelled", "aborted")));
					return;
				}
				const { kind, detail } = mapSpeechErrorCode(event.error);
				finish(() => reject(new TtsError(kind, "Speech synthesis failed", detail)));
			};

			signal.addEventListener("abort", onAbort, { once: true });
			window.speechSynthesis.speak(utterance);
		});
	}

	pause(): void {
		window.speechSynthesis.pause();
	}

	resume(): void {
		window.speechSynthesis.resume();
	}

	cancel(): void {
		window.speechSynthesis.cancel();
	}

	/**
	 * getVoices() is empty until the engine completes its enumeration. The
	 * voiceschanged event can also fire before this code subscribes to it.
	 */
	private loadVoices(): Promise<SpeechSynthesisVoice[]> {
		if (this.voicesPromise) return this.voicesPromise;

		this.voicesPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
			const existing = window.speechSynthesis.getVoices();
			if (existing.length > 0) {
				resolve(existing);
				return;
			}

			const timeout = window.setTimeout(() => {
				window.speechSynthesis.onvoiceschanged = null;
				resolve(window.speechSynthesis.getVoices());
			}, 2000);

			window.speechSynthesis.onvoiceschanged = () => {
				window.clearTimeout(timeout);
				window.speechSynthesis.onvoiceschanged = null;
				resolve(window.speechSynthesis.getVoices());
			};
		});

		return this.voicesPromise;
	}
}

function toVoiceInfo(voice: SpeechSynthesisVoice): VoiceInfo {
	return {
		id: voice.voiceURI,
		displayName: voice.name,
		locale: voice.lang,
		styles: [],
		roles: [],
	};
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

/**
 * Translate a `SpeechSynthesisErrorEvent.error` code into a kind and a
 * human-readable detail.
 *
 * `canceled` and `interrupted` are handled by the caller before this runs.
 * An unrecognized code keeps kind `unknown` and surfaces the raw code as the
 * detail, so a future or browser-specific code is still visible rather than
 * silently swallowed.
 */
export function mapSpeechErrorCode(code: string): {
	kind: TtsErrorKind;
	detail: string;
} {
	switch (code) {
		case "not-allowed":
			return {
				kind: "blocked",
				detail:
					"the browser blocked speech playback, often because it needs a click in the document first",
			};
		case "audio-busy":
			return { kind: "blocked", detail: "the system audio device is busy" };
		case "audio-hardware":
			return { kind: "blocked", detail: "no audio output device is available" };
		case "language-unavailable":
			return {
				kind: "no-voice",
				detail: "this voice does not support the selected language",
			};
		case "voice-unavailable":
			return { kind: "no-voice", detail: "the selected voice is not available" };
		case "text-too-long":
			return {
				kind: "invalid-request",
				detail: "the selection is too long for the system speech engine",
			};
		case "invalid-argument":
			return {
				kind: "invalid-request",
				detail: "the system speech engine rejected the request",
			};
		case "network":
			return {
				kind: "network",
				detail: "the system speech engine lost its network connection",
			};
		default:
			return { kind: "unknown", detail: code };
	}
}
