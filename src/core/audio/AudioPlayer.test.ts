import { describe, expect, it } from "vitest";
import { AudioPlayer } from "./AudioPlayer";
import { chunkText } from "./chunker";
import { createProfile } from "../settings/types";
import { TtsError } from "../errors";
import type { AudioClip, AudioSink } from "../ports";
import type {
	OutputFormatInfo,
	RenderedAudio,
	RenderingProvider,
	SpeakingProvider,
	SynthesisRequest,
} from "../tts/types";

const MP3: OutputFormatInfo = {
	extension: "mp3",
	mimeType: "audio/mpeg",
	concat: "mp3",
};

/** Long enough to need several requests at a ten-character limit. */
const LONG = "One. Two. Three. Four. Five. Six.";
const CHUNKS = chunkText(LONG, { maxChars: 10 });

const profile = createProfile({ voiceId: "test-voice" });

/** Lets the test drive the microtask queue between assertions. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `[1, 2, ... n]`, the clip order FakeSink records. */
const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/**
 * Holds each clip until the test releases it, so a test can observe what the
 * player does while a chunk is still playing.
 */
class FakeSink implements AudioSink {
	readonly clips: number[] = [];
	pauses = 0;
	resumes = 0;
	stops = 0;
	disposes = 0;

	private release: (() => void) | null = null;

	play(clip: AudioClip, signal: AbortSignal, onStarted?: () => void): Promise<void> {
		this.clips.push(new Uint8Array(clip.data)[0] ?? 0);
		onStarted?.();
		return new Promise<void>((resolve, reject) => {
			this.release = resolve;
			signal.addEventListener(
				"abort",
				() => reject(new TtsError("cancelled", "aborted")),
				{ once: true },
			);
		});
	}

	/** Finish the clip that is playing now. */
	finishClip(): void {
		const release = this.release;
		this.release = null;
		release?.();
	}

	pause(): void {
		this.pauses++;
	}
	resume(): void {
		this.resumes++;
	}
	stop(): void {
		this.stops++;
	}
	dispose(): void {
		this.disposes++;
	}
}

class FakeRenderer implements RenderingProvider {
	readonly kind = "rendering" as const;
	readonly id = "azure" as const;
	readonly displayName = "Fake renderer";
	readonly maxChunkChars = 10;
	readonly calls: string[] = [];

	/** Text that must fail instead of rendering. */
	failOn: string | null = null;

	isConfigured(): boolean {
		return true;
	}
	async listVoices(): Promise<[]> {
		return [];
	}
	outputFormat(): OutputFormatInfo {
		return MP3;
	}

	async render(req: SynthesisRequest): Promise<RenderedAudio> {
		this.calls.push(req.text);
		if (req.text === this.failOn) {
			throw new TtsError("network", "Speech synthesis failed");
		}
		return { ...MP3, data: new Uint8Array([this.calls.length]).buffer };
	}
}

class FakeSpeaker implements SpeakingProvider {
	readonly kind = "speaking" as const;
	readonly id = "system" as const;
	readonly displayName = "Fake speaker";
	readonly maxChunkChars = 10;
	readonly calls: string[] = [];
	pauses = 0;
	resumes = 0;
	cancels = 0;

	isConfigured(): boolean {
		return true;
	}
	async listVoices(): Promise<[]> {
		return [];
	}

	/** When true, an utterance runs until the signal aborts it. */
	hold = false;

	async speak(req: SynthesisRequest, signal: AbortSignal): Promise<void> {
		this.calls.push(req.text);
		if (!this.hold) return;
		// The real provider rejects on abort rather than ignoring the signal.
		await new Promise<void>((_resolve, reject) => {
			signal.addEventListener(
				"abort",
				() => reject(new TtsError("cancelled", "aborted")),
				{ once: true },
			);
		});
	}

	pause(): void {
		this.pauses++;
	}
	resume(): void {
		this.resumes++;
	}
	cancel(): void {
		this.cancels++;
	}
}

describe("AudioPlayer", () => {
	it("does nothing when there is no text", async () => {
		const sink = new FakeSink();
		const provider = new FakeRenderer();
		await new AudioPlayer(sink).play(provider, profile, "   ");
		expect(provider.calls).toEqual([]);
		expect(sink.clips).toEqual([]);
	});

	// The whole point of the prefetch: the next request is already in flight
	// while the current chunk plays, so playback starts after chunk one rather
	// than after the whole note.
	it("renders the next chunk while the current one plays", async () => {
		expect(CHUNKS.length).toBeGreaterThan(2);
		const sink = new FakeSink();
		const provider = new FakeRenderer();
		const player = new AudioPlayer(sink);

		const done = player.play(provider, profile, LONG);

		for (let i = 0; i < CHUNKS.length; i++) {
			await tick();
			// Chunk i is playing, and chunk i+1 was requested before it started.
			expect(sink.clips).toEqual(upTo(i + 1));
			expect(provider.calls).toEqual(CHUNKS.slice(0, Math.min(i + 2, CHUNKS.length)));
			sink.finishClip();
		}

		await done;
		expect(player.getState()).toBe("idle");
	});

	// Without the `pending.catch()` guard in playRendered, the prefetch rejects
	// while nothing awaits it and the run reports an unhandled rejection.
	it("surfaces a failed prefetch once, when the loop reaches it", async () => {
		const sink = new FakeSink();
		const provider = new FakeRenderer();
		provider.failOn = CHUNKS[1] ?? null;
		const player = new AudioPlayer(sink);

		const done = player.play(provider, profile, LONG);

		await tick();
		expect(sink.clips).toEqual([1]);

		sink.finishClip();
		await expect(done).rejects.toThrow(TtsError);
		expect(player.getState()).toBe("idle");
	});

	it("stops the loop when playback is stopped", async () => {
		const sink = new FakeSink();
		const provider = new FakeRenderer();
		const player = new AudioPlayer(sink);

		const done = player.play(provider, profile, LONG);
		await tick();

		player.stop();
		// Cancellation resolves. It is not an error the user has to see.
		await expect(done).resolves.toBeUndefined();
		expect(sink.clips).toEqual([1]);
		expect(player.getState()).toBe("idle");
	});

	it("replaces playback already running rather than overlapping it", async () => {
		const sink = new FakeSink();
		const provider = new FakeRenderer();
		const player = new AudioPlayer(sink);

		const first = player.play(provider, profile, LONG);
		await tick();
		const second = player.play(provider, profile, "Short.");

		await expect(first).resolves.toBeUndefined();
		sink.finishClip();
		await second;
		expect(player.getState()).toBe("idle");
	});

	describe("a speaking provider", () => {
		it("speaks every chunk and never reaches the sink", async () => {
			const sink = new FakeSink();
			const provider = new FakeSpeaker();
			await new AudioPlayer(sink).play(provider, profile, LONG);

			expect(provider.calls).toEqual(CHUNKS);
			expect(sink.clips).toEqual([]);
		});

		it("takes pause and resume itself", async () => {
			const sink = new FakeSink();
			const provider = new FakeSpeaker();
			const player = new AudioPlayer(sink);

			const done = player.play(provider, profile, LONG);
			player.pause();
			player.resume();
			await done;

			expect(provider.pauses).toBe(1);
			expect(provider.resumes).toBe(1);
			expect(sink.pauses).toBe(0);
			expect(sink.resumes).toBe(0);
		});

		it("is cancelled when it is speaking and playback stops", async () => {
			const sink = new FakeSink();
			const provider = new FakeSpeaker();
			provider.hold = true;
			const player = new AudioPlayer(sink);

			const done = player.play(provider, profile, "Short.");
			await tick();

			player.stop();
			await expect(done).resolves.toBeUndefined();
			expect(provider.cancels).toBe(1);
		});
	});

	describe("a rendering provider", () => {
		it("routes pause and resume to the sink", async () => {
			const sink = new FakeSink();
			const provider = new FakeRenderer();
			const player = new AudioPlayer(sink);

			const done = player.play(provider, profile, LONG);
			await tick();
			expect(player.getState()).toBe("playing");

			player.pause();
			expect(sink.pauses).toBe(1);
			expect(player.getState()).toBe("paused");

			player.resume();
			expect(sink.resumes).toBe(1);
			expect(player.getState()).toBe("playing");

			player.stop();
			await done;
		});
	});

	it("releases the transport on destroy", async () => {
		const sink = new FakeSink();
		const player = new AudioPlayer(sink);
		player.destroy();
		expect(sink.disposes).toBe(1);
	});
});
