import type { PluginSettings } from "./types";

/**
 * The live settings object, plus the way to persist it.
 *
 * Small on purpose. A provider that needs current credentials closes over this
 * store rather than over the plugin, so a long-lived provider does not keep the
 * whole plugin and its app reference alive.
 *
 * `current` is the same object the plugin exposes as `plugin.settings`, because
 * `PluginSettingTab` reads that property directly. The two must never diverge.
 */
export class SettingsStore {
	constructor(
		readonly current: PluginSettings,
		private readonly persist: (settings: PluginSettings) => Promise<void>,
	) {}

	async save(): Promise<void> {
		await this.persist(this.current);
	}
}
