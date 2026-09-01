import { describe, expect, it } from "vitest";
import { saveAudio, saveAudioPrepared, type SaveDeps } from "./saveAudio";
import { ProviderRegistry } from "../tts/registry";
import { TtsError } from "../errors";
import {
	DEFAULT_SETTINGS,
	createProfile,
	createProviderInstance,
} from "../settings/types";
import type { AudioStore, SavedAudio } from "../ports";
import type {
	OutputFormatInfo,
	RenderedAudio,
	RenderingProvider,
	SpeakingProvider,
	SynthesisRequest,
	TtsProvider,
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

class FakeAzure implements RenderingProvider {
	readonly kind = "rendering" as const;
	readonly id = "azure" as const;
	readonly type = "azure" as const;
	readonly displayName = "Azure Speech";
	readonly calls: string[] = [];

	// Mutable so a test can force more than one request out of short text.
	maxChunkChars = 100;
	configured = true;
	format: OutputFormatInfo = MP3;
	failWith: TtsError | null = null;

	isConfigured(): boolean {
		return this.configured;
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
		if (this.failWith) throw this.failWith;
		return { ...this.format, data: new Uint8Array([1, 2, 3]).buffer };
	}
}

class FakeSystem implements SpeakingProvider {
	readonly kind = "speaking" as const;
	readonly id = "system" as const;
	readonly type = "system" as const;
	readonly displayName = "System voices";
	readonly maxChunkChars = 100;

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
	async speak(): Promise<void> {}
	pause(): void {}
	resume(): void {}
	cancel(): void {}
}

class FakeStore implements AudioStore {
	readonly saves: {
		folder: string;
		basename: string;
		extension: string;
		bytes: number;
	}[] = [];

	async save(
		folder: string,
		basename: string,
		extension: string,
		data: ArrayBuffer,
	): Promise<SavedAudio> {
		this.saves.push({ folder, basename, extension, bytes: data.byteLength });
		const name = `${basename}.${extension}`;
		return { path: folder ? `${folder}/${name}` : name };
	}
}

/**
 * A registry over ready-made fakes, one instance per fake, keyed by the id each
 * one declares. Uses the real `createProviderInstance`, so a change to the
 * instance shape shows up here rather than in a hand-built literal.
 */
function registryOf(providers: readonly TtsProvider[]): ProviderRegistry {
	const byId = new Map(providers.map((p) => [p.id, p]));
	const registry = new ProviderRegistry((instance) => {
		const provider = byId.get(instance.id);
		if (!provider) throw new Error(`no fake registered for ${instance.id}`);
		return provider;
	});

	registry.sync(
		providers.map((p) =>
			createProviderInstance(p.type, { id: p.id, name: p.displayName }),
		),
	);
	return registry;
}

function setup(providers = [new FakeAzure(), new FakeSystem()]) {
	const store = new FakeStore();
	const deps: SaveDeps = {
		providers: registryOf(providers),
		store,
		settings: structuredClone(DEFAULT_SETTINGS),
	};
	return { deps, store };
}

const request = (overrides: Partial<Parameters<typeof saveAudio>[1]> = {}) => ({
	text: "Some text to convert.",
	profile: createProfile({ providerId: "azure", voiceId: "v" }),
	basename: "note",
	signal: new AbortController().signal,
	...overrides,
});

describe("saveAudio", () => {
	it("writes the rendered audio and reports the path", async () => {
		const { deps, store } = setup();
		const outcome = await saveAudio(deps, request());

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.path).toBe("Audio/note.mp3");
		// The buffer comes back so a caller can play it without a second render.
		expect(outcome.clip.mimeType).toBe("audio/mpeg");
		expect(outcome.clip.data.byteLength).toBe(3);
		expect(store.saves).toEqual([
			{ folder: "Audio", basename: "note", extension: "mp3", bytes: 3 },
		]);
	});

	it("prefers the folder of the profile over the global default", async () => {
		const { deps, store } = setup();
		const profile = createProfile({
			providerId: "azure",
			voiceId: "v",
			outputFolder: "Audio/French",
		});

		await saveAudio(deps, request({ profile }));
		expect(store.saves[0]?.folder).toBe("Audio/French");
	});

	describe("refuses before it sends a request", () => {
		it("when no provider owns the id of the profile", async () => {
			const { deps, store } = setup([new FakeSystem()]);
			const outcome = await saveAudio(deps, request());

			expect(outcome).toEqual({
				ok: false,
				reason: "unknown-provider",
				detail: "azure",
			});
			expect(store.saves).toEqual([]);
		});

		it("when the provider speaks and cannot produce a file", async () => {
			const { deps, store } = setup();
			const profile = createProfile({ providerId: "system", voiceId: "v" });
			const outcome = await saveAudio(deps, request({ profile }));

			expect(outcome).toEqual({
				ok: false,
				reason: "cannot-render",
				detail: "System voices",
			});
			expect(store.saves).toEqual([]);
		});

		it("when the provider has no credentials", async () => {
			const azure = new FakeAzure();
			azure.configured = false;
			const { deps, store } = setup([azure, new FakeSystem()]);
			const outcome = await saveAudio(deps, request());

			expect(outcome).toEqual({
				ok: false,
				reason: "not-configured",
				detail: "Azure Speech",
			});
			expect(azure.calls).toEqual([]);
			expect(store.saves).toEqual([]);
		});

		it("when nothing survives text preparation", async () => {
			const azure = new FakeAzure();
			const { deps, store } = setup([azure, new FakeSystem()]);
			const outcome = await saveAudio(deps, request({ text: "   " }));

			expect(outcome).toEqual({ ok: false, reason: "empty-text" });
			expect(azure.calls).toEqual([]);
			expect(store.saves).toEqual([]);
		});

		// The format cannot be joined and the text needs more than one request.
		it("when the parts of a long text cannot be joined", async () => {
			const azure = new FakeAzure();
			azure.format = OGG;
			azure.maxChunkChars = 5;
			const { deps, store } = setup([azure, new FakeSystem()]);

			const outcome = await saveAudio(deps, request({ text: "One. Two. Three." }));

			expect(outcome.ok).toBe(false);
			expect(azure.calls).toEqual([]);
			expect(store.saves).toEqual([]);
		});
	});

	it("reports a cancellation without an error message", async () => {
		const { deps, store } = setup();
		const controller = new AbortController();
		controller.abort();

		const outcome = await saveAudio(deps, request({ signal: controller.signal }));

		expect(outcome).toEqual({ ok: false, reason: "cancelled" });
		expect(store.saves).toEqual([]);
	});

	it("carries a transport failure through for the caller to word", async () => {
		const azure = new FakeAzure();
		azure.failWith = new TtsError("network", "Could not reach the speech service");
		const { deps, store } = setup([azure, new FakeSystem()]);

		const outcome = await saveAudio(deps, request());

		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.reason).toBe("failed");
		expect(outcome.error).toBe(azure.failWith);
		expect(store.saves).toEqual([]);
	});

	it("passes progress through from the render loop", async () => {
		const { deps } = setup();
		const seen: number[] = [];

		await saveAudio(deps, request(), (p) => seen.push(p.done));
		expect(seen).toEqual([0, 1]);
	});
});

describe("saveAudioPrepared", () => {
	it("does not strip the text a second time", async () => {
		const azure = new FakeAzure();
		const { deps } = setup([azure, new FakeSystem()]);
		deps.settings.stripMarkdown = true;

		// An asterisk survives only because preparation is skipped. Through
		// `saveAudio` the same text would come out as "bold".
		await saveAudioPrepared(deps, request({ text: "**bold**" }));
		expect(azure.calls).toEqual(["**bold**"]);
	});

	it("still refuses text that is empty", async () => {
		const azure = new FakeAzure();
		const { deps } = setup([azure, new FakeSystem()]);

		const outcome = await saveAudioPrepared(deps, request({ text: "" }));
		expect(outcome).toEqual({ ok: false, reason: "empty-text" });
		expect(azure.calls).toEqual([]);
	});
});
