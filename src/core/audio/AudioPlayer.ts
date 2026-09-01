import type { RenderedAudio, RenderingProvider, TtsProvider } from "../tts/types";
import type { VoiceProfile } from "../settings/types";
import type { AudioClip, AudioSink } from "../ports";
import { chunkText } from "./chunker";
import { TtsError, isCancellation } from "../errors";

export type PlaybackState = "idle" | "loading" | "playing" | "paused";

/**
 * Owns the sequencing of playback: chunk order, prefetch, and the state a
 * status bar reads.
 *
 * The transport is an `AudioSink`, so this class holds no DOM. A speaking
 * provider drives its own transport and never reaches the sink.
 */
export class AudioPlayer {
	private state: PlaybackState = "idle";
	private controller: AbortController | null = null;
	private activeProvider: TtsProvider | null = null;

	private readonly stateListeners = new Set<(state: PlaybackState) => void>();

	constructor(private readonly sink: AudioSink) {}

	getState(): PlaybackState {
		return this.state;
	}

	isActive(): boolean {
		return this.state !== "idle";
	}

	onStateChange(fn: (state: PlaybackState) => void): () => void {
		this.stateListeners.add(fn);
		return () => this.stateListeners.delete(fn);
	}

	/**
	 * Speak `text` with `profile`. Any playback already running is stopped first,
	 * so a second invocation replaces rather than overlaps.
	 *
	 * Resolves when playback finishes. Cancellation also resolves. Every other
	 * failure throws a TtsError for the caller to show.
	 */
	async play(
		provider: TtsProvider,
		profile: VoiceProfile,
		text: string,
	): Promise<void> {
		this.stop();

		const chunks = chunkText(text, { maxChars: provider.maxChunkChars });
		if (chunks.length === 0) return;

		const controller = new AbortController();
		this.controller = controller;
		this.activeProvider = provider;
		this.setState("loading");

		try {
			if (provider.kind === "rendering") {
				await this.playRendered(provider, profile, chunks, controller.signal);
			} else {
				await this.playNative(provider, profile, chunks, controller.signal);
			}
		} catch (err) {
			if (!isCancellation(err)) throw err;
		} finally {
			if (this.controller === controller) this.cleanup();
		}
	}

	/**
	 * Play audio that is already rendered.
	 *
	 * The save path holds the finished buffer, so playing it here is what keeps
	 * "read and save" to one synthesis instead of two. The trade-off is that
	 * playback starts after the whole text is rendered, not after the first
	 * chunk as `play` does.
	 */
	async playClip(clip: AudioClip): Promise<void> {
		this.stop();

		const controller = new AbortController();
		this.controller = controller;
		this.setState("loading");

		try {
			await this.sink.play(clip, controller.signal, () => this.setState("playing"));
		} catch (err) {
			if (!isCancellation(err)) throw err;
		} finally {
			if (this.controller === controller) this.cleanup();
		}
	}

	/**
	 * Render chunk n+1 while chunk n plays, so playback starts after the first
	 * chunk instead of after the whole note.
	 */
	private async playRendered(
		provider: RenderingProvider,
		profile: VoiceProfile,
		chunks: string[],
		signal: AbortSignal,
	): Promise<void> {
		const first = chunks[0];
		if (first === undefined) return;

		let pending: Promise<RenderedAudio> = provider.render(
			{ text: first, profile },
			signal,
		);

		for (let i = 0; i < chunks.length; i++) {
			const rendered = await pending;
			if (signal.aborted) throw new TtsError("cancelled", "aborted");

			const next = chunks[i + 1];
			if (next !== undefined) {
				pending = provider.render({ text: next, profile }, signal);
				// A prefetch that rejects while its chunk is still queued becomes
				// an unhandled rejection without this catch. The loop throws the
				// real error again when it awaits the same promise.
				pending.catch(() => undefined);
			}

			await this.sink.play(rendered, signal, () => this.setState("playing"));
		}
	}

	private async playNative(
		provider: Extract<TtsProvider, { kind: "speaking" }>,
		profile: VoiceProfile,
		chunks: string[],
		signal: AbortSignal,
	): Promise<void> {
		for (const chunk of chunks) {
			if (signal.aborted) throw new TtsError("cancelled", "aborted");
			if (this.state === "loading") this.setState("playing");
			await provider.speak({ text: chunk, profile }, signal);
		}
	}

	pause(): void {
		if (this.state !== "playing") return;
		if (this.activeProvider?.kind === "speaking") {
			this.activeProvider.pause();
		} else {
			this.sink.pause();
		}
		this.setState("paused");
	}

	resume(): void {
		if (this.state !== "paused") return;
		if (this.activeProvider?.kind === "speaking") {
			this.activeProvider.resume();
		} else {
			this.sink.resume();
		}
		this.setState("playing");
	}

	togglePause(): void {
		if (this.state === "playing") this.pause();
		else if (this.state === "paused") this.resume();
	}

	/** Stops playback and cancels any synthesis still in flight. */
	stop(): void {
		const controller = this.controller;
		this.controller = null;
		controller?.abort();

		if (this.activeProvider?.kind === "speaking") this.activeProvider.cancel();
		this.cleanup();
	}

	/** Release every resource. Call from the plugin's onunload. */
	destroy(): void {
		this.stop();
		this.sink.dispose();
		this.stateListeners.clear();
	}

	private cleanup(): void {
		this.controller = null;
		this.activeProvider = null;
		this.sink.stop();
		this.setState("idle");
	}

	private setState(state: PlaybackState): void {
		if (this.state === state) return;
		this.state = state;
		for (const fn of this.stateListeners) fn(state);
	}
}
