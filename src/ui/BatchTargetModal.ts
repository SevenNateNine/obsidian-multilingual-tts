import { App, Modal, Setting } from "obsidian";
import type MultilingualTtsPlugin from "../main";
import { hashFieldFor, type AudioTarget } from "../core/batch/types";
import { setButtonLabel } from "../adapters/obsidian/buttonLabel";
import { addHelpIcon } from "../adapters/obsidian/helpIcon";
import { addDropdownTooltip } from "../adapters/obsidian/dropdown";

const PREFIX_HELP =
	"Written in front of the file name exactly as you type it, so " +
	'"KR-" gives KR-annyeong.mp3. Each target of a preset needs its own, or ' +
	"two clips of one card land on the same name.";

const NAME_FROM_HELP =
	"Name every clip after one property of the card. Leave it empty to use the " +
	"file name template from Settings, which is what a save from the editor uses.";

const HASH_HELP =
	"Where this target records what it last spoke, so an edited card is spoken " +
	"again on the next run. Leave it empty to use the link property with _hash " +
	"after it. It is only read while the preset detects changes.";

/**
 * Create or edit one target of a preset.
 *
 * Works on a copy and commits on Save, so Cancel discards the edit. Nothing is
 * validated here: every problem worth reporting is one between two targets, so
 * the preset editor checks the whole list instead.
 */
export class BatchTargetModal extends Modal {
	private readonly draft: AudioTarget;
	private hashSetting: Setting | null = null;

	constructor(
		app: App,
		private readonly plugin: MultilingualTtsPlugin,
		target: AudioTarget,
		private readonly isNew: boolean,
		private readonly onCommit: (target: AudioTarget) => void,
	) {
		super(app);
		this.draft = { ...target };
	}

	override onOpen(): void {
		this.modalEl.addClass("t2ap-modal");
		this.titleEl.setText(this.isNew ? "Add target" : "Edit target");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"One property to speak, and one to write the link to. A card can have " +
				"several targets, so a single pass makes every language at once.",
		});

		this.renderProperties(contentEl);
		this.renderVoice(contentEl);
		this.renderNaming(contentEl);
		this.renderActions(contentEl);
	}

	private renderProperties(container: HTMLElement): void {
		new Setting(container)
			.setName("Property to speak")
			.setDesc("The words on the card, for example korean.")
			.addText((text) =>
				text
					.setPlaceholder("korean")
					.setValue(this.draft.textField)
					.onChange((value) => {
						this.draft.textField = value;
					}),
			);

		new Setting(container)
			.setName("Property for the link")
			.setDesc("Receives a wikilink to the clip, for example korean_audio.")
			.addText((text) =>
				text
					.setPlaceholder("korean_audio")
					.setValue(this.draft.audioField)
					.onChange((value) => {
						this.draft.audioField = value;
						this.refreshHashPlaceholder();
					}),
			);
	}

	private renderVoice(container: HTMLElement): void {
		new Setting(container)
			.setName("Voice profile")
			.setDesc("Which voice speaks this property. Every target names its own.")
			.addDropdown((dd) => {
				dd.addOption("", "Default profile");
				for (const profile of this.plugin.settings.profiles) {
					dd.addOption(profile.id, profile.name);
				}
				dd.setValue(this.draft.profileId ?? "").onChange((value) => {
					this.draft.profileId = value || undefined;
				});
				addDropdownTooltip(dd);
			});
	}

	private renderNaming(container: HTMLElement): void {
		new Setting(container).setName("File name").setHeading();

		const prefix = new Setting(container)
			.setName("Prefix")
			.setDesc("Keeps two targets of one card apart.")
			.addText((text) =>
				text
					.setPlaceholder("KR-")
					.setValue(this.draft.prefix)
					.onChange((value) => {
						this.draft.prefix = value;
					}),
			);
		addHelpIcon(prefix, PREFIX_HELP);

		const nameFrom = new Setting(container)
			.setName("Name after property")
			.setDesc("Optional. Overrides the file name template for this target.")
			.addText((text) =>
				text
					.setPlaceholder("leave empty for the template")
					.setValue(this.draft.nameFrom ?? "")
					.onChange((value) => {
						this.draft.nameFrom = value.trim() || undefined;
					}),
			);
		addHelpIcon(nameFrom, NAME_FROM_HELP);

		this.hashSetting = new Setting(container)
			.setName("Change hash property")
			.setDesc("Optional. Where the last spoken words are recorded.")
			.addText((text) =>
				text
					.setPlaceholder(this.defaultHashField())
					.setValue(this.draft.hashField ?? "")
					.onChange((value) => {
						this.draft.hashField = value.trim() || undefined;
					}),
			);
		addHelpIcon(this.hashSetting, HASH_HELP);
	}

	/** What a blank field resolves to, so the card stays predictable. */
	private defaultHashField(): string {
		return this.draft.audioField.trim()
			? hashFieldFor({ ...this.draft, hashField: undefined })
			: "korean_audio_hash";
	}

	private refreshHashPlaceholder(): void {
		const input = this.hashSetting?.controlEl.querySelector("input");
		input?.setAttribute("placeholder", this.defaultHashField());
	}

	private renderActions(container: HTMLElement): void {
		const actions = new Setting(container)
			.addButton((btn) => {
				setButtonLabel(btn, "x", "Cancel");
				btn.onClick(() => this.close());
			})
			.addButton((btn) => {
				setButtonLabel(btn, "check", this.isNew ? "Add" : "Save");
				btn.setCta();
				btn.onClick(() => {
					this.onCommit({ ...this.draft });
					this.close();
				});
			});

		actions.settingEl.addClass("t2ap-modal-actions");
	}
}
