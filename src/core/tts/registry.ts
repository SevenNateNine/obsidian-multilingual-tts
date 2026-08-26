import type { ProviderInstance } from "../settings/types";
import type { TtsProvider } from "./types";

/**
 * Holds one long-lived instance of each configured provider.
 *
 * Providers cache expensive state (the platform voice list, the Azure voice
 * catalog), so they must not be recreated per conversion. The user can add and
 * remove providers at any time, so the registry builds on demand from the
 * settings list instead of being filled once.
 *
 * `build` lives at the composition root, so a new engine is registered there
 * and needs no edit here.
 */
export class ProviderRegistry {
	private byId = new Map<string, TtsProvider>();

	constructor(private readonly build: (instance: ProviderInstance) => TtsProvider) {}

	/**
	 * Match the registry to the configured list.
	 *
	 * An instance that is still present keeps its existing provider object, so a
	 * settings edit does not throw away a loaded voice catalog. A removed one is
	 * dropped, and a rebuilt one is created. The type is fixed at creation, so a
	 * mismatch means a hand-edited data.json rather than a normal edit.
	 */
	sync(instances: readonly ProviderInstance[]): void {
		const next = new Map<string, TtsProvider>();

		for (const instance of instances) {
			const existing = this.byId.get(instance.id);
			next.set(
				instance.id,
				existing && existing.type === instance.type ? existing : this.build(instance),
			);
		}

		this.byId = next;
	}

	/**
	 * Undefined when no provider owns this id. A profile can name a provider the
	 * user has since deleted. The caller reports that, instead of silently
	 * reading the note in the wrong voice.
	 */
	get(id: string): TtsProvider | undefined {
		return this.byId.get(id);
	}

	/** Every configured provider, in settings order. */
	all(): TtsProvider[] {
		return [...this.byId.values()];
	}
}
