import { describe, expect, it } from "vitest";
import { renderToFile, type RenderProgress } from "./renderToFile";
import { chunkText } from "./chunker";
import { createProfile } from "../settings/types";
import { TtsError } from "../errors";
import type {
	OutputFormatInfo,
	RenderedAudio,
	RenderingProvider,
	SynthesisRequest,
} from "../tts/types";

const MP3: OutputFormatInfo = {
	extension: "mp3",
	mimeType: "audio/mpeg",
	concat: "mp3",
};
const OGG: OutputFormatInfo = {
	extension: "ogg",
	mimeType: "audio/ogg",
	concat: "none",
};

const bytesOf = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer));

/**
 * Each call returns one byte, counting up from 1. The joined result then reads
 * as the call order, so a test can assert that chunks arrive in sequence.
 */
class FakeProvider implements RenderingProvider {
	readonly kind = "rendering" as const;
	readonly id = "azure" as const;
	readonly type = "azure" as const;
	readonly displayName = "Fake";
	readonly calls: string[] = [];

	/** Runs after each render call. Used to abort partway through. */
	onRender: (() => void) | null = null;

	constructor(
		private readonly format: OutputFormatInfo,
		readonly maxChunkChars: number,
	) {}

	isConfigured(): boolean {
		return true;
	}

	async listVoices(): Promise<[]> {
		return [];
	}
	async refreshVoices(): Promise<[]> {
		return [];
	}
	async voiceListStatus(): Promise<null> {
		return null;
	}

	audioFormatOptions(): Record<string, string> {
		return { mp3: "MP3" };
	}

	outputFormat(): OutputFormatInfo {
		return this.format;
	}

	async render(req: SynthesisRequest): Promise<RenderedAudio> {
		this.calls.push(req.text);
		this.onRender?.();
		return { ...this.format, data: new Uint8Array([this.calls.length]).buffer };
	}
}

const profile = createProfile({ voiceId: "test-voice" });

/** Long enough to need several requests at a ten-character limit. */
const LONG = "One. Two. Three. Four. Five. Six.";

describe("renderToFile", () => {
	it("refuses text that has nothing to say", async () => {
		const provider = new FakeProvider(MP3, 10);
		await expect(
			renderToFile(provider, profile, "   ", new AbortController().signal),
		).rejects.toThrow(TtsError);
		expect(provider.calls).toEqual([]);
	});

	it("passes a single chunk through without joining it", async () => {
		const provider = new FakeProvider(MP3, 100);
		const out = await renderToFile(
			provider,
			profile,
			"Short text.",
			new AbortController().signal,
		);
		expect(provider.calls).toEqual(["Short text."]);
		expect(bytesOf(out.data)).toEqual([1]);
	});

	it("takes the extension from outputFormat, not from a render result", async () => {
		const provider = new FakeProvider(OGG, 100);
		const out = await renderToFile(
			provider,
			profile,
			"Short text.",
			new AbortController().signal,
		);
		expect(out.extension).toBe("ogg");
	});

	it("renders every chunk and joins them in order", async () => {
		const provider = new FakeProvider(MP3, 10);
		const expected = chunkText(LONG, { maxChars: 10 });
		expect(expected.length).toBeGreaterThan(1);

		const out = await renderToFile(
			provider,
			profile,
			LONG,
			new AbortController().signal,
		);

		expect(provider.calls).toEqual(expected);
		expect(bytesOf(out.data)).toEqual(expected.map((_, i) => i + 1));
	});

	// The check that stops the user paying for synthesis which cannot be
	// assembled. It must happen before the first request, not after the last.
	it("refuses an unjoinable format before it sends a request", async () => {
		const provider = new FakeProvider(OGG, 10);
		await expect(
			renderToFile(provider, profile, LONG, new AbortController().signal),
		).rejects.toThrow(/multiple parts/);
		expect(provider.calls).toEqual([]);
	});

	it("allows an unjoinable format when one request is enough", async () => {
		const provider = new FakeProvider(OGG, 100);
		const out = await renderToFile(
			provider,
			profile,
			"Short text.",
			new AbortController().signal,
		);
		expect(bytesOf(out.data)).toEqual([1]);
	});

	it("stops sending requests after an abort", async () => {
		const provider = new FakeProvider(MP3, 10);
		const controller = new AbortController();
		provider.onRender = () => controller.abort();

		await expect(
			renderToFile(provider, profile, LONG, controller.signal),
		).rejects.toThrow(TtsError);
		expect(provider.calls).toHaveLength(1);
	});

	it("reports progress once per chunk and once at the end", async () => {
		const provider = new FakeProvider(MP3, 10);
		const total = chunkText(LONG, { maxChars: 10 }).length;
		const seen: RenderProgress[] = [];

		await renderToFile(provider, profile, LONG, new AbortController().signal, (p) =>
			seen.push(p),
		);

		expect(seen).toEqual([
			...Array.from({ length: total }, (_, i) => ({ done: i, total })),
			{ done: total, total },
		]);
	});
});
