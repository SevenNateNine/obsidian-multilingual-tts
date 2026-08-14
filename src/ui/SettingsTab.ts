import { App, Menu, Notice, PluginSettingTab, Setting, debounce } from "obsidian";
import type MultilingualTtsPlugin from "../main";
import { createProfile, type VoiceProfile } from "../core/settings/types";
import { KEY_STORAGE_MODES, type KeyStorage } from "../core/settings/secret";
import { ProfileEditorModal } from "./ProfileEditorModal";
import { PassphraseModal } from "./PassphraseModal";
import { validateFolderPath } from "../core/paths";
import { userMessage } from "../core/errors";
import { isDetectable, languageSubtag } from "../core/text/languages";
import { formatAbsoluteTime, formatRelativeTime } from "../core/time";
import type { AzureProvider } from "../adapters/azure/AzureProvider";
import type { CatalogCacheInfo } from "../adapters/azure/voiceCatalog";
import { setButtonLabel } from "../adapters/obsidian/buttonLabel";

const KEY_STORAGE_LABELS: Record<KeyStorage, string> = {
	plain: "Plain text",
	obfuscated: "Obfuscated",
	passphrase: "Encrypted with a passphrase",
};

const KEY_STORAGE_DESCRIPTIONS: Record<KeyStorage, string> = {
	plain: "Anything that opens data.json can read the key.",
	obfuscated:
		"Encoded, not encrypted. It stops a casual read, a screenshot and a " +
		"pasted bug report. It does not stop anybody who wants the key.",
	passphrase:
		"AES-GCM, with the passphrase stretched by PBKDF2. You enter it once " +
		"per session. A lost passphrase means you paste the key again from Azure.",
};

export class SettingsTab extends PluginSettingTab {
	/**
	 * `azure` arrives separately from the registry. A speech key, a region and a
	 * refreshable catalog belong to this one engine, so the block that renders
	 * them is Azure-specific by nature.
	 */
	constructor(
		app: App,
		private readonly plugin: MultilingualTtsPlugin,
		private readonly azure: AzureProvider,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderProfiles(containerEl);
		this.renderAutoDetect(containerEl);
		this.renderAzure(containerEl);
		this.renderOutput(containerEl);
		this.renderReading(containerEl);
	}

	private renderAutoDetect(container: HTMLElement): void {
		new Setting(container)
			.setName("Language auto-detection")
			.setDesc(
				"Pick the profile whose language matches the selected text. " +
					"Reading with a specific profile always overrides this.",
			)
			.setHeading();

		new Setting(container)
			.setName("Detect language from selected text")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoDetect.enabled)
					.onChange(async (value) => {
						this.plugin.settings.autoDetect.enabled = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (!this.plugin.settings.autoDetect.enabled) return;

		new Setting(container)
			.setName("Minimum length")
			.setDesc(
				"Shorter selections use the default profile instead of guessing. " +
					"Detection is unreliable on very short text.",
			)
			.addSlider((slider) =>
				slider
					.setLimits(10, 200, 5)
					.setValue(this.plugin.settings.autoDetect.minChars)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.autoDetect.minChars = value;
						await this.plugin.saveSettings();
					}),
			);

		this.renderDetectionStatus(container);
	}

	/**
	 * Detection can only choose between languages the profiles actually cover,
	 * so say plainly what it will consider — otherwise a no-op looks like a bug.
	 */
	private renderDetectionStatus(container: HTMLElement): void {
		const { profiles, defaultProfileId } = this.plugin.settings;
		const participating = profiles.filter((p) => p.useForAutoDetect);

		const languages = new Set<string>();
		const unmapped: string[] = [];
		for (const profile of participating) {
			if (isDetectable(profile.locale)) languages.add(languageSubtag(profile.locale));
			else unmapped.push(profile.name);
		}
		const fallback = profiles.find((p) => p.id === defaultProfileId) ?? profiles[0];
		if (fallback && isDetectable(fallback.locale)) {
			languages.add(languageSubtag(fallback.locale));
		}

		const status = container.createDiv({ cls: "t2ap-detect-status" });

		if (languages.size < 2) {
			status.createDiv({
				cls: "t2ap-detect-warning",
				text:
					"Detection needs profiles in at least two languages to have " +
					"anything to choose between. Right now every profile resolves " +
					"to the same language, so the default profile is always used.",
			});
		} else {
			status.createDiv({
				text: `Choosing between: ${[...languages].sort().join(", ")}.`,
			});
		}

		if (unmapped.length > 0) {
			status.createDiv({
				cls: "t2ap-detect-warning",
				text: `Not detectable, so only selectable manually: ${unmapped.join(", ")}.`,
			});
		}
	}

	private renderAzure(container: HTMLElement): void {
		new Setting(container)
			.setName("Azure Speech")
			.setDesc(
				"Optional. Adds high-quality neural voices with speaking styles. " +
					"System voices work without any of this.",
			)
			.setHeading();

		this.renderKeyStorage(container);
		this.renderKeyField(container);

		new Setting(container)
			.setName("Region")
			.setDesc("The resource's region identifier, for example eastus.")
			.addText((text) =>
				text
					.setPlaceholder("eastus")
					.setValue(this.plugin.settings.azure.region)
					.onChange(async (value) => {
						this.plugin.settings.azure.region = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		// Declared before the setting so the button's handler can close over it,
		// but created after, so it renders below the button.
		let status: HTMLElement | null = null;
		const showCacheStatus = () => {
			if (status) void this.renderCacheStatus(status);
		};

		new Setting(container)
			.setName("Voice list")
			.setDesc(
				"Voices are fetched from Azure and cached for a week, so new voices " +
					"appear without a plugin update.",
			)
			.addButton((btn) => {
				const label = (text: string) => setButtonLabel(btn, "refresh-cw", text);

				btn.setTooltip("Refreshes voice list");
				label("Refresh");

				btn.onClick(async () => {
					// Locked means the key is present but unreadable. Asking for the
					// passphrase is the right prompt, not "enter a speech key".
					if (this.plugin.isAzureKeyLocked()) {
						if (!(await this.plugin.unlockAzureKey())) return;
						this.display();
					}
					if (!this.azure.isConfigured()) {
						new Notice("Enter a speech key and region first.");
						return;
					}
					btn.setDisabled(true);
					label("Refreshing…");
					try {
						const voices = await this.azure.refreshVoices();
						new Notice(`Loaded ${voices.length} Azure voices.`);
					} catch (err) {
						new Notice(userMessage(err));
					} finally {
						btn.setDisabled(false);
						label("Refresh");
						showCacheStatus();
					}
				});
			});

		// Starts empty and fills asynchronously, because display() is synchronous.
		status = container.createDiv({ cls: "t2ap-cache-status" });
		showCacheStatus();
	}

	/**
	 * How the key is written to data.json.
	 *
	 * The wording says plainly what each level does and does not do. Obfuscation
	 * is not encryption, and a user who believes it is can make a bad decision.
	 */
	private renderKeyStorage(container: HTMLElement): void {
		const { keyStorage } = this.plugin.settings.azure;

		new Setting(container)
			.setName("Key storage")
			.setDesc(KEY_STORAGE_DESCRIPTIONS[keyStorage])
			.addDropdown((dd) => {
				for (const mode of KEY_STORAGE_MODES) {
					dd.addOption(mode, KEY_STORAGE_LABELS[mode]);
				}
				dd.setValue(keyStorage).onChange(
					(value) => void this.changeKeyStorage(value as KeyStorage),
				);
			});

		if (keyStorage === "plain") {
			container.createDiv({
				cls: "t2ap-key-warning",
				text:
					"The key is stored as plain text in this plugin's data.json. " +
					"If you sync your vault, the key syncs with it.",
			});
		}
	}

	/**
	 * Re-encode the stored key for a new mode.
	 *
	 * Every direction needs the key in the clear first, so a locked key is
	 * unlocked before anything changes. A cancelled dialog leaves the mode alone,
	 * and the redraw puts the dropdown back to what is actually stored.
	 */
	private async changeKeyStorage(mode: KeyStorage): Promise<void> {
		if (this.plugin.isAzureKeyLocked() && !(await this.plugin.unlockAzureKey())) {
			this.display();
			return;
		}

		if (mode !== "passphrase") {
			await this.plugin.setKeyStorage(mode, null);
			this.display();
			return;
		}

		new PassphraseModal(this.app, {
			mode: "create",
			onSubmit: async (passphrase) => {
				await this.plugin.setKeyStorage("passphrase", passphrase);
				this.display();
				return null;
			},
			onCancel: () => this.display(),
		}).open();
	}

	/** A locked key cannot be shown or edited, so it offers an unlock instead. */
	private renderKeyField(container: HTMLElement): void {
		if (this.plugin.isAzureKeyLocked()) {
			new Setting(container)
				.setName("Speech key")
				.setDesc("Encrypted. Unlock it to use Azure voices in this session.")
				.addButton((btn) =>
					btn
						.setButtonText("Unlock")
						.setCta()
						.onClick(async () => {
							if (await this.plugin.unlockAzureKey()) this.display();
						}),
				);
			return;
		}

		// Encrypting on every keystroke would run PBKDF2 per character, so the
		// value updates immediately and only the write to disk waits for a pause.
		const persist = debounce(() => void this.plugin.saveSettings(), 500, true);

		new Setting(container)
			.setName("Speech key")
			.setDesc("From your Azure Speech resource's Keys and Endpoint page.")
			.addText((text) => {
				text
					.setPlaceholder("Enter your speech key")
					.setValue(this.plugin.settings.azure.key)
					.onChange((value) => {
						this.plugin.setAzureKeyValue(value.trim());
						persist();
					});
				text.inputEl.type = "password";
				text.inputEl.autocomplete = "off";
			});
	}

	/**
	 * What is cached, shown at all times rather than only after a refresh.
	 * The cache is what makes per-voice style and role gating work, and it
	 * expires after a week, so its age is worth surfacing.
	 */
	private async renderCacheStatus(el: HTMLElement): Promise<void> {
		const { azure } = this;
		const region = this.plugin.settings.azure.region.trim();

		let info: CatalogCacheInfo | null = null;
		try {
			info = await azure.cacheInfo();
		} catch {
			info = null;
		}

		el.empty();
		el.removeAttribute("title");

		if (!info || info.voiceCount === 0) {
			el.setText(
				azure.isConfigured()
					? "No voice list cached yet. Press Refresh to load voices."
					: "No voice list cached. Add a speech key and region above.",
			);
			return;
		}

		// isCatalogFresh rejects a catalog from another region, so a region change
		// silently invalidates the cache. Say so instead of showing stale counts.
		if (region && info.region && info.region !== region) {
			el.addClass("t2ap-detect-warning");
			el.setText(
				`Cached for ${info.region}. The current region is ${region}. Press Refresh.`,
			);
			return;
		}

		el.removeClass("t2ap-detect-warning");
		el.setText(
			`${info.voiceCount} voices across ${info.localeCount} languages · updated ${formatRelativeTime(info.fetchedAt)}`,
		);
		el.setAttribute("title", formatAbsoluteTime(info.fetchedAt));
	}

	private renderProfiles(container: HTMLElement): void {
		new Setting(container)
			.setName("Voice profiles")
			.setDesc(
				"Saved combinations of language, voice and delivery. The order here " +
					"is the priority used when more than one profile matches.",
			)
			.setHeading()
			.addButton((btn) =>
				btn
					.setButtonText("Add profile")
					.setCta()
					.onClick(() => this.openEditor(createProfile(), true)),
			);

		const { profiles, defaultProfileId } = this.plugin.settings;

		if (profiles.length === 0) {
			container.createEl("p", {
				cls: "setting-item-description",
				text: "No profiles yet. Add one to start reading notes aloud.",
			});
			return;
		}

		profiles.forEach((profile, index) => {
			const isDefault = profile.id === defaultProfileId;
			const setting = new Setting(container)
				.setName(isDefault ? `${profile.name} (default)` : profile.name)
				.setDesc(this.describeProfile(profile));

			setting.settingEl.addClass("t2ap-profile-row");
			if (isDefault) setting.settingEl.addClass("t2ap-profile-default");

			if (!isDefault) {
				setting.addExtraButton((btn) =>
					btn
						.setIcon("star")
						.setTooltip("Make default")
						.onClick(() => void this.setDefault(profile.id)),
				);
			}

			setting.addExtraButton((btn) =>
				btn
					.setIcon("play")
					.setTooltip("Preview")
					.onClick(() => void this.preview(profile)),
			);

			setting.addExtraButton((btn) =>
				btn
					.setIcon("pencil")
					.setTooltip("Edit")
					.onClick(() => this.openEditor({ ...profile }, false)),
			);

			setting.addExtraButton((btn) =>
				btn
					.setIcon("more-vertical")
					.setTooltip("More")
					.onClick(() => {
						// addExtraButton's handler receives no event, so anchor the
						// menu to the button's own position instead.
						const rect = btn.extraSettingsEl.getBoundingClientRect();
						this.openRowMenu({ x: rect.left, y: rect.bottom }, profile, index);
					}),
			);
		});
	}

	private openRowMenu(
		position: { x: number; y: number },
		profile: VoiceProfile,
		index: number,
	): void {
		const menu = new Menu();
		const { profiles } = this.plugin.settings;

		menu.addItem((item) =>
			item
				.setTitle("Duplicate")
				.setIcon("copy")
				.onClick(() => void this.duplicate(profile, index)),
		);

		menu.addItem((item) =>
			item
				.setTitle("Move up")
				.setIcon("arrow-up")
				.setDisabled(index === 0)
				.onClick(() => void this.move(index, -1)),
		);

		menu.addItem((item) =>
			item
				.setTitle("Move down")
				.setIcon("arrow-down")
				.setDisabled(index === profiles.length - 1)
				.onClick(() => void this.move(index, 1)),
		);

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => void this.remove(profile)),
		);

		menu.showAtPosition(position);
	}

	private renderOutput(container: HTMLElement): void {
		new Setting(container).setName("Output").setHeading();

		let error: HTMLElement | null = null;
		new Setting(container)
			.setName("Default save folder")
			.setDesc(
				"Vault-relative folder for saved audio. Individual profiles can " +
					"override this. Leave empty to save at the vault root.",
			)
			.addText((text) => {
				text
					.setPlaceholder("Audio")
					.setValue(this.plugin.settings.output.defaultFolder)
					.onChange(async (value) => {
						const message = validateFolderPath(value);
						text.inputEl.toggleClass("t2ap-invalid", message !== null);
						if (error) error.setText(message ?? "");
						if (message) return;
						this.plugin.settings.output.defaultFolder = value;
						await this.plugin.saveSettings();
					});
				error =
					text.inputEl.parentElement?.createDiv({ cls: "t2ap-field-error" }) ?? null;
			});

		new Setting(container)
			.setName("Insert player at cursor")
			.setDesc("After saving, insert an audio player where the cursor is.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.output.insertPlayerAtCursor)
					.onChange(async (value) => {
						this.plugin.settings.output.insertPlayerAtCursor = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderReading(container: HTMLElement): void {
		new Setting(container).setName("Reading").setHeading();

		new Setting(container)
			.setName("With no selection, read")
			.setDesc("What to read when nothing is selected.")
			.addDropdown((dd) =>
				dd
					.addOptions({
						off: "Nothing",
						before: "Everything before the cursor",
						after: "Everything after the cursor",
					})
					.setValue(this.plugin.settings.reading.readBeforeOrAfter)
					.onChange(async (value) => {
						this.plugin.settings.reading.readBeforeOrAfter = value as
							"off" | "before" | "after";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(container)
			.setName("Strip markdown")
			.setDesc("Remove syntax, code blocks, links and frontmatter before speaking.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.stripMarkdown).onChange(async (value) => {
					this.plugin.settings.stripMarkdown = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(container)
			.setName("Text filter")
			.setDesc(
				"Optional regular expression. Matches are replaced with a space. " +
					"An invalid pattern is ignored.",
			)
			.addText((text) =>
				text
					.setPlaceholder("/[^\\w\\s]/g")
					.setValue(this.plugin.settings.textFilterRegex)
					.onChange(async (value) => {
						this.plugin.settings.textFilterRegex = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	private describeProfile(profile: VoiceProfile): string {
		const provider = this.plugin.providers.get(profile.provider);
		const bits = [profile.locale, provider?.displayName ?? profile.provider];
		if (profile.style) bits.push(profile.style);
		if (profile.outputFolder) bits.push(`→ ${profile.outputFolder}`);

		const summary = bits.join(" · ");
		return profile.description ? `${profile.description}\n${summary}` : summary;
	}

	private openEditor(profile: VoiceProfile, isNew: boolean): void {
		new ProfileEditorModal(this.app, this.plugin, profile, isNew, async (result) => {
			const { profiles } = this.plugin.settings;
			const index = profiles.findIndex((p) => p.id === result.id);
			if (index >= 0) profiles[index] = result;
			else profiles.push(result);

			this.plugin.settings.defaultProfileId ??= result.id;
			await this.plugin.saveSettings();
			this.display();
		}).open();
	}

	private async setDefault(id: string): Promise<void> {
		this.plugin.settings.defaultProfileId = id;
		await this.plugin.saveSettings();
		this.display();
	}

	private async preview(profile: VoiceProfile): Promise<void> {
		await this.plugin.speak("This is how this profile sounds.", profile);
	}

	private async duplicate(profile: VoiceProfile, index: number): Promise<void> {
		// Drop the id so createProfile makes a new one. Every other field carries over.
		const { id: _discarded, ...rest } = profile;
		const copy = createProfile({ ...rest, name: `${profile.name} copy` });
		this.plugin.settings.profiles.splice(index + 1, 0, copy);
		await this.plugin.saveSettings();
		this.display();
	}

	private async move(index: number, delta: number): Promise<void> {
		const { profiles } = this.plugin.settings;
		const target = index + delta;
		const moved = profiles[index];
		const displaced = profiles[target];
		if (!moved || !displaced) return;
		profiles[index] = displaced;
		profiles[target] = moved;
		await this.plugin.saveSettings();
		this.display();
	}

	private async remove(profile: VoiceProfile): Promise<void> {
		const { settings } = this.plugin;
		settings.profiles = settings.profiles.filter((p) => p.id !== profile.id);

		if (settings.defaultProfileId === profile.id) {
			settings.defaultProfileId = settings.profiles[0]?.id ?? null;
		}

		await this.plugin.saveSettings();
		this.display();
		new Notice(`Deleted "${profile.name}".`);
	}
}
