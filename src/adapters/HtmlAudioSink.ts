import type { AudioClip, AudioSink } from "../core/ports";
import { TtsError } from "../core/errors";

/**
 * Plays audio through one long-lived HTMLAudioElement.
 *
 * The element belongs to us, so pause, resume and stop are public DOM calls.
 * The original plugin drove pause and resume through
 * `audioConfig.privDestination.privAudio` of the speech SDK. That property is
 * undocumented and breaks on an SDK update.
 */
export class HtmlAudioSink implements AudioSink {
	private audioEl: HTMLAudioElement | null = null;
	private objectUrl: string | null = null;

	play(clip: AudioClip, signal: AbortSignal, onStarted?: () => void): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.releaseObjectUrl();

			const blob = new Blob([clip.data], { type: clip.mimeType });
			const url = URL.createObjectURL(blob);
			this.objectUrl = url;

			const el = this.audioEl ?? new Audio();
			this.audioEl = el;
			el.src = url;

			let settled = false;
			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				el.onended = null;
				el.onerror = null;
				signal.removeEventListener("abort", onAbort);
				fn();
			};

			const onAbort = () => {
				el.pause();
				finish(() => reject(new TtsError("cancelled", "aborted")));
			};

			el.onended = () => finish(resolve);
			el.onerror = () =>
				finish(() =>
					reject(new TtsError("unknown", "Could not play the generated audio")),
				);

			signal.addEventListener("abort", onAbort, { once: true });

			el.play().then(
				() => {
					if (!settled) onStarted?.();
				},
				(err) => finish(() => reject(err)),
			);
		});
	}

	pause(): void {
		this.audioEl?.pause();
	}

	resume(): void {
		void this.audioEl?.play();
	}

	stop(): void {
		this.audioEl?.pause();
		this.releaseObjectUrl();
		this.audioEl?.removeAttribute("src");
	}

	dispose(): void {
		this.stop();
		this.audioEl = null;
	}

	private releaseObjectUrl(): void {
		if (!this.objectUrl) return;
		URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = null;
	}
}
