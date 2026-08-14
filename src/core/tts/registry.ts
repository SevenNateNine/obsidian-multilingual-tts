import type { ProviderId } from "../settings/types";
import type { TtsProvider } from "./types";

/**
 * Holds one long-lived instance of each provider.
 *
 * Providers cache expensive state (the platform voice list, the Azure voice
 * catalog), so they must not be recreated per conversion.
 *
 * Keyed by id rather than by named fields, so a new engine is registered at the
 * composition root and needs no edit here.
 */
export class ProviderRegistry {
	private readonly byId: Map<ProviderId, TtsProvider>;

	constructor(providers: readonly TtsProvider[]) {
		this.byId = new Map(providers.map((p) => [p.id, p]));
	}

	/**
	 * Undefined when no provider owns this id. A profile written by a later
	 * version can name an engine this build does not have. The caller reports
	 * that, instead of silently reading the note in the wrong voice.
	 */
	get(id: ProviderId): TtsProvider | undefined {
		return this.byId.get(id);
	}

	/** Every registered provider, in registration order. */
	all(): TtsProvider[] {
		return [...this.byId.values()];
	}
}
