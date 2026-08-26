import { describe, expect, it } from "vitest";
import { CatalogCacheFile, type CacheFileStore } from "./CatalogCacheFile";
import type { CachedCatalog } from "../azure/voiceCatalog";

/** One file in memory. `contents` is null when the file does not exist. */
class FakeFile implements CacheFileStore {
	constructor(public contents: string | null = null) {}

	async exists(): Promise<boolean> {
		return this.contents !== null;
	}
	async read(): Promise<string> {
		if (this.contents === null) throw new Error("no such file");
		return this.contents;
	}
	async write(_path: string, data: string): Promise<void> {
		this.contents = data;
	}

	parsed(): Record<string, CachedCatalog> {
		return JSON.parse(this.contents ?? "{}") as Record<string, CachedCatalog>;
	}
}

const catalog = (region: string): CachedCatalog => ({
	fetchedAt: 1_700_000_000_000,
	region,
	voices: [
		{ id: `${region}-v`, displayName: "V", locale: "en-US", styles: [], roles: [] },
	],
});

function cacheWith(contents: string | null) {
	const file = new FakeFile(contents);
	return { file, cache: new CatalogCacheFile(file, "voice-cache.json") };
}

describe("scoped", () => {
	it("returns null when nothing is cached", async () => {
		const { cache } = cacheWith(null);
		expect(await cache.scoped("a").read()).toBeNull();
	});

	it("keeps one catalog per provider in a single file", async () => {
		const { file, cache } = cacheWith(null);
		await cache.scoped("a").write(catalog("eastus"));
		await cache.scoped("b").write(catalog("westus"));

		expect(await cache.scoped("a").read()).toEqual(catalog("eastus"));
		expect(await cache.scoped("b").read()).toEqual(catalog("westus"));
		expect(Object.keys(file.parsed())).toEqual(["a", "b"]);
	});

	it("replaces one provider's catalog without touching another", async () => {
		const { cache } = cacheWith(null);
		await cache.scoped("a").write(catalog("eastus"));
		await cache.scoped("b").write(catalog("westus"));
		await cache.scoped("a").write(catalog("northeurope"));

		expect(await cache.scoped("a").read()).toEqual(catalog("northeurope"));
		expect(await cache.scoped("b").read()).toEqual(catalog("westus"));
	});

	it("returns null for a provider the file does not hold", async () => {
		const { cache } = cacheWith(null);
		await cache.scoped("a").write(catalog("eastus"));

		expect(await cache.scoped("b").read()).toBeNull();
	});

	it("survives a damaged file rather than throwing", async () => {
		const { cache } = cacheWith("{ not json");
		expect(await cache.scoped("a").read()).toBeNull();
	});

	describe("a file written before providers were a list", () => {
		const legacy = JSON.stringify(catalog("eastus"));

		/**
		 * Only one Azure provider existed then, so whichever asks first is the
		 * right owner. `isCatalogFresh` rejects a catalog from another region, so
		 * a second provider cannot be given the wrong voices.
		 */
		it("is adopted by the provider that asks", async () => {
			const { cache } = cacheWith(legacy);
			expect(await cache.scoped("azure").read()).toEqual(catalog("eastus"));
		});

		it("becomes a keyed map on the next write", async () => {
			const { file, cache } = cacheWith(legacy);
			await cache.scoped("azure").write(catalog("eastus"));

			expect(Object.keys(file.parsed())).toEqual(["azure"]);
			expect(await cache.scoped("other").read()).toBeNull();
		});
	});
});

describe("forget", () => {
	it("drops a deleted provider's catalog and leaves the rest", async () => {
		const { file, cache } = cacheWith(null);
		await cache.scoped("a").write(catalog("eastus"));
		await cache.scoped("b").write(catalog("westus"));

		await cache.forget("a");

		expect(Object.keys(file.parsed())).toEqual(["b"]);
	});

	it("writes nothing when the provider had no catalog", async () => {
		const { file, cache } = cacheWith(null);
		await cache.forget("a");

		expect(file.contents).toBeNull();
	});
});
