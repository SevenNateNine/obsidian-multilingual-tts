import { App, Menu, Notice, PluginSettingTab, Setting } from "obsidian";
import type MultilingualTtsPlugin from "../main";
import {
	createProfile,
	createProviderInstance,
	findProviderInstance,
	uniqueProviderName,
	type ProviderInstance,
	type VoiceProfile,
} from "../core/settings/types";
import { instantiableTypes, providerTypeInfo } from "../core/tts/providerTypes";
import { ProfileEditorModal } from "./ProfileEditorModal";
import { ProviderEditorModal } from "./ProviderEditorModal";
import { sanitizeFilename, validateFolderPath } from "../core/paths";
import {
	expandNameTemplate,
	nameTemplateError,
	BUILTIN_NAME_TEMPLATE,
} from "../core/text/nameTemplate";
import { LINK_STYLES, type LinkStyle } from "../core/text/audioLink";
import { nameTemplateHelp } from "./nameTemplateHelp";
import { formatWithMoment } from "../adapters/obsidian/momentFormat";
import { userMessage } from "../core/errors";
import { isDetectable, languageSubtag } from "../core/text/languages";
import { setButtonLabel } from "../adapters/obsidian/buttonLabel";
import { addDropdownTooltip } from "../adapters/obsidian/dropdown";

type TabId = "general" | "providers";

const LINK_STYLE_LABELS: Record<LinkStyle, string> = {
	wikilink: "Wikilink — [[audio.mp3|word]]",
	markdown: "Markdown link — [word](audio.mp3)",
	embed: "Player after the word — word ![[audio.mp3]]",
};

const TABS: readonly { id: TabId; label: string }[] = [
	{ id: "general", label: "General" },
	{ id: "providers", label: "Providers" },
];

/** Why a refresh produced no new voice list. */
type RefreshResult =
	| { ok: true; count: number }
	| { ok: false; reason: "locked" | "missing" | "not-configured" }
	| { ok: false; reason: "failed"; error: unknown };

export class SettingsTab extends PluginSettingTab {
	private activeTab: TabId = "general";
	private bodyEl: HTMLElement | null = null;
	private readonly tabButtons = new Map<TabId, HTMLElement>();

	constructor(
		app: App,
		private readonly plugin: MultilingualTtsPlugin,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.tabButtons.clear();

		this.renderTabBar(containerEl);
		this.bodyEl = containerEl.createDiv({ cls: "t2ap-tab-body" });
		this.renderBody();
	}

	/**
	 * Redraw the current tab only.
	 *
	 * Almost every control here redraws after saving, because one option can hide
	 * or reveal another. Rebuilding the whole screen would send the user back to
	 * the first tab after each edit, so the bar is built once and stays.
	 */
	private renderBody(): void {
		const body = this.bodyEl;
		if (!body) return;

		body.empty();
		if (this.activeTab === "general") this.renderGeneral(body);
		else this.renderProviders(body);
	}

	private renderGeneral(container: HTMLElement): void {
		this.renderProfiles(container);
		this.renderAutoDetect(container);
		this.renderMenu(container);
		this.renderOutput(container);
		this.renderReading(container);
	}

	/**
	 * Which of the three actions the right-click menu offers.
	 *
	 * Every action reads the selection. The two saving ones also write a file,
	 * and the third replaces the words with a link to it. Turning all three off
	 * leaves the commands and the ribbon icon working.
	 */
	private renderMenu(container: HTMLElement): void {
		new Setting(container)
			.setName("Context menu")
			.setDesc("The items shown when you right-click a selection.")
			.setHeading();

		const { menu } = this.plugin.settings;
		const items: readonly {
			key: "read" | "save" | "link";
			name: string;
			desc: string;
		}[] = [
			{ key: "read", name: "Read selection", desc: "Play the selection." },
			{
				key: "save",
				name: "Read and save audio",
				desc: "Play it and write the audio into your vault.",
			},
			{
				key: "link",
				name: "Read, save and link audio",
				desc: "The same, and replace the selection with a link to the audio.",
			},
		];

		for (const item of items) {
			new Setting(container)
				.setName(item.name)
				.setDesc(item.desc)
				.addToggle((toggle) =>
					toggle.setValue(menu[item.key]).onChange(async (value) => {
						menu[item.key] = value;
						await this.plugin.saveSettings();
						this.renderBody();
					}),
				);
		}

		if (!menu.link) return;

		new Setting(container)
			.setName("Link style")
			.setDesc("What replaces the selection after the audio is saved.")
			.addDropdown((dd) => {
				for (const style of LINK_STYLES) dd.addOption(style, LINK_STYLE_LABELS[style]);
				dd.setValue(menu.linkStyle).onChange(async (value) => {
					menu.linkStyle = value as LinkStyle;
					await this.plugin.saveSettings();
				});
				addDropdownTooltip(dd);
			});
	}

	private renderTabBar(container: HTMLElement): void {
		const bar = container.createDiv({ cls: "t2ap-tab-bar" });
		bar.setAttribute("role", "tablist");

		TABS.forEach((tab, index) => {
			const button = bar.createEl("button", { cls: "t2ap-tab", text: tab.label });
			button.type = "button";
			button.setAttribute("role", "tab");
			button.addEventListener("click", () => this.select(tab.id));
			button.addEventListener("keydown", (event) => this.onTabKey(event, index));
			this.tabButtons.set(tab.id, button);
		});

		this.markActiveTab();
	}

	/**
	 * Left and right move between tabs, which is what a tablist is expected to
	 * do. Only the selected tab is in the page's tab order, so one Tab press
	 * leaves the bar rather than walking through every tab in it.
	 */
	private onTabKey(event: KeyboardEvent, index: number): void {
		const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (delta === 0) return;

		event.preventDefault();
		const tab = TABS[(index + delta + TABS.length) % TABS.length];
		if (!tab) return;

		this.select(tab.id);
		this.tabButtons.get(tab.id)?.focus();
	}

	private select(id: TabId): void {
		if (id === this.activeTab) return;

		this.activeTab = id;
		this.markActiveTab();
		this.renderBody();
	}

	private markActiveTab(): void {
		for (const [id, button] of this.tabButtons) {
			const active = id === this.activeTab;
			button.toggleClass("is-active", active);
			button.setAttribute("aria-selected", String(active));
			button.tabIndex = active ? 0 : -1;
		}
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
						this.renderBody();
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

	private renderProviders(container: HTMLElement): void {
		new Setting(container)
			.setName("Providers")
			.setDesc(
				"The speech engines your profiles can use. Add one for each account, " +
					"and two of the same engine can hold two different subscriptions.",
			)
			.setHeading()
			.addButton((btn) => {
				setButtonLabel(btn, "refresh-cw", "Refresh all");
				btn.setTooltip("Reload every voice list that can be reloaded");
				btn.onClick(() => void this.refreshAll(btn));
			})
			.addButton((btn) =>
				btn
					.setButtonText("Add provider")
					.setCta()
					.onClick((event) => this.openTypeMenu(event)),
			);

		for (const instance of this.plugin.settings.providers) {
			this.renderProviderRow(container, instance);
		}
	}

	/** One entry per engine the user can add. The list is the extension point. */
	private openTypeMenu(event: MouseEvent): void {
		const menu = new Menu();

		for (const info of instantiableTypes()) {
			menu.addItem((item) =>
				item.setTitle(info.displayName).onClick(() => {
					const name = uniqueProviderName(this.plugin.settings, info.displayName);
					this.openProviderEditor(createProviderInstance(info.type, { name }), true);
				}),
			);
		}

		menu.showAtMouseEvent(event);
	}

	private renderProviderRow(container: HTMLElement, instance: ProviderInstance): void {
		const info = providerTypeInfo(instance.type);
		const setting = new Setting(container)
			.setName(instance.name)
			.setDesc(this.describeProvider(instance));

		setting.settingEl.addClass("t2ap-provider-row");

		setting.addButton((btn) => {
			const label = (text: string) => setButtonLabel(btn, "refresh-cw", text);
			label("Refresh");
			btn.setTooltip("Reload this provider's voice list");
			btn.onClick(async () => {
				btn.setDisabled(true);
				label("Refreshing…");
				try {
					await this.refreshOne(instance);
				} finally {
					this.renderBody();
				}
			});
		});

		setting.addExtraButton((btn) =>
			btn
				.setIcon("pencil")
				.setTooltip("Edit")
				.onClick(() => this.openProviderEditor(instance, false)),
		);

		// The device voices are neither added nor removed: the device is the
		// account, so there is exactly one and it has nothing to copy.
		if (info.instantiable) {
			setting.addExtraButton((btn) =>
				btn
					.setIcon("more-vertical")
					.setTooltip("More")
					.onClick(() => {
						const rect = btn.extraSettingsEl.getBoundingClientRect();
						this.openProviderMenu({ x: rect.left, y: rect.bottom }, instance);
					}),
			);
		}

		// Starts empty and fills asynchronously, because renderBody is synchronous.
		const status = container.createDiv({ cls: "t2ap-provider-status" });
		void this.renderProviderStatus(status, instance);
	}

	private describeProvider(instance: ProviderInstance): string {
		const bits = [providerTypeInfo(instance.type).displayName];

		if (this.plugin.isProviderLocked(instance.id)) bits.push("locked");
		else if (this.plugin.providers.get(instance.id)?.isConfigured() === false) {
			bits.push("not configured");
		}

		const used = this.plugin.settings.profiles.filter(
			(p) => p.providerId === instance.id,
		).length;
		bits.push(used === 1 ? "1 profile" : `${used} profiles`);

		return bits.join(" · ");
	}

	/**
	 * What the provider says about its own voice list. Azure reports the age and
	 * region of its cache, and the device reports how many voices it found.
	 */
	private async renderProviderStatus(
		el: HTMLElement,
		instance: ProviderInstance,
	): Promise<void> {
		el.empty();
		el.removeAttribute("title");
		el.removeClass("t2ap-detect-warning");

		if (this.plugin.isProviderLocked(instance.id)) {
			el.addClass("t2ap-detect-warning");
			el.setText("Encrypted. Unlock it to use these voices in this session.");
			return;
		}

		const provider = this.plugin.providers.get(instance.id);
		if (!provider) {
			el.addClass("t2ap-detect-warning");
			el.setText("This version has no implementation for this engine.");
			return;
		}

		const status = await provider.voiceListStatus().catch(() => null);
		if (!status) return;

		el.setText(status.text);
		el.toggleClass("t2ap-detect-warning", status.warning);
		if (status.tooltip) el.setAttribute("title", status.tooltip);
	}

	private openProviderMenu(
		position: { x: number; y: number },
		instance: ProviderInstance,
	): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("Duplicate")
				.setIcon("copy")
				.onClick(() => void this.duplicateProvider(instance)),
		);

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => void this.deleteProvider(instance)),
		);

		menu.showAtPosition(position);
	}

	private openProviderEditor(instance: ProviderInstance, isNew: boolean): void {
		new ProviderEditorModal(
			this.app,
			this.plugin,
			instance,
			isNew,
			async (result, passphrase) => {
				await this.plugin.saveProvider(result, passphrase);
				this.renderBody();
			},
		).open();
	}

	private async duplicateProvider(instance: ProviderInstance): Promise<void> {
		// A locked provider holds no plain text to copy, so the copy starts empty
		// rather than silently carrying a credential that is not there.
		const locked = this.plugin.isProviderLocked(instance.id);
		const copy = createProviderInstance(instance.type, {
			name: uniqueProviderName(this.plugin.settings, `${instance.name} copy`),
			config: { ...instance.config },
			keyStorage: instance.keyStorage,
		});

		await this.plugin.saveProvider(copy, null);
		this.renderBody();

		if (locked) new Notice(`Copied "${instance.name}" without its credentials.`);
	}

	private async deleteProvider(instance: ProviderInstance): Promise<void> {
		const orphaned = this.plugin.settings.profiles.filter(
			(p) => p.providerId === instance.id,
		).length;

		await this.plugin.removeProvider(instance.id);
		this.renderBody();

		// The profiles keep pointing at the deleted id rather than being moved to
		// another engine, so the user can add the provider back and recover them.
		new Notice(
			orphaned === 0
				? `Deleted "${instance.name}".`
				: `Deleted "${instance.name}". ${plural(orphaned, "profile")} now have no provider.`,
		);
	}

	/** Refresh one provider and report the outcome, unlocking it if necessary. */
	private async refreshOne(instance: ProviderInstance): Promise<void> {
		// Locked means the credentials are present but unreadable. Asking for the
		// passphrase is the right prompt, not "enter a speech key".
		if (this.plugin.isProviderLocked(instance.id)) {
			if (!(await this.plugin.unlockProvider(instance.id))) return;
		}

		const result = await this.refreshProvider(instance);
		new Notice(
			result.ok
				? `${instance.name}: loaded ${result.count} voices.`
				: `${instance.name}: ${refusal(result)}`,
		);
	}

	/**
	 * Refresh every provider that can be refreshed.
	 *
	 * Sequential rather than parallel: a handful of providers gain nothing from
	 * overlapping, and parallel failures would interleave their messages. A
	 * locked provider is skipped instead of chaining passphrase prompts, because
	 * each one holds its own passphrase.
	 */
	private async refreshAll(btn: {
		setDisabled(disabled: boolean): unknown;
	}): Promise<void> {
		btn.setDisabled(true);
		const failures: string[] = [];
		let refreshed = 0;
		let skipped = 0;

		try {
			for (const instance of this.plugin.settings.providers) {
				const result = await this.refreshProvider(instance);
				if (result.ok) refreshed++;
				else if (result.reason === "failed") failures.push(instance.name);
				else skipped++;
			}
		} finally {
			btn.setDisabled(false);
			this.renderBody();
		}

		const parts = [`Refreshed ${plural(refreshed, "provider")}.`];
		if (skipped > 0) parts.push(`Skipped ${skipped} locked or not configured.`);
		if (failures.length > 0) parts.push(`Failed: ${failures.join(", ")}.`);
		new Notice(parts.join(" "));
	}

	/** Silent on purpose: the caller decides how to report one or many. */
	private async refreshProvider(instance: ProviderInstance): Promise<RefreshResult> {
		if (this.plugin.isProviderLocked(instance.id)) {
			return { ok: false, reason: "locked" };
		}

		const provider = this.plugin.providers.get(instance.id);
		if (!provider) return { ok: false, reason: "missing" };
		if (!provider.isConfigured()) return { ok: false, reason: "not-configured" };

		try {
			const voices = await provider.refreshVoices();
			return { ok: true, count: voices.length };
		} catch (error) {
			return { ok: false, reason: "failed", error };
		}
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

		this.renderNameTemplate(container);
		this.renderDefaultFormat(container);

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

	/**
	 * The name every saved file gets, unless a profile overrides it.
	 *
	 * The preview matters more than the description here: a format token is
	 * hard to read, and the answer is one line of example output away.
	 */
	private renderNameTemplate(container: HTMLElement): void {
		let error: HTMLElement | null = null;
		let preview: HTMLElement | null = null;

		const show = (value: string) => {
			const message = nameTemplateError(value);
			error?.setText(message ?? "");
			preview?.setText(`Example: ${this.previewName(value)}`);
		};

		new Setting(container)
			.setName("File name template")
			.setDesc(
				nameTemplateHelp(
					"How saved audio is named. Leave it empty to name each file after " +
						"the words you read.",
				),
			)
			.addText((text) => {
				text
					.setPlaceholder(BUILTIN_NAME_TEMPLATE)
					.setValue(this.plugin.settings.output.nameTemplate)
					.onChange(async (value) => {
						this.plugin.settings.output.nameTemplate = value;
						show(value);
						await this.plugin.saveSettings();
					});
				const parent = text.inputEl.parentElement;
				error = parent?.createDiv({ cls: "t2ap-field-error" }) ?? null;
				preview = parent?.createDiv({ cls: "t2ap-field-preview" }) ?? null;
			});

		show(this.plugin.settings.output.nameTemplate);

		new Setting(container)
			.setName("Ask for a missing property")
			.setDesc(
				"When a template asks for a note property that does not exist, ask for " +
					"the value instead of using the name of the note. This applies to the " +
					"right-click actions. The convert dialog already shows the name in a " +
					"field you can edit.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.output.askForMissingProperty)
					.onChange(async (value) => {
						this.plugin.settings.output.askForMissingProperty = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	/** What `template` produces for the note that is open, without saving anything. */
	private previewName(template: string): string {
		const profile = this.plugin.settings.profiles[0];
		const active = this.app.workspace.getActiveFile();

		return sanitizeFilename(
			expandNameTemplate([template.trim(), BUILTIN_NAME_TEMPLATE].filter(Boolean), {
				title: active?.basename ?? "audio",
				selection: "an example selection",
				profile: profile?.name ?? "profile",
				locale: profile?.locale ?? "en-US",
				properties: active
					? (this.app.metadataCache.getFileCache(active)?.frontmatter ?? {})
					: {},
				now: new Date(),
				formatDate: formatWithMoment,
			}),
		);
	}

	/**
	 * The format a profile writes when it has none of its own.
	 *
	 * The options are what the configured engines can write, so no engine is
	 * named here. Nothing is drawn when none of them writes a file, which is the
	 * same rule the profile editor applies.
	 */
	private renderDefaultFormat(container: HTMLElement): void {
		const options: Record<string, string> = {};
		for (const provider of this.plugin.providers.all()) {
			if (provider.kind === "rendering") {
				Object.assign(options, provider.audioFormatOptions());
			}
		}
		if (Object.keys(options).length === 0) return;

		new Setting(container)
			.setName("Default audio format")
			.setDesc("Used when saving to a file. Individual profiles can override this.")
			.addDropdown((dd) => {
				dd.addOption("", "Provider default");
				dd.addOptions(options)
					.setValue(this.plugin.settings.output.defaultFormat)
					.onChange(async (value) => {
						this.plugin.settings.output.defaultFormat = value;
						await this.plugin.saveSettings();
					});

				addDropdownTooltip(dd);
			});
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
			this.renderProfileRow(container, profile, index, defaultProfileId);
		});
	}

	private renderProfileRow(
		container: HTMLElement,
		profile: VoiceProfile,
		index: number,
		defaultProfileId: string | null,
	): void {
		const isDefault = profile.id === defaultProfileId;
		const setting = new Setting(container)
			.setName(isDefault ? `${profile.name} (default)` : profile.name)
			.setDesc(this.describeProfile(profile));

		setting.settingEl.addClass("t2ap-profile-row");
		if (isDefault) setting.settingEl.addClass("t2ap-profile-default");
		// A profile whose provider was deleted cannot speak. Mark it here rather
		// than leaving the user to discover it the next time they press play.
		if (!this.plugin.providers.get(profile.providerId)) {
			setting.settingEl.addClass("t2ap-profile-orphan");
		}

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

	private describeProfile(profile: VoiceProfile): string {
		const instance = findProviderInstance(this.plugin.settings, profile.providerId);
		const bits = [profile.locale, instance?.name ?? "provider missing"];
		if (profile.style) bits.push(profile.style);
		if (profile.outputFolder) bits.push(`→ ${profile.outputFolder}`);
		if (profile.nameTemplate) bits.push(profile.nameTemplate);

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
			this.renderBody();
		}).open();
	}

	private async setDefault(id: string): Promise<void> {
		this.plugin.settings.defaultProfileId = id;
		await this.plugin.saveSettings();
		this.renderBody();
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
		this.renderBody();
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
		this.renderBody();
	}

	private async remove(profile: VoiceProfile): Promise<void> {
		const { settings } = this.plugin;
		settings.profiles = settings.profiles.filter((p) => p.id !== profile.id);

		if (settings.defaultProfileId === profile.id) {
			settings.defaultProfileId = settings.profiles[0]?.id ?? null;
		}

		await this.plugin.saveSettings();
		this.renderBody();
		new Notice(`Deleted "${profile.name}".`);
	}
}

function plural(count: number, noun: string): string {
	return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

function refusal(result: Extract<RefreshResult, { ok: false }>): string {
	switch (result.reason) {
		case "locked":
			return "still encrypted.";
		case "missing":
			return "this version has no implementation for this engine.";
		case "not-configured":
			return "add its credentials first.";
		case "failed":
			return userMessage(result.error);
	}
}
