import { App, Modal, Notice, Setting } from "obsidian";
import type MultilingualTtsPlugin from "../main";
import type { VoiceProfile } from "../core/settings/types";
import { resolveOutputFolder } from "../core/paths";

export interface ConvertModalOptions {
	plugin: MultilingualTtsPlugin;
	initialText: string;
	profile: VoiceProfile;
	/** Asked again per profile and per edit, because both change the name. */
	defaultBasename: (profile: VoiceProfile, text: string) => string;
	/** Called with the vault path of the clip, once it is on disk. */
	onSaved: (path: string) => void;
}

/**
 * The full conversion dialog: edit the text, choose a profile, name the file,
 * then play or save.
 *
 * Takes an options object, not a positional list. Two of the fields were both
 * plain strings, so a call site that exchanged them still compiled, and then
 * every file got the note text as its name.
 */
export class ConvertModal extends Modal {
	private readonly plugin: MultilingualTtsPlugin;
	private readonly defaultBasename: (profile: VoiceProfile, text: string) => string;
	private readonly onSaved: (path: string) => void;

	private text: string;
	private profile: VoiceProfile;
	private filename = "";
	private busy = false;

	private statusEl: HTMLElement | null = null;
	private actionsEl: HTMLElement | null = null;

	constructor(app: App, options: ConvertModalOptions) {
		super(app);
		this.plugin = options.plugin;
		this.defaultBasename = options.defaultBasename;
		this.onSaved = options.onSaved;
		this.text = options.initialText;
		this.profile = options.profile;
	}

	override onOpen(): void {
		this.titleEl.setText("Convert text to audio");
		this.render();
	}

	override onClose(): void {
		this.plugin.player.stop();
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const area = contentEl.createEl("textarea", {
			cls: "t2ap-convert-text",
			attr: { rows: "10", placeholder: "Text to convert…" },
		});
		area.value = this.text;
		area.addEventListener("input", () => {
			this.text = area.value;
			this.refreshActions();
		});

		new Setting(contentEl).setName("Profile").addDropdown((dd) => {
			for (const profile of this.plugin.settings.profiles) {
				dd.addOption(profile.id, profile.name);
			}
			dd.setValue(this.profile.id).onChange((value) => {
				const found = this.plugin.settings.profiles.find((p) => p.id === value);
				if (found) this.profile = found;
				this.render();
			});
		});

		if (this.profile.description) {
			contentEl.createEl("p", {
				cls: "setting-item-description",
				text: this.profile.description,
			});
		}

		const provider = this.plugin.providers.get(this.profile.providerId);
		const savable = provider?.kind === "rendering";

		if (savable) {
			const folder = resolveOutputFolder(this.profile, this.plugin.settings);
			new Setting(contentEl)
				.setName("File name")
				.setDesc(`Saved to ${folder || "the vault root"}.`)
				.addText((text) =>
					text
						.setPlaceholder(this.defaultBasename(this.profile, this.text))
						.setValue(this.filename)
						.onChange((value) => {
							this.filename = value;
						}),
				);
		} else {
			contentEl.createEl("p", {
				cls: "setting-item-description",
				text: provider
					? `${provider.displayName} plays through the device and cannot save to a file.`
					: "This profile's speech provider no longer exists. Pick another in settings.",
			});
		}

		this.statusEl = contentEl.createDiv({ cls: "t2ap-convert-status" });
		this.actionsEl = contentEl.createDiv();
		this.refreshActions();
	}

	private refreshActions(): void {
		const container = this.actionsEl;
		if (!container) return;
		container.empty();

		const provider = this.plugin.providers.get(this.profile.providerId);
		const savable = provider?.kind === "rendering";
		const hasText = this.text.trim().length > 0;

		const actions = new Setting(container);

		if (this.busy) {
			actions.addButton((btn) =>
				btn
					.setButtonText("Stop")
					.setWarning()
					.onClick(() => {
						this.plugin.player.stop();
						this.plugin.cancelRender();
					}),
			);
			return;
		}

		actions.addButton((btn) =>
			btn
				.setButtonText("Play")
				.setDisabled(!hasText)
				.onClick(() => void this.run("play")),
		);

		if (savable) {
			actions.addButton((btn) =>
				btn
					.setButtonText("Save")
					.setCta()
					.setDisabled(!hasText)
					.onClick(() => void this.run("save")),
			);
		}
	}

	private async run(mode: "play" | "save"): Promise<void> {
		this.busy = true;
		this.setStatus(mode === "play" ? "Preparing…" : "Converting…");
		this.refreshActions();

		try {
			if (mode === "play") {
				await this.plugin.speak(this.text, this.profile);
				this.setStatus("");
			} else {
				const outcome = await this.plugin.saveAudio(
					this.text,
					this.profile,
					this.filename.trim() || this.defaultBasename(this.profile, this.text),
					(progress) =>
						this.setStatus(
							progress.total > 1
								? `Converting part ${progress.done} of ${progress.total}…`
								: "Converting…",
						),
				);
				if (outcome.ok) {
					this.announceSaved(outcome.path);
					this.close();
					return;
				}
				// The plugin has already shown the reason, apart from a
				// cancellation, which needs no message at all.
				this.setStatus("");
			}
		} finally {
			this.busy = false;
			this.refreshActions();
		}
	}

	private announceSaved(path: string): void {
		new Notice(`Saved ${path}`);
		this.onSaved(path);
	}

	private setStatus(message: string): void {
		this.statusEl?.setText(message);
	}
}
