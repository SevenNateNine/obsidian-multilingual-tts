import { App, Modal, Notice, Setting } from "obsidian";
import type MultilingualTtsPlugin from "../main";
import type { VoiceProfile } from "../core/settings/types";
import type { VoiceInfo } from "../core/tts/types";
import { languageSubtag } from "../core/text/languages";
import { validateFolderPath } from "../core/paths";
import { nameTemplateError, BUILTIN_NAME_TEMPLATE } from "../core/text/nameTemplate";
import { nameTemplateHelp } from "./nameTemplateHelp";
import { setButtonLabel } from "../adapters/obsidian/buttonLabel";
import { addHelpIcon } from "../adapters/obsidian/helpIcon";
import { addDropdownTooltip, setCompactLabels } from "../adapters/obsidian/dropdown";
import { addNumberSlider } from "../adapters/obsidian/numberSlider";

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

const AUTO_DETECT_HELP =
	"Auto-detection reads the selected text, finds its language, and picks a " +
	"profile for that language. This profile joins that set. Detection needs " +
	"profiles in two or more languages. A short selection uses the default profile.";

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
		this.modalEl.addClass("t2ap-modal", "t2ap-profile-modal");
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
		const provider = this.plugin.providers.get(this.draft.providerId);
		if (!provider) {
			this.voices = [];
			this.loadError = "This profile's provider no longer exists. Choose another.";
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

		// One group for each decision. A rule between two groups replaces the
		// rule that Obsidian draws above every row.
		const basics = contentEl.createDiv({ cls: "t2ap-group" });
		const voiceGroup = contentEl.createDiv({ cls: "t2ap-group" });
		const delivery = contentEl.createDiv({ cls: "t2ap-group" });
		const output = contentEl.createDiv({ cls: "t2ap-group" });

		new Setting(basics)
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
		const description = new Setting(basics)
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

		// Provider, language and voice are one decision: which voice speaks.
		// Provider leads because it determines which voices exist.
		new Setting(voiceGroup).setName("Voice").setHeading();

		// Offer only providers that can run, so one missing its credentials never
		// appears as a dead option. The profile's own provider is always included:
		// an edit made after its key was removed keeps that provider instead of
		// silently moving the profile to a different one.
		const instances = this.plugin.settings.providers.filter(
			(p) =>
				this.plugin.providers.get(p.id)?.isConfigured() ||
				p.id === this.draft.providerId,
		);
		const missing = !instances.some((p) => p.id === this.draft.providerId);

		new Setting(voiceGroup)
			.setName("Provider")
			.setDesc(
				instances.length > 1
					? "Which speech engine produces the audio."
					: "Add a provider under Settings → Providers to use another engine.",
			)
			.addDropdown((dd) => {
				// A deleted provider still has to appear, or the dropdown would show
				// a different engine than the profile actually stores.
				if (missing) dd.addOption(this.draft.providerId, "(provider missing)");
				for (const instance of instances) dd.addOption(instance.id, instance.name);

				dd.setValue(this.draft.providerId).onChange(async (value) => {
					this.draft.providerId = value;
					this.draft.voiceId = "";
					this.draft.style = undefined;
					this.draft.role = undefined;
					await this.loadVoices();
					this.render();
				});

				addDropdownTooltip(dd);
			});

		// Language, voice, style and role are built again whenever the voice
		// changes. The delivery sliders keep their values because they are in
		// another group.
		this.dynamicEl = voiceGroup.createDiv();
		this.renderVoiceFields();

		addNumberSlider(
			new Setting(delivery).setName("Speed").setDesc("1 is the voice's natural pace."),
			{
				min: 0.5,
				max: 2,
				step: 0.05,
				value: this.draft.rate,
				onChange: (value) => {
					this.draft.rate = value;
				},
			},
		);

		addNumberSlider(
			new Setting(delivery)
				.setName("Pitch")
				.setDesc("Percent shift from the voice's natural pitch."),
			{
				min: -50,
				max: 50,
				step: 1,
				value: this.draft.pitch,
				onChange: (value) => {
					this.draft.pitch = value;
				},
			},
		);

		addNumberSlider(new Setting(delivery).setName("Volume"), {
			min: 0,
			max: 100,
			step: 1,
			value: this.draft.volume,
			onChange: (value) => {
				this.draft.volume = value;
			},
		});

		new Setting(output).setName("Output").setHeading();

		// A speaking provider goes straight to the device and never produces a
		// file, so a format has no meaning for it. Which formats exist is the
		// provider's own answer, so no engine is named here.
		const provider = this.plugin.providers.get(this.draft.providerId);
		if (provider?.kind === "rendering") {
			this.renderAudioFormat(output, provider.audioFormatOptions());
		} else {
			output.createEl("p", {
				cls: "setting-item-description",
				text: provider
					? `${provider.displayName} plays through the device and cannot be saved to a file.`
					: "This profile has no working provider, so it cannot be saved to a file.",
			});
		}

		const globalDefault = this.plugin.settings.output.defaultFolder || "vault root";
		let folderError: HTMLElement | null = null;
		new Setting(output)
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

		const globalTemplate =
			this.plugin.settings.output.nameTemplate.trim() || BUILTIN_NAME_TEMPLATE;
		let templateError: HTMLElement | null = null;
		new Setting(output)
			.setName("File name template")
			.setDesc(
				nameTemplateHelp(
					`How this profile names its files. Leave it empty to use the global one (${globalTemplate}), ` +
						"or write {{default}}_drill to extend that instead of replacing it.",
				),
			)
			.addText((text) => {
				text
					.setPlaceholder(globalTemplate)
					.setValue(this.draft.nameTemplate ?? "")
					.onChange((value) => {
						this.draft.nameTemplate = value.trim() ? value : undefined;
						const message = nameTemplateError(value);
						if (templateError) templateError.setText(message ?? "");
					});
				templateError =
					text.inputEl.parentElement?.createDiv({
						cls: "t2ap-field-error",
					}) ?? null;
			});

		const autoDetect = new Setting(output)
			.setName("Use for auto-detection")
			.setDesc("Allow this profile to be chosen automatically by detected language.")
			.addToggle((toggle) =>
				toggle.setValue(this.draft.useForAutoDetect).onChange((value) => {
					this.draft.useForAutoDetect = value;
				}),
			);

		addHelpIcon(autoDetect, AUTO_DETECT_HELP);

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
	 * The empty value means inherit, the same as an empty save folder. A stored
	 * format the provider no longer offers falls back to it.
	 */
	private renderAudioFormat(
		container: HTMLElement,
		options: Record<string, string>,
	): void {
		const global = this.plugin.settings.output.defaultFormat;
		const globalLabel = options[global] ?? "the provider default";
		const current =
			this.draft.audioFormat && this.draft.audioFormat in options
				? this.draft.audioFormat
				: "";

		new Setting(container)
			.setName("Audio format")
			.setDesc("Used when saving to a file.")
			.addDropdown((dd) => {
				dd.addOption("", `Global default (${globalLabel})`);
				dd.addOptions(options)
					.setValue(current)
					.onChange((value) => {
						this.draft.audioFormat = value || undefined;
					});

				addDropdownTooltip(dd);
			});
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

			// The code alone is enough to read the closed control.
			setCompactLabels(dd, (locale) => locale);
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

			addDropdownTooltip(dd);
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

					addDropdownTooltip(dd);
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

				addDropdownTooltip(dd);
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
