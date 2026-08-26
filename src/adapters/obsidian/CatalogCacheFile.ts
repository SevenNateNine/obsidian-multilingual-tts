import type { DataAdapter } from "obsidian";
import type { CachedCatalog, CatalogStore } from "../azure/voiceCatalog";

/**
 * The three vault calls this needs. Narrower than `DataAdapter`, so a test can
 * stand in for it without implementing an interface it never exercises.
 */
export type CacheFileStore = Pick<DataAdapter, "exists" | "read" | "write">;

/**
 * Persists a voice catalog per provider beside the plugin.
 *
 * One file holding a map of provider id to catalog, rather than a file each.
 * Two Azure resources in different regions cache different voice lists, and a
 * deleted provider leaves no orphan file behind.
 *
 * A class rather than a set of closures. The providers that hold the scoped
 * views live for the whole session, so they copy only the adapter and the path
 * instead of capturing the scope that built them.
 */
export class CatalogCacheFile {
	constructor(
		private readonly adapter: CacheFileStore,
		private readonly path: string,
	) {}

	/** The slice of the file belonging to one provider. */
	scoped(id: string): CatalogStore {
		return {
			read: () => this.read(id),
			write: (catalog) => this.write(id, catalog),
		};
	}

	/** Drop a deleted provider's catalog so the file does not grow forever. */
	async forget(id: string): Promise<void> {
		const catalogs = await this.readAll();
		if (!(id in catalogs)) return;

		delete catalogs[id];
		await this.writeAll(catalogs);
	}

	private async read(id: string): Promise<CachedCatalog | null> {
		const parsed = await this.parse();

		// A file written before providers were a list holds one catalog at the top
		// level. Whichever provider asks first adopts it, and the next write
		// rewrites the file as a map. That is safe because only one Azure provider
		// existed then, and `isCatalogFresh` rejects a catalog from another region.
		if (isLegacyCatalog(parsed)) return parsed;

		return toCatalogMap(parsed)[id] ?? null;
	}

	private async write(id: string, catalog: CachedCatalog): Promise<void> {
		const catalogs = await this.readAll();
		catalogs[id] = catalog;
		await this.writeAll(catalogs);
	}

	private async readAll(): Promise<Record<string, CachedCatalog>> {
		const parsed = await this.parse();
		return isLegacyCatalog(parsed) ? {} : toCatalogMap(parsed);
	}

	private async writeAll(catalogs: Record<string, CachedCatalog>): Promise<void> {
		await this.adapter.write(this.path, JSON.stringify(catalogs));
	}

	private async parse(): Promise<unknown> {
		if (!(await this.adapter.exists(this.path))) return null;
		try {
			return JSON.parse(await this.adapter.read(this.path)) as unknown;
		} catch {
			return null;
		}
	}
}

function isLegacyCatalog(value: unknown): value is CachedCatalog {
	if (!isRecord(value)) return false;
	return Array.isArray(value.voices) && typeof value.fetchedAt === "number";
}

function toCatalogMap(value: unknown): Record<string, CachedCatalog> {
	if (!isRecord(value)) return {};
	return { ...(value as Record<string, CachedCatalog>) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
