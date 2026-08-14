import { Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import {
	resolveDefaultProfile,
	type PluginSettings,
	type VoiceProfile,
} from "./core/settings/types";
import { starterProfile } from "./core/usecases/starterProfile";
import { SettingsStore } from "./core/settings/SettingsStore";
import { migrateSettings } from "./core/settings/migrations";
import {
	decodeKey,
	isKeyLocked,
	nextStoredKey,
	storedKeyMode,
	type KeyStorage,
} from "./core/settings/secret";
import { ProviderRegistry } from "./core/tts/registry";
import { AudioPlayer } from "./core/audio/AudioPlayer";
import type { RenderProgress } from "./core/audio/renderToFile";
import { describeSelection, shouldAnnounce } from "./core/text/detectLanguage";
import { timestampSuffix } from "./core/paths";
import { userMessage } from "./core/errors";
import { planRead } from "./core/usecases/planRead";
import { speak, speakPrepared, type SpeakDeps } from "./core/usecases/speak";
import { saveAudio, type SaveDeps } from "./core/usecases/saveAudio";
import type { Refused, SaveOutcome, SpeakOutcome } from "./core/usecases/outcomes";
import { SystemProvider } from "./adapters/system/SystemProvider";
import { AzureProvider } from "./adapters/azure/AzureProvider";
import { HtmlAudioSink } from "./adapters/HtmlAudioSink";
import { francDetector } from "./adapters/francDetector";
import { ObsidianAudioStore, fileAtPath } from "./adapters/obsidian/ObsidianAudioStore";
import { ObsidianCatalogStore } from "./adapters/obsidian/ObsidianCatalogStore";
import { obsidianFetcher } from "./adapters/obsidian/obsidianFetcher";
import { getReadableText } from "./adapters/obsidian/editorText";
import { SettingsTab } from "./ui/SettingsTab";
import { ProfileSuggestModal } from "./ui/ProfileSuggestModal";
import { ConvertModal } from "./ui/ConvertModal";
import { PassphraseModal } from "./ui/PassphraseModal";

/**
 * Composition root and Obsidian adapter.
 *
 * Builds the detail implementations, registers the commands, and turns each
 * use-case outcome into a Notice. Every decision lives in `core/usecases/`.
 */
export default class MultilingualTtsPlugin extends Plugin {
	override settings!: PluginSettings;
	providers!: ProviderRegistry;
	readonly player = new AudioPlayer(new HtmlAudioSink());

	private store!: SettingsStore;
	private audioStore!: ObsidianAudioStore;
	/** Held concretely: the starter profile reads the platform default voice. */
	private system!: SystemProvider;
	/** Held concretely: the Azure settings block drives its catalog directly. */
	private azure!: AzureProvider;

	private statusBar: HTMLElement | null = null;
	private renderAbort: AbortController | null = null;

	/**
	 * The speech key exactly as data.json holds it. Kept so that a save made
	 * before the first unlock can write the encrypted value back untouched,
	 * rather than replacing a key nobody has read yet with an empty string.
	 */
	private storedKey = "";
	/** Session only. Never persisted, and dropped when Obsidian closes. */
	private passphrase: string | null = null;
	private locked = false;
	/** The plain text `storedKey` was built from. See `keyForDisk`. */
	private encodedFrom: string | null = null;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.createAdapters();
		await this.ensureStarterProfile();

		this.statusBar = this.addStatusBarItem();
		this.register(this.player.onStateChange(() => this.renderStatusBar()));
		this.renderStatusBar();

		this.addCommand({
			id: "read-selection",
			name: "Read selection",
			editorCallback: (editor) => this.readFromEditor(editor),
		});

		this.addCommand({
			id: "read-selection-with-profile",
			name: "Read selection with profile…",
			editorCallback: (editor) => {
				const raw = this.readableText(editor);
				if (!raw) return;
				this.pickProfile((profile) => void this.speak(raw, profile));
			},
		});

		this.addCommand({
			id: "switch-default-profile",
			name: "Switch default voice profile",
			callback: () => {
				this.pickProfile(async (profile) => {
					this.settings.defaultProfileId = profile.id;
					await this.saveSettings();
					new Notice(`Default profile: ${profile.name}`);
				}, "Set the default voice profile…");
			},
		});

		this.addCommand({
			id: "convert-to-audio",
			name: "Convert text to audio…",
			editorCallback: (editor) => this.openConvertModal(editor),
		});

		this.addCommand({
			id: "toggle-pause",
			name: "Pause or resume",
			checkCallback: (checking) => {
				if (!this.player.isActive()) return false;
				if (!checking) this.player.togglePause();
				return true;
			},
		});

		this.addCommand({
			id: "stop",
			name: "Stop",
			checkCallback: (checking) => {
				if (!this.player.isActive()) return false;
				if (!checking) this.player.stop();
				return true;
			},
		});

		this.addRibbonIcon("volume-2", "Read selection", () => {
			const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			if (!editor) {
				new Notice("Open a note first.");
				return;
			}
			this.readFromEditor(editor);
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				if (!editor.getSelection().trim()) return;
				menu.addItem((item) =>
					item
						.setTitle("Read selection")
						.setIcon("volume-2")
						.onClick(() => this.readFromEditor(editor)),
				);
			}),
		);

		this.addSettingTab(new SettingsTab(this.app, this, this.azure));
	}

	override onunload(): void {
		this.player.destroy();
	}

	private createAdapters(): void {
		const pluginDir =
			this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;

		this.audioStore = new ObsidianAudioStore(this.app.vault);
		this.system = new SystemProvider();

		// The credentials getter closes over the small store, not over the plugin,
		// so a session-long provider does not retain the app.
		const store = this.store;
		this.azure = new AzureProvider(
			() => store.current.azure,
			new ObsidianCatalogStore(this.app.vault.adapter, `${pluginDir}/voice-cache.json`),
			obsidianFetcher,
		);

		this.providers = new ProviderRegistry([this.system, this.azure]);
	}

	async loadSettings(): Promise<void> {
		this.settings = migrateSettings(await this.loadData());
		await this.readStoredKey();
		// Same object on both sides: PluginSettingTab reads `plugin.settings`.
		this.store = new SettingsStore(this.settings, (s) => this.persist(s));
	}

	async saveSettings(): Promise<void> {
		await this.store.save();
	}

	/**
	 * Turn the key on disk into the plain text the rest of the plugin uses.
	 *
	 * An encrypted key stays locked until the user gives the passphrase. A
	 * damaged value must not stop the plugin from loading, because system voices
	 * do not need Azure at all.
	 */
	private async readStoredKey(): Promise<void> {
		this.storedKey = this.settings.azure.key;
		this.settings.azure.key = "";
		this.locked = isKeyLocked(this.storedKey);
		if (this.locked) return;

		try {
			this.settings.azure.key = await decodeKey(this.storedKey, null);
			this.encodedFrom = this.settings.azure.key;
		} catch (err) {
			new Notice(userMessage(err));
			console.error("[multilingual-tts] could not read the stored speech key", err);
		}
	}

	/**
	 * Write settings with the key in its at-rest form.
	 *
	 * Nothing is written when the key cannot be encoded. A failed save keeps the
	 * previous file, which is the safe outcome for a credential.
	 */
	private async persist(settings: PluginSettings): Promise<void> {
		try {
			const key = await this.keyForDisk();
			await this.saveData({ ...settings, azure: { ...settings.azure, key } });
		} catch (err) {
			new Notice(userMessage(err));
			console.error("[multilingual-tts] could not save settings", err);
		}
	}

	/**
	 * Encode the key once per change, not once per save.
	 *
	 * Every settings edit saves the whole file, and PBKDF2 is deliberately slow.
	 * Without this, changing the region or a profile would re-derive the key.
	 */
	private async keyForDisk(): Promise<string> {
		const { key, keyStorage } = this.settings.azure;
		const unchanged =
			key === this.encodedFrom && storedKeyMode(this.storedKey) === keyStorage;
		if (unchanged && !this.locked) return this.storedKey;

		this.storedKey = await nextStoredKey({
			stored: this.storedKey,
			plaintext: key,
			mode: keyStorage,
			passphrase: this.passphrase,
			locked: this.locked,
		});
		this.encodedFrom = key;
		return this.storedKey;
	}

	/** True when an encrypted key is waiting for its passphrase. */
	isAzureKeyLocked(): boolean {
		return this.locked;
	}

	/**
	 * Ask for the passphrase and decrypt the stored key.
	 *
	 * Returns false when the key is still locked, which means the user closed the
	 * dialog. The caller stops without a message in that case.
	 */
	async unlockAzureKey(): Promise<boolean> {
		if (!this.locked) return true;

		return new Promise<boolean>((resolve) => {
			new PassphraseModal(this.app, {
				mode: "unlock",
				onSubmit: async (passphrase) => {
					try {
						this.settings.azure.key = await decodeKey(this.storedKey, passphrase);
					} catch (err) {
						return userMessage(err);
					}
					this.passphrase = passphrase;
					this.encodedFrom = this.settings.azure.key;
					this.locked = false;
					resolve(true);
					return null;
				},
				onCancel: () => resolve(false),
			}).open();
		});
	}

	/**
	 * Replace the key in memory. A newly typed key is plain text, so it replaces
	 * whatever was stored and nothing stays locked. The caller then saves.
	 */
	setAzureKeyValue(key: string): void {
		this.settings.azure.key = key;
		this.locked = false;
	}

	/**
	 * Change how the key is written to disk. `passphrase` is the new passphrase
	 * for the passphrase mode, and null for the two modes that need none.
	 */
	async setKeyStorage(mode: KeyStorage, passphrase: string | null): Promise<void> {
		this.settings.azure.keyStorage = mode;
		this.passphrase = passphrase;
		await this.saveSettings();
	}

	/** Azure needs its key in the clear. No other engine does. */
	private async unlocked(profile: VoiceProfile): Promise<boolean> {
		if (profile.provider !== "azure") return true;
		return this.unlockAzureKey();
	}

	private async ensureStarterProfile(): Promise<void> {
		if (this.settings.profiles.length > 0) return;

		const profile = starterProfile(await this.system.defaultVoice());
		this.settings.profiles.push(profile);
		this.settings.defaultProfileId = profile.id;
		await this.saveSettings();
	}

	/** Open the fuzzy profile picker, or give the reason it cannot open. */
	private pickProfile(
		onChoose: (profile: VoiceProfile) => void,
		placeholder?: string,
	): void {
		const { profiles } = this.settings;
		if (profiles.length === 0) {
			new Notice("No voice profiles yet. Add one in settings.");
			return;
		}
		new ProfileSuggestModal(this.app, profiles, onChoose, placeholder).open();
	}

	private readableText(editor: Editor): string {
		const raw = getReadableText(this.settings.reading.readBeforeOrAfter, editor);
		if (!raw) new Notice("Nothing selected to read.");
		return raw;
	}

	private readFromEditor(editor: Editor): void {
		const raw = this.readableText(editor);
		if (!raw) return;

		const plan = planRead(this.settings, raw, francDetector);
		if (!plan.ok) {
			new Notice(
				plan.reason === "empty-text"
					? "Nothing left to read after formatting."
					: "No voice profile configured yet.",
			);
			return;
		}

		if (shouldAnnounce(plan.selection)) {
			new Notice(describeSelection(plan.selection));
		}

		void this.readPrepared(plan.text, plan.selection.profile);
	}

	private async readPrepared(text: string, profile: VoiceProfile): Promise<void> {
		if (!(await this.unlocked(profile))) return;
		await this.report(speakPrepared(this.speakDeps(), text, profile), "read");
	}

	private openConvertModal(editor: Editor): void {
		const profile = resolveDefaultProfile(this.settings);
		if (!profile) {
			new Notice("No voice profile configured yet.");
			return;
		}

		new ConvertModal(this.app, {
			plugin: this,
			initialText: editor.getSelection(),
			profile,
			defaultBasename: this.defaultBasename(),
			onSaved: (linkText) => this.insertAudioEmbed(editor, linkText),
		}).open();
	}

	/**
	 * Insert an Obsidian audio embed at the cursor. `![[file.mp3]]` shows a
	 * native player. It continues to work after a move or a rename of the file.
	 * A hardcoded resource URL does not.
	 */
	private insertAudioEmbed(editor: Editor, linkText: string): void {
		if (!this.settings.output.insertPlayerAtCursor) return;
		editor.replaceSelection(`![[${linkText}]]`);
	}

	private defaultBasename(): string {
		const active = this.app.workspace.getActiveFile()?.basename ?? "audio";
		return `${active}_${timestampSuffix()}`;
	}

	private speakDeps(): SpeakDeps {
		return { providers: this.providers, player: this.player, settings: this.settings };
	}

	private saveDeps(): SaveDeps {
		return {
			providers: this.providers,
			store: this.audioStore,
			settings: this.settings,
		};
	}

	async speak(rawText: string, profile: VoiceProfile): Promise<void> {
		if (!(await this.unlocked(profile))) return;
		await this.report(speak(this.speakDeps(), rawText, profile), "read");
	}

	/** Render `rawText` to a file in the vault, reporting any refusal. */
	async saveAudio(
		rawText: string,
		profile: VoiceProfile,
		basename: string,
		onProgress?: (progress: RenderProgress) => void,
	): Promise<SaveOutcome> {
		// A closed passphrase dialog is a cancellation, and reports no message.
		if (!(await this.unlocked(profile))) return { ok: false, reason: "cancelled" };

		this.renderAbort?.abort();
		const controller = new AbortController();
		this.renderAbort = controller;

		try {
			const outcome = await saveAudio(
				this.saveDeps(),
				{ rawText, profile, basename, signal: controller.signal },
				onProgress,
			);
			this.announce(outcome, "convert");
			return outcome;
		} finally {
			if (this.renderAbort === controller) this.renderAbort = null;
		}
	}

	/** Resolve a path a save returned back to its file. */
	fileAt(path: string): TFile | null {
		return fileAtPath(this.app.vault, path);
	}

	/** Cancel an in-flight save. */
	cancelRender(): void {
		this.renderAbort?.abort();
		this.renderAbort = null;
	}

	private async report(
		outcome: Promise<SpeakOutcome>,
		verb: "read" | "convert",
	): Promise<void> {
		this.announce(await outcome, verb);
	}

	private announce(
		outcome: SpeakOutcome | SaveOutcome,
		verb: "read" | "convert",
	): void {
		if (outcome.ok) return;
		const message = failureMessage(outcome, verb);
		if (!message) return;
		new Notice(message);
		if (outcome.reason === "failed") {
			console.error("[multilingual-tts] speech failed", outcome.error);
		}
	}

	private renderStatusBar(): void {
		if (!this.statusBar) return;
		const state = this.player.getState();
		this.statusBar.setText(
			state === "idle"
				? ""
				: state === "paused"
					? "⏸ Paused"
					: state === "loading"
						? "⏳ Preparing…"
						: "▶ Reading",
		);
	}
}

/** Null when the outcome needs no message. A cancellation is not a failure. */
function failureMessage(outcome: Refused, verb: "read" | "convert"): string | null {
	switch (outcome.reason) {
		case "cancelled":
			return null;
		case "failed":
			return userMessage(outcome.error);
		case "no-profile":
			return "No voice profile configured yet.";
		case "unknown-provider":
			return `This profile uses an unknown engine: ${outcome.detail}.`;
		case "not-configured":
			return `${outcome.detail} is not configured.`;
		case "cannot-render":
			return `${outcome.detail} cannot save to a file.`;
		case "empty-text":
			return `Nothing left to ${verb} after formatting.`;
	}
}
