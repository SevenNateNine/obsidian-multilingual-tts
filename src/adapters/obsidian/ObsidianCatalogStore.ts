import type { DataAdapter } from "obsidian";
import type { CachedCatalog, CatalogStore } from "../azure/voiceCatalog";

/**
 * Persists the Azure voice catalog beside the plugin.
 *
 * A class rather than a set of closures. The provider that holds this store
 * lives for the whole session, so it copies only the adapter and the path
 * instead of capturing the scope that built it.
 */
export class ObsidianCatalogStore implements CatalogStore {
	constructor(
		private readonly adapter: DataAdapter,
		private readonly path: string,
	) {}

	async read(): Promise<CachedCatalog | null> {
		if (!(await this.adapter.exists(this.path))) return null;
		try {
			return JSON.parse(await this.adapter.read(this.path)) as CachedCatalog;
		} catch {
			return null;
		}
	}

	async write(catalog: CachedCatalog): Promise<void> {
		await this.adapter.write(this.path, JSON.stringify(catalog));
	}
}
