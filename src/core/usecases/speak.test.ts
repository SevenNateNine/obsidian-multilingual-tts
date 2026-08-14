import { describe, expect, it } from "vitest";
import { speak, speakPrepared, type SpeakDeps } from "./speak";
import { AudioPlayer } from "../audio/AudioPlayer";
import { ProviderRegistry } from "../tts/registry";
import { TtsError } from "../errors";
import { DEFAULT_SETTINGS, createProfile } from "../settings/types";
import type { AudioClip, AudioSink } from "../ports";
import type {
	OutputFormatInfo,
	RenderedAudio,
	SpeakingProvider,
	SynthesisRequest,
	RenderingProvider,
} from "../tts/types";

const MP3: OutputFormatInfo = {
	extension: "mp3",
	mimeType: "audio/mpeg",
	concat: "mp3",
};

/** Finishes each clip at once, so a whole read completes in one await. */
class ImmediateSink implements AudioSink {
	readonly clips: string[] = [];

	async play(clip: AudioClip): Promise<void> {
		this.clips.push(clip.mimeType);
	}
	pause(): void {}
	resume(): void {}
	stop(): void {}
	dispose(): void {}
}

class FakeAzure implements RenderingProvider {
	readonly kind = "rendering" as const;
	readonly id = "azure" as const;
	readonly displayName = "Azure Speech";
	readonly maxChunkChars = 100;
	readonly calls: string[] = [];

	configured = true;
	failWith: TtsError | null = null;

	isConfigured(): boolean {
		return this.configured;
	}
	async listVoices(): Promise<[]> {
		return [];
	}
	outputFormat(): OutputFormatInfo {
		return MP3;
	}

	async render(req: SynthesisRequest): Promise<RenderedAudio> {
		this.calls.push(req.text);
		if (this.failWith) throw this.failWith;
		return { ...MP3, data: new Uint8Array([1]).buffer };
	}
}

class FakeSystem implements SpeakingProvider {
	readonly kind = "speaking" as const;
	readonly id = "system" as const;
	readonly displayName = "System voices";
	readonly maxChunkChars = 100;
	readonly calls: string[] = [];

	isConfigured(): boolean {
		return true;
	}
	async listVoices(): Promise<[]> {
		return [];
	}
	async speak(req: SynthesisRequest): Promise<void> {
		this.calls.push(req.text);
	}
	pause(): void {}
	resume(): void {}
	cancel(): void {}
}

function setup(providers = [new FakeAzure(), new FakeSystem()]) {
	const sink = new ImmediateSink();
	const deps: SpeakDeps = {
		providers: new ProviderRegistry(providers),
		player: new AudioPlayer(sink),
		settings: structuredClone(DEFAULT_SETTINGS),
	};
	return { deps, sink };
}

const azureProfile = createProfile({ provider: "azure" as const, voiceId: "v" });
const systemProfile = createProfile({ provider: "system" as const, voiceId: "v" });

describe("speak", () => {
	it("prepares the text before it reaches the provider", async () => {
		const azure = new FakeAzure();
		const { deps } = setup([azure, new FakeSystem()]);

		const outcome = await speak(deps, "# Heading\n\nSome **bold** text.", azureProfile);

		expect(outcome).toEqual({ ok: true });
		expect(azure.calls).toEqual(["Heading\n\nSome bold text."]);
	});

	it("refuses when nothing survives preparation", async () => {
		const azure = new FakeAzure();
		const { deps } = setup([azure, new FakeSystem()]);

		const outcome = await speak(deps, "   ", azureProfile);

		expect(outcome).toEqual({ ok: false, reason: "empty-text" });
		expect(azure.calls).toEqual([]);
	});
});

describe("speakPrepared", () => {
	it("plays through a rendering provider", async () => {
		const { deps, sink } = setup();
		const outcome = await speakPrepared(deps, "Hello.", azureProfile);

		expect(outcome).toEqual({ ok: true });
		expect(sink.clips).toEqual(["audio/mpeg"]);
	});

	it("speaks through a speaking provider without touching the sink", async () => {
		const system = new FakeSystem();
		const { deps, sink } = setup([new FakeAzure(), system]);

		const outcome = await speakPrepared(deps, "Hello.", systemProfile);

		expect(outcome).toEqual({ ok: true });
		expect(system.calls).toEqual(["Hello."]);
		expect(sink.clips).toEqual([]);
	});

	it("refuses when no provider owns the id of the profile", async () => {
		const { deps } = setup([new FakeSystem()]);
		const outcome = await speakPrepared(deps, "Hello.", azureProfile);

		expect(outcome).toEqual({
			ok: false,
			reason: "unknown-provider",
			detail: "azure",
		});
	});

	it("refuses when the provider has no credentials", async () => {
		const azure = new FakeAzure();
		azure.configured = false;
		const { deps } = setup([azure, new FakeSystem()]);

		const outcome = await speakPrepared(deps, "Hello.", azureProfile);

		expect(outcome).toEqual({
			ok: false,
			reason: "not-configured",
			detail: "Azure Speech",
		});
		expect(azure.calls).toEqual([]);
	});

	it("carries a transport failure through for the caller to word", async () => {
		const azure = new FakeAzure();
		azure.failWith = new TtsError("auth", "Azure rejected the credentials");
		const { deps } = setup([azure, new FakeSystem()]);

		const outcome = await speakPrepared(deps, "Hello.", azureProfile);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.reason).toBe("failed");
		expect(outcome.error).toBe(azure.failWith);
	});
});
