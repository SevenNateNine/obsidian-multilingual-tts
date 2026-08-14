import { App, Modal, Notice, Setting } from "obsidian";
import type MultilingualTtsPlugin from "../main";
import type { VoiceProfile } from "../core/settings/types";
import type { VoiceInfo } from "../core/tts/types";
import { languageSubtag } from "../core/text/languages";
import { validateFolderPath } from "../core/paths";
import { DEFAULT_AUDIO_FORMAT_ID, audioFormatOptions } from "../adapters/azure/formats";
import { setButtonLabel } from "../adapters/obsidian/buttonLabel";

const DEFAULT_PREVIEW_TEXT = "This is how this profile sounds.";

const PREVIEW_TEXT: Record<string, string> = {
	fr: "Voici comment cette configuration sonne.",
	es: "Así es como suena esta configuración.",
	de: "So klingt diese Konfiguration.",
	it: "Ecco come suona questa configurazione.",
	pt: "É assim que esta configuração soa.",
	ja: "この設定はこのように聞こえます。",
	zh: "这是此配置的声音。",
	ko: "이 설정은 이렇게 들립니다.",
	ru: "Вот как звучит эта конфигурация.",
};

/**
 * Create or edit one profile.
 *
 * Works on a copy and commits only on Save, so Cancel discards all changes.
 * The voice-dependent fields (style, role, style degree) are built again when
 * the selected voice changes. They are omitted when that voice does not
 * advertise them, so an unsupported style can never reach the service.
 */
export class ProfileEditorModal extends Modal {
	private draft: VoiceProfile;
	/** The values as they were when the modal opened. Undo restores these. */
	private readonly original: VoiceProfile;
	private voices: VoiceInfo[] = [];
	private loadError: string | null = null;
	private dynamicEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly plugin: MultilingualTtsPlugin,
		profile: VoiceProfile,
		private readonly isNew: boolean,
		private readonly onCommit: (profile: VoiceProfile) => Promise<void>,
	) {
		super(app);
		this.draft = { ...profile };
		this.original = { ...profile };
	}

	override async onOpen(): Promise<void> {
		this.modalEl.addClass("t2ap-profile-modal");
		this.titleEl.setText(this.isNew ? "New voice profile" : "Edit voice profile");
		this.contentEl.createEl("p", {
			cls: "t2ap-loading",
			text: "Loading voices…",
		});

		await this.loadVoices();
		this.render();
	}

	override onClose(): void {
		this.plugin.player.stop();
		this.contentEl.empty();
	}

	private async loadVoices(): Promise<void> {
		const provider = this.plugin.providers.get(this.draft.provider);
		if (!provider) {
			this.voices = [];
			this.loadError = `Unknown engine: ${this.draft.provider}.`;
			return;
		}
		try {
			this.voices = await provider.listVoices();
			this.loadError = this.voices.length === 0 ? "No voices available." : null;
		} catch (err) {
			this.voices = [];
			this.loadError = err instanceof Error ? err.message : String(err);
		}
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Shown in the profile picker.")
			.addText((text) =>
				text
					.setPlaceholder("French narrator")
					.setValue(this.draft.name)
					.onChange((value) => {
						this.draft.name = value;
					}),
			);

		// The description is a sentence or two, so it gets a full-width line of
		// its own rather than the narrow control column beside its label.
		const description = new Setting(contentEl)
			.setName("Description")
			.setDesc("A note to yourself about when to use this profile.")
			.addTextArea((area) => {
				area
					.setPlaceholder("Calm, slow narration for reading articles.")
					.setValue(this.draft.description)
					.onChange((value) => {
						this.draft.description = value;
					});
				area.inputEl.rows = 3;
				area.inputEl.addClass("t2ap-textarea");
			});
		description.settingEl.addClass("t2ap-setting-stacked");

		// Provider, voice and delivery are one decision — how this profile
		// sounds — so they share a heading. Provider leads because it determines
		// which voices exist.
		new Setting(contentEl).setName("Voice").setHeading();

		// Offer only providers that can run, so Azure never appears as a dead
		// option before a key is entered. The current provider of the profile is
		// always included. An edit to an Azure profile after the key was removed
		// then keeps that provider instead of a different one.
		const providers = this.plugin.providers
			.all()
			.filter((p) => p.isConfigured() || p.id === this.draft.provider);
		new Setting(contentEl)
			.setName("Provider")
			.setDesc(
				providers.length > 1
					? "Which speech engine produces the audio."
					: "Azure becomes available once a speech key and region are set.",
			)
			.addDropdown((dd) => {
				for (const provider of providers) {
					dd.addOption(provider.id, provider.displayName);
				}
				dd.setValue(this.draft.provider).onChange(async (value) => {
					this.draft.provider = value as VoiceProfile["provider"];
					this.draft.voiceId = "";
					this.draft.style = undefined;
					this.draft.role = undefined;
					await this.loadVoices();
					this.render();
				});
			});

		// Language, voice, style and role are rebuilt whenever the voice changes.
		// The delivery sliders below stay put because they live outside this div.
		this.dynamicEl = contentEl.createDiv();
		this.renderVoiceFields();

		new Setting(contentEl)
			.setName("Speed")
			.setDesc("1 is the voice's natural pace.")
			.addSlider((slider) =>
				slider
					.setLimits(0.5, 2, 0.05)
					.setValue(this.draft.rate)
					.setDynamicTooltip()
					.onChange((value) => {
						this.draft.rate = value;
					}),
			);

		new Setting(contentEl)
			.setName("Pitch")
			.setDesc("Percent shift from the voice's natural pitch.")
			.addSlider((slider) =>
				slider
					.setLimits(-50, 50, 1)
					.setValue(this.draft.pitch)
					.setDynamicTooltip()
					.onChange((value) => {
						this.draft.pitch = value;
					}),
			);

		new Setting(contentEl).setName("Volume").addSlider((slider) =>
			slider
				.setLimits(0, 100, 1)
				.setValue(this.draft.volume)
				.setDynamicTooltip()
				.onChange((value) => {
					this.draft.volume = value;
				}),
		);

		new Setting(contentEl).setName("Output").setHeading();

		// System voices speak directly and never produce a file, so format has
		// no meaning for them.
		if (this.draft.provider === "azure") {
			new Setting(contentEl)
				.setName("Audio format")
				.setDesc("Used when saving to a file.")
				.addDropdown((dd) =>
					dd
						.addOptions(audioFormatOptions())
						.setValue(this.draft.audioFormat ?? DEFAULT_AUDIO_FORMAT_ID)
						.onChange((value) => {
							this.draft.audioFormat = value;
						}),
				);
		} else {
			contentEl.createEl("p", {
				cls: "setting-item-description",
				text: "System voices play through the device and cannot be saved to a file.",
			});
		}

		const globalDefault = this.plugin.settings.output.defaultFolder || "vault root";
		let folderError: HTMLElement | null = null;
		new Setting(contentEl)
			.setName("Save folder")
			.setDesc(
				`Where this profile saves audio. Leave empty to use the global default (${globalDefault}).`,
			)
			.addText((text) => {
				text
					.setPlaceholder(this.plugin.settings.output.defaultFolder)
					.setValue(this.draft.outputFolder ?? "")
					.onChange((value) => {
						this.draft.outputFolder = value.trim() ? value : undefined;
						const message = validateFolderPath(value);
						if (folderError) folderError.setText(message ?? "");
						text.inputEl.toggleClass("t2ap-invalid", message !== null);
					});
				folderError =
					text.inputEl.parentElement?.createDiv({
						cls: "t2ap-field-error",
					}) ?? null;
			});

		new Setting(contentEl)
			.setName("Use for auto-detection")
			.setDesc("Allow this profile to be chosen automatically by detected language.")
			.addToggle((toggle) =>
				toggle.setValue(this.draft.useForAutoDetect).onChange((value) => {
					this.draft.useForAutoDetect = value;
				}),
			);

		// Pinned to the bottom of the modal by CSS, so Save stays reachable
		// without scrolling back down a long form.
		const actions = new Setting(contentEl)
			.addButton((btn) => {
				setButtonLabel(btn, "play", "Preview");
				btn.setTooltip("Hear a sample with these settings");
				btn.onClick(() => void this.preview());
			})
			.addButton((btn) => {
				setButtonLabel(btn, "rotate-ccw", "Undo");
				btn.setTooltip("Discard every change made since opening");
				btn.onClick(() => void this.undo());
			})
			.addButton((btn) => {
				setButtonLabel(btn, "x", "Cancel");
				btn.onClick(() => this.close());
			})
			.addButton((btn) => {
				setButtonLabel(btn, "check", this.isNew ? "Create" : "Save");
				btn.setCta();
				btn.onClick(() => void this.commit());
			});

		actions.settingEl.addClass("t2ap-modal-actions");
	}

	/**
	 * Restore the values the modal opened with, without closing it.
	 *
	 * Voices are reloaded because an undone provider change leaves the loaded
	 * catalog belonging to the wrong provider.
	 */
	private async undo(): Promise<void> {
		this.plugin.player.stop();
		this.draft = { ...this.original };
		await this.loadVoices();
		this.render();
		new Notice("Changes discarded.");
	}

	/** The parts that depend on which voice is selected. */
	private renderVoiceFields(): void {
		const container = this.dynamicEl;
		if (!container) return;
		container.empty();

		if (this.loadError) {
			container.createEl("p", { cls: "t2ap-field-error", text: this.loadError });
			return;
		}

		const locales = [...new Set(this.voices.map((v) => v.locale))].sort();
		const currentLocale = locales.includes(this.draft.locale)
			? this.draft.locale
			: (locales[0] ?? "");

		new Setting(container).setName("Language").addDropdown((dd) => {
			for (const locale of locales) {
				dd.addOption(locale, `${localeLabel(locale)} — ${locale}`);
			}
			dd.setValue(currentLocale).onChange((value) => {
				this.draft.locale = value;
				this.draft.voiceId = "";
				this.draft.style = undefined;
				this.draft.role = undefined;
				this.renderVoiceFields();
			});
		});

		const inLocale = this.voices.filter((v) => v.locale === currentLocale);
		const selectedVoice =
			inLocale.find((v) => v.id === this.draft.voiceId) ?? inLocale[0];
		this.draft.locale = currentLocale;
		this.draft.voiceId = selectedVoice?.id ?? "";

		new Setting(container).setName("Voice").addDropdown((dd) => {
			for (const voice of inLocale) {
				const gender = voice.gender ? ` (${voice.gender})` : "";
				dd.addOption(voice.id, `${voice.displayName}${gender}`);
			}
			dd.setValue(this.draft.voiceId).onChange((value) => {
				this.draft.voiceId = value;
				this.draft.style = undefined;
				this.draft.role = undefined;
				this.renderVoiceFields();
			});
		});

		// Style and role exist only for the voices that advertise them. Emitting
		// them for any other voice is what makes the original plugin fail on most
		// languages.
		if (selectedVoice && selectedVoice.styles.length > 0) {
			new Setting(container)
				.setName("Speaking style")
				.setDesc("Only offered for voices that support it.")
				.addDropdown((dd) => {
					dd.addOption("", "None");
					for (const style of selectedVoice.styles) {
						dd.addOption(style, humanize(style));
					}
					dd.setValue(this.draft.style ?? "").onChange((value) => {
						this.draft.style = value || undefined;
						this.renderVoiceFields();
					});
				});

			if (this.draft.style) {
				new Setting(container).setName("Style intensity").addSlider((slider) =>
					slider
						.setLimits(0.01, 2, 0.01)
						.setValue(this.draft.styleDegree ?? 1)
						.setDynamicTooltip()
						.onChange((value) => {
							this.draft.styleDegree = value;
						}),
				);
			}
		}

		if (selectedVoice && selectedVoice.roles.length > 0) {
			new Setting(container).setName("Speaking role").addDropdown((dd) => {
				dd.addOption("", "None");
				for (const role of selectedVoice.roles) {
					dd.addOption(role, humanize(role));
				}
				dd.setValue(this.draft.role ?? "").onChange((value) => {
					this.draft.role = value || undefined;
				});
			});
		}
	}

	private async preview(): Promise<void> {
		const sample =
			PREVIEW_TEXT[languageSubtag(this.draft.locale)] ?? DEFAULT_PREVIEW_TEXT;
		await this.plugin.speak(sample, this.draft);
	}

	private async commit(): Promise<void> {
		const name = this.draft.name.trim();
		if (!name) {
			new Notice("Give the profile a name.");
			return;
		}
		const folderError = validateFolderPath(this.draft.outputFolder ?? "");
		if (folderError) {
			new Notice(folderError);
			return;
		}
		if (!this.draft.voiceId) {
			new Notice("Choose a voice.");
			return;
		}

		this.draft.name = name;
		await this.onCommit(this.draft);
		this.close();
	}
}

function humanize(value: string): string {
	return value.replace(/[-_]/g, " ");
}

/** Best-effort human name for a locale, using the platform's own data. */
function localeLabel(locale: string): string {
	try {
		return new Intl.DisplayNames(undefined, { type: "language" }).of(locale) ?? locale;
	} catch {
		return locale;
	}
}
