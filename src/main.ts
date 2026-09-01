import {
	Editor,
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	TFile,
	type EditorSelection,
} from "obsidian";
import {
	configValue,
	findProviderInstance,
	resolveAudioFormat,
	resolveDefaultProfile,
	type PluginSettings,
	type ProviderInstance,
	type VoiceProfile,
} from "./core/settings/types";
import { starterProfile } from "./core/usecases/starterProfile";
import { planBatch, type OutputResolver, type PlanDeps } from "./core/batch/plan";
import type { BatchPlan, BatchPreset } from "./core/batch/types";
import { SettingsStore } from "./core/settings/SettingsStore";
import { migrateSettings } from "./core/settings/migrations";
import { SecretVault } from "./core/settings/SecretVault";
import { ProviderRegistry } from "./core/tts/registry";
import { secretFields } from "./core/tts/providerTypes";
import { AudioPlayer } from "./core/audio/AudioPlayer";
import type { RenderProgress } from "./core/audio/renderToFile";
import {
	describeSelection,
	shouldAnnounce,
	type ProfileSelection,
} from "./core/text/detectLanguage";
import { resolveNameTemplates } from "./core/paths";
import {
	expandNameTemplate,
	missingProperties,
	type NameVars,
} from "./core/text/nameTemplate";
import { audioLink } from "./core/text/audioLink";
import { TtsError, userMessage } from "./core/errors";
import { planRead } from "./core/usecases/planRead";
import { speak, speakPrepared, type SpeakDeps } from "./core/usecases/speak";
import { saveAudio, saveAudioPrepared, type SaveDeps } from "./core/usecases/saveAudio";
import type { Refused, SaveOutcome, SpeakOutcome } from "./core/usecases/outcomes";
import { SystemProvider } from "./adapters/system/SystemProvider";
import { AzureProvider } from "./adapters/azure/AzureProvider";
import { HtmlAudioSink } from "./adapters/HtmlAudioSink";
import { francDetector } from "./adapters/francDetector";
import { ObsidianAudioStore, fileAtPath } from "./adapters/obsidian/ObsidianAudioStore";
import { ObsidianNoteIndex } from "./adapters/obsidian/ObsidianNoteIndex";
import { CatalogCacheFile } from "./adapters/obsidian/CatalogCacheFile";
import { obsidianFetcher } from "./adapters/obsidian/obsidianFetcher";
import { getReadableText } from "./adapters/obsidian/editorText";
import { formatWithMoment } from "./adapters/obsidian/momentFormat";
import { SettingsTab } from "./ui/SettingsTab";
import { ProfileSuggestModal } from "./ui/ProfileSuggestModal";
import { ConvertModal } from "./ui/ConvertModal";
import { PassphraseModal } from "./ui/PassphraseModal";
import { BatchPreviewModal } from "./ui/BatchPreviewModal";
import { BatchPresetSuggestModal } from "./ui/BatchPresetSuggestModal";
import { PropertyPromptModal } from "./ui/PropertyPromptModal";

type MenuActionId = "read" | "save" | "link";

/** One row per context menu item, in the order they appear. */
const MENU_ACTIONS: readonly { id: MenuActionId; title: string; icon: string }[] = [
	{ id: "read", title: "Read selection", icon: "volume-2" },
	{ id: "save", title: "Read and save audio", icon: "download" },
	{ id: "link", title: "Read, save and link audio", icon: "link" },
];

/** Keeps the items together in one group, apart from Obsidian's own entries. */
const MENU_SECTION = "multilingual-tts";

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
	private noteIndex!: ObsidianNoteIndex;
	/** Held concretely: the starter profile reads the platform default voice. */
	private system!: SystemProvider;
	private catalogCache!: CatalogCacheFile;

	/**
	 * The at-rest form of every provider credential, and which of them are still
	 * locked. The plain text lives in each instance's config while we run.
	 */
	private readonly secrets = new SecretVault();

	private statusBar: HTMLElement | null = null;
	private renderAbort: AbortController | null = null;
	/**
	 * Profile id and detected language of the last announced detection, so a
	 * repeat pick stays quiet and a change to a different profile or a
	 * different undetected language is still announced.
	 */
	private lastAnnouncement: string | null = null;

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
			id: "preview-batch-audio",
			name: "Preview batch audio…",
			callback: () => this.pickPreset((preset) => this.openBatchPreview(preset)),
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
			this.app.workspace.on("editor-menu", (menu, editor) =>
				this.addMenuItems(menu, editor),
			),
		);

		this.addSettingTab(new SettingsTab(this.app, this));
	}

	override onunload(): void {
		this.player.destroy();
	}

	/**
	 * Build one provider per configured instance.
	 *
	 * This factory is the only place that maps an engine name to a class, so a
	 * new engine is one entry in `providerTypes.ts` and one branch here.
	 *
	 * The locals rather than `this` are deliberate: the config getter closes over
	 * the small settings store, so a session-long provider does not retain the
	 * plugin and its app reference.
	 */
	private createAdapters(): void {
		const pluginDir =
			this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;

		this.audioStore = new ObsidianAudioStore(this.app.vault);
		this.noteIndex = new ObsidianNoteIndex(this.app.vault, this.app.metadataCache);
		this.system = new SystemProvider();
		this.catalogCache = new CatalogCacheFile(
			this.app.vault.adapter,
			`${pluginDir}/voice-cache.json`,
		);

		const system = this.system;
		const catalog = this.catalogCache;
		const store = this.store;

		this.providers = new ProviderRegistry((instance) =>
			instance.type === "system"
				? system
				: new AzureProvider(
						instance.id,
						() => findProviderInstance(store.current, instance.id)?.config ?? {},
						catalog.scoped(instance.id),
						obsidianFetcher,
					),
		);
		this.providers.sync(this.settings.providers);
	}

	async loadSettings(): Promise<void> {
		this.settings = migrateSettings(await this.loadData());
		// Same object on both sides: PluginSettingTab reads `plugin.settings`.
		this.store = new SettingsStore(this.settings, (s) => this.persist(s));
		await this.readStoredSecrets();
	}

	async saveSettings(): Promise<void> {
		await this.store.save();
	}

	/** Apply an edit to the provider list, then persist it. */
	async saveProviders(): Promise<void> {
		this.providers.sync(this.settings.providers);
		await this.saveSettings();
	}

	/** Delete a provider, its session secrets, and its cached voice list. */
	async removeProvider(id: string): Promise<void> {
		this.settings.providers = this.settings.providers.filter((p) => p.id !== id);
		this.secrets.forget(id);
		await this.catalogCache.forget(id);
		await this.saveProviders();
	}

	/**
	 * Turn each credential on disk into the plain text the rest of the plugin uses.
	 *
	 * An encrypted value stays locked until the user gives its passphrase. A
	 * damaged one must not stop the plugin from loading, because the device
	 * voices need no credential at all.
	 */
	private async readStoredSecrets(): Promise<void> {
		for (const instance of this.settings.providers) {
			for (const field of secretFields(instance.type)) {
				const stored = configValue(instance.config, field.key);
				try {
					instance.config[field.key] = await this.secrets.adopt(
						instance.id,
						field.key,
						stored,
					);
				} catch (err) {
					instance.config[field.key] = "";
					new Notice(`${instance.name}: ${userMessage(err)}`);
					console.error("[multilingual-tts] could not read a stored credential", err);
				}
			}
		}
	}

	/**
	 * Write settings with every credential in its at-rest form.
	 *
	 * Nothing is written when one cannot be encoded. A failed save keeps the
	 * previous file, which is the safe outcome for a credential.
	 */
	private async persist(settings: PluginSettings): Promise<void> {
		try {
			const providers = await this.providersForDisk(settings);
			await this.saveData({ ...settings, providers });
		} catch (err) {
			new Notice(userMessage(err));
			console.error("[multilingual-tts] could not save settings", err);
		}
	}

	private async providersForDisk(
		settings: PluginSettings,
	): Promise<ProviderInstance[]> {
		const encoded: ProviderInstance[] = [];

		for (const instance of settings.providers) {
			const config = { ...instance.config };
			for (const field of secretFields(instance.type)) {
				config[field.key] = await this.secrets.forDisk(
					instance.id,
					field.key,
					instance.keyStorage,
				);
			}
			encoded.push({ ...instance, config });
		}
		return encoded;
	}

	/** True when a provider's credentials are waiting for their passphrase. */
	isProviderLocked(id: string): boolean {
		return this.secrets.isLocked(id);
	}

	/**
	 * Ask for the passphrase and decrypt one provider's credentials.
	 *
	 * Returns false when it is still locked, which means the user closed the
	 * dialog. The caller stops without a message in that case.
	 */
	async unlockProvider(id: string): Promise<boolean> {
		if (!this.secrets.isLocked(id)) return true;

		const instance = findProviderInstance(this.settings, id);
		if (!instance) return false;

		return new Promise<boolean>((resolve) => {
			new PassphraseModal(this.app, {
				mode: "unlock",
				subject: instance.name,
				onSubmit: async (passphrase) => {
					try {
						Object.assign(instance.config, await this.secrets.unlock(id, passphrase));
					} catch (err) {
						return userMessage(err);
					}
					resolve(true);
					return null;
				},
				onCancel: () => resolve(false),
			}).open();
		});
	}

	/** True when this session can already encrypt for a provider. */
	hasProviderPassphrase(id: string): boolean {
		return this.secrets.hasPassphrase(id);
	}

	/**
	 * Insert or replace a provider, with its credentials in the clear.
	 *
	 * `passphrase` is the new one for a provider entering passphrase mode, and
	 * null when this session already holds it or the mode needs none. It is never
	 * cleared: `encodeKey` ignores it in the two modes that do not encrypt.
	 *
	 * The registry is rebuilt before the save, because a new provider needs an
	 * implementation and an edited one may point at different credentials.
	 */
	async saveProvider(
		instance: ProviderInstance,
		passphrase: string | null,
	): Promise<void> {
		const { providers } = this.settings;
		const index = providers.findIndex((p) => p.id === instance.id);
		if (index >= 0) providers[index] = instance;
		else providers.push(instance);

		// A locked provider offers Unlock instead of its credential fields, so the
		// draft carries only empty placeholders. Taking them would clear the lock
		// and replace a key nobody has read yet with an empty string.
		if (!this.secrets.isLocked(instance.id)) {
			for (const field of secretFields(instance.type)) {
				this.secrets.setPlaintext(
					instance.id,
					field.key,
					configValue(instance.config, field.key),
				);
			}
		}
		if (passphrase !== null) this.secrets.setPassphrase(instance.id, passphrase);

		await this.saveProviders();
	}

	/**
	 * A provider with encrypted credentials needs them in the clear first.
	 *
	 * A profile naming a provider that no longer exists passes through here and
	 * is refused further down, where the message can say so.
	 */
	private async unlocked(profile: VoiceProfile): Promise<boolean> {
		return this.unlockProvider(profile.providerId);
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

	/** The enabled actions, in their own group. Nothing is offered without a selection. */
	private addMenuItems(menu: Menu, editor: Editor): void {
		if (!editor.getSelection().trim()) return;

		for (const action of MENU_ACTIONS) {
			if (!this.settings.menu[action.id]) continue;
			menu.addItem((item) =>
				item
					.setTitle(action.title)
					.setIcon(action.icon)
					.setSection(MENU_SECTION)
					.onClick(() => void this.runAction(editor, action.id)),
			);
		}
	}

	private readFromEditor(editor: Editor): void {
		void this.runAction(editor, "read");
	}

	/**
	 * Read the selection, and for the two saving actions write it to a file too.
	 *
	 * The range is captured before the first await: synthesis takes seconds, and
	 * the link must replace the words that were read rather than wherever the
	 * cursor has moved to since.
	 */
	private async runAction(editor: Editor, action: MenuActionId): Promise<void> {
		const range = editor.listSelections()[0];
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

		this.announceDetection(plan.selection);
		const { profile } = plan.selection;

		if (action === "read") {
			await this.readPrepared(plan.text, profile);
			return;
		}

		const basename = await this.basenameAsking(profile, raw);
		if (basename === null) return;

		// One synthesis, not two: the rendered buffer is played rather than
		// asking the provider for the same audio a second time.
		const outcome = await this.runSave(saveAudioPrepared, {
			text: plan.text,
			profile,
			basename,
		});
		if (!outcome.ok) return;

		new Notice(`Saved ${outcome.path}`);
		// Not awaited: the link belongs in the note now, not when playback ends.
		void this.player.playClip(outcome.clip).catch((err: unknown) => {
			new Notice(userMessage(err));
			console.error("[multilingual-tts] could not play the saved audio", err);
		});
		if (action === "link" && range) this.linkSelection(editor, range, outcome.path);
	}

	/** Say which voice was chosen, once per change of profile or language. */
	private announceDetection(selection: ProfileSelection): void {
		if (!shouldAnnounce(selection)) return;

		const signature = `${selection.profile.id}:${selection.detected ?? ""}`;
		if (signature === this.lastAnnouncement) return;

		new Notice(describeSelection(selection));
		this.lastAnnouncement = signature;
	}

	/**
	 * Replace the words that were read with a link to their audio.
	 *
	 * A selection made backwards has its head before its anchor, so the two are
	 * put in order before the range is read or written.
	 */
	private linkSelection(editor: Editor, range: EditorSelection, path: string): void {
		const file = this.fileAt(path);
		if (!file) return;

		const forward = editor.posToOffset(range.anchor) <= editor.posToOffset(range.head);
		const from = forward ? range.anchor : range.head;
		const to = forward ? range.head : range.anchor;

		// Resolved against the note that receives the link, so the link is the
		// shortest form that works from that note.
		const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
		const markup = audioLink(this.settings.menu.linkStyle, editor.getRange(from, to), {
			linktext: this.app.metadataCache.fileToLinktext(file, sourcePath),
			path,
		});
		editor.replaceRange(markup, from, to);
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
			defaultBasename: (chosen, text) => this.basenameFor(chosen, text),
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

	/** The file name a save produces, from the profile's template chain. */
	private basenameFor(profile: VoiceProfile, selection: string): string {
		return expandNameTemplate(
			resolveNameTemplates(profile, this.settings),
			this.nameVars(profile, selection),
		);
	}

	/**
	 * The same name, first asking for any property the note does not supply.
	 *
	 * Null when the user closes that dialog, which cancels the save before any
	 * synthesis is paid for. The convert dialog uses `basenameFor` instead: it
	 * shows the name in an editable field, so it is already the prompt.
	 */
	private async basenameAsking(
		profile: VoiceProfile,
		selection: string,
	): Promise<string | null> {
		const chain = resolveNameTemplates(profile, this.settings);
		const vars = this.nameVars(profile, selection);

		if (!this.settings.output.askForMissingProperty) {
			return expandNameTemplate(chain, vars);
		}

		const missing = missingProperties(chain, vars);
		if (missing.length === 0) return expandNameTemplate(chain, vars);

		const answers = await this.askForProperties(missing, vars.title);
		if (!answers) return null;

		return expandNameTemplate(chain, {
			...vars,
			properties: { ...vars.properties, ...answers },
		});
	}

	/** Null when the user closed the dialog rather than naming the file. */
	private askForProperties(
		names: string[],
		fallback: string,
	): Promise<Record<string, string> | null> {
		return new Promise((resolve) => {
			new PropertyPromptModal(this.app, {
				names,
				fallback,
				onSubmit: (values) => resolve(values),
				onCancel: () => resolve(null),
			}).open();
		});
	}

	/** Everything a name template can refer to, for the note that is open. */
	private nameVars(profile: VoiceProfile, selection: string): NameVars {
		const active = this.app.workspace.getActiveFile();

		return {
			title: active?.basename ?? "audio",
			selection,
			profile: profile.name,
			locale: profile.locale,
			properties: active
				? (this.app.metadataCache.getFileCache(active)?.frontmatter ?? {})
				: {},
			now: new Date(),
			formatDate: formatWithMoment,
		};
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
		return this.runSave(saveAudio, { text: rawText, profile, basename }, onProgress);
	}

	/**
	 * Run one of the two save use cases, cancelling any save already in flight.
	 *
	 * Which one is the caller's choice: the context menu has prepared its text
	 * already, and the convert dialog has not.
	 */
	private async runSave(
		save: typeof saveAudio,
		req: { text: string; profile: VoiceProfile; basename: string },
		onProgress?: (progress: RenderProgress) => void,
	): Promise<SaveOutcome> {
		// A closed passphrase dialog is a cancellation, and reports no message.
		if (!(await this.unlocked(req.profile))) return { ok: false, reason: "cancelled" };

		this.renderAbort?.abort();
		const controller = new AbortController();
		this.renderAbort = controller;

		try {
			const outcome = await save(
				this.saveDeps(),
				{ ...req, signal: controller.signal },
				onProgress,
			);
			this.announce(outcome, "convert");
			return outcome;
		} finally {
			if (this.renderAbort === controller) this.renderAbort = null;
		}
	}

	/**
	 * What a run of `preset` would do, without doing any of it.
	 *
	 * Public so a QuickAdd or Templater script reads the same numbers the
	 * preview dialog shows. Nothing is synthesized and nothing is written.
	 *
	 * The queue comes from one snapshot of the metadata cache. Obsidian
	 * reindexes for minutes after a large batch, so a second read part way
	 * through a run would disagree with the first.
	 */
	previewBatch(preset: BatchPreset | string): BatchPlan {
		return planBatch(
			this.noteIndex.snapshot(),
			this.batchPreset(preset),
			this.planDeps(),
		);
	}

	/** The preset with this id, or the one that was passed whole. */
	private batchPreset(preset: BatchPreset | string): BatchPreset {
		if (typeof preset !== "string") return preset;

		const found = this.settings.batch.presets.find((p) => p.id === preset);
		if (!found) throw new TtsError("invalid-request", "No such batch preset", preset);
		return found;
	}

	private planDeps(): PlanDeps {
		return {
			settings: this.settings,
			output: (profile) => this.outputFor(profile),
			// Resolved against the note that holds the link, so a clip beside its
			// own card is found the same way Obsidian finds it.
			resolveLink: (linktext, from) =>
				this.app.metadataCache.getFirstLinkpathDest(linktext, from)?.path ?? null,
			exists: (path) => this.audioStore.exists(path),
			formatDate: formatWithMoment,
		};
	}

	/**
	 * What a profile writes, refusing in the order `saveAudioPrepared` refuses,
	 * so a preview and the run after it never disagree about what is possible.
	 */
	private outputFor(profile: VoiceProfile): ReturnType<OutputResolver> {
		const provider = this.providers.get(profile.providerId);
		if (!provider) return { ok: false, reason: "unknown-provider" };
		if (provider.kind !== "rendering") return { ok: false, reason: "cannot-render" };
		if (!provider.isConfigured()) return { ok: false, reason: "not-configured" };

		const format = provider.outputFormat({
			...profile,
			audioFormat: resolveAudioFormat(profile, this.settings),
		});
		return { ok: true, extension: format.extension };
	}

	/** Open the preset picker, or give the reason it cannot open. */
	private pickPreset(onChoose: (preset: BatchPreset) => void): void {
		const { presets } = this.settings.batch;
		const [only] = presets;

		if (!only) {
			new Notice("No batch presets yet. Add one in settings.");
			return;
		}
		// One preset is not a choice, and a picker with one row is a delay.
		if (presets.length === 1) {
			onChoose(only);
			return;
		}
		new BatchPresetSuggestModal(this.app, presets, onChoose).open();
	}

	/** Show what a run would do. The settings tab and the command share it. */
	openBatchPreview(preset: BatchPreset): void {
		try {
			new BatchPreviewModal(this.app, this.previewBatch(preset)).open();
		} catch (err) {
			new Notice(userMessage(err));
			console.error("[multilingual-tts] could not preview the batch", err);
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
			// The id is a generated one, so it means nothing to the reader. What
			// matters is that the provider is gone and the profile needs a new one.
			return "This profile's speech provider no longer exists. Pick another in settings.";
		case "not-configured":
			return `${outcome.detail} is not configured.`;
		case "cannot-render":
			return `${outcome.detail} cannot save to a file.`;
		case "empty-text":
			return `Nothing left to ${verb} after formatting.`;
	}
}
