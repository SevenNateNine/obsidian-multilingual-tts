import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./registry";
import { createProviderInstance, type ProviderInstance } from "../settings/types";
import type { ProviderType } from "./providerTypes";
import type { SpeakingProvider, VoiceInfo } from "./types";

/** Counts its own construction, so a test can tell a rebuild from a reuse. */
class FakeProvider implements SpeakingProvider {
	readonly kind = "speaking" as const;
	readonly displayName = "Fake";
	readonly maxChunkChars = 100;

	constructor(
		readonly id: string,
		readonly type: ProviderType,
	) {}

	isConfigured(): boolean {
		return true;
	}
	async listVoices(): Promise<VoiceInfo[]> {
		return [];
	}
	async refreshVoices(): Promise<VoiceInfo[]> {
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

function setup() {
	let built = 0;
	const registry = new ProviderRegistry((instance) => {
		built++;
		return new FakeProvider(instance.id, instance.type);
	});
	return { registry, builds: () => built };
}

const instance = (id: string, type: ProviderType = "azure"): ProviderInstance =>
	createProviderInstance(type, { id });

describe("sync", () => {
	it("builds one provider per configured instance", () => {
		const { registry } = setup();
		registry.sync([instance("a"), instance("b")]);

		expect(registry.all().map((p) => p.id)).toEqual(["a", "b"]);
	});

	// Providers cache expensive state, so an unrelated settings edit must not
	// throw away a voice catalog that has already been loaded.
	it("keeps the existing provider for an instance that is still there", () => {
		const { registry, builds } = setup();
		registry.sync([instance("a")]);
		const first = registry.get("a");

		registry.sync([instance("a"), instance("b")]);

		expect(registry.get("a")).toBe(first);
		expect(builds()).toBe(2);
	});

	it("drops a provider the user deleted", () => {
		const { registry } = setup();
		registry.sync([instance("a"), instance("b")]);
		registry.sync([instance("a")]);

		expect(registry.get("b")).toBeUndefined();
		expect(registry.all()).toHaveLength(1);
	});

	// The type is fixed at creation, so a mismatch means a hand-edited data.json
	// rather than a normal edit. Reusing the old object would run the wrong engine.
	it("rebuilds when an id keeps its place but changes engine", () => {
		const { registry } = setup();
		registry.sync([instance("a", "azure")]);
		const first = registry.get("a");

		registry.sync([instance("a", "system")]);

		expect(registry.get("a")).not.toBe(first);
		expect(registry.get("a")?.type).toBe("system");
	});

	it("follows the settings order", () => {
		const { registry } = setup();
		registry.sync([instance("a"), instance("b")]);
		registry.sync([instance("b"), instance("a")]);

		expect(registry.all().map((p) => p.id)).toEqual(["b", "a"]);
	});

	it("empties the registry when every provider is removed", () => {
		const { registry } = setup();
		registry.sync([instance("a")]);
		registry.sync([]);

		expect(registry.all()).toEqual([]);
	});
});

describe("get", () => {
	// A profile can name a provider the user has since deleted. The caller
	// reports that, instead of silently reading the note in the wrong voice.
	it("returns undefined for an id nothing owns", () => {
		const { registry } = setup();
		registry.sync([instance("a")]);

		expect(registry.get("gone")).toBeUndefined();
	});
});
