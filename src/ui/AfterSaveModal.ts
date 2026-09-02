import { App, Modal, Setting, type ButtonComponent } from "obsidian";
import type {
	AfterSaveSettings,
	ExistingValueAction,
} from "../core/settings/afterSave";
import type { AfterSaveChoice } from "../core/usecases/afterSave";
import { hasPropertyValue, propertyText } from "../core/text/propertyLink";
import { addDropdownTooltip } from "../adapters/obsidian/dropdown";

/** The dropdown value that reveals the free text field. */
const NEW_PROPERTY = "__new__";

type LinkTarget = AfterSaveChoice["target"];

export interface AfterSaveModalOptions {
	/** Vault path of the clip, shown so the reader knows what is being linked. */
	savedPath: string;
	offerSelection: boolean;
	offerProperty: boolean;
	/** Property names to list, most likely first. */
	candidates: readonly string[];
	/** Preselects the target, the property, and the answer to the question. */
	initial: AfterSaveSettings;
	/** What a property holds in the note now. Undefined when it is absent. */
	currentValue: (property: string) => unknown;
	/** `existingAsked` is true when the Replace or Append question was shown. */
	onSubmit: (choice: AfterSaveChoice, always: boolean, existingAsked: boolean) => void;
	onSkip: (always: boolean) => void;
}

/**
 * Asks where the link to a saved clip goes: over the words that were read, or
 * into a property of the note.
 *
 * Closing the dialog is a Skip, not an error: the audio is already on disk and
 * a link can still be made by hand.
 */
export class AfterSaveModal extends Modal {
	private readonly options: AfterSaveModalOptions;

	private target: LinkTarget;
	/** A candidate, or `NEW_PROPERTY` while the text field is in use. */
	private property: string;
	private newName = "";
	private existingValue: ExistingValueAction = "replace";
	private always = false;
	private accepted = false;

	private existingEl: HTMLElement | null = null;
	private linkButton: ButtonComponent | null = null;

	constructor(app: App, options: AfterSaveModalOptions) {
		super(app);
		this.options = options;

		const { initial, offerSelection, offerProperty, candidates } = options;
		const wantsSelection = initial.mode === "selection" || !offerProperty;
		this.target = offerSelection && wantsSelection ? "selection" : "property";

		const preferred = initial.property.trim();
		this.property =
			preferred && candidates.includes(preferred)
				? preferred
				: (candidates[0] ?? NEW_PROPERTY);

		if (initial.existingValue !== "ask") this.existingValue = initial.existingValue;
	}

	override onOpen(): void {
		this.modalEl.addClass("t2ap-modal");
		this.titleEl.setText("Link the saved audio");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.accepted) this.options.onSkip(this.always);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: `Saved ${this.options.savedPath}.`,
		});

		this.renderTarget(contentEl);
		if (this.target === "property") {
			this.renderProperty(contentEl);
			this.existingEl = contentEl.createDiv();
			this.renderExisting();
		}
		this.renderAlways(contentEl);
		this.renderActions(contentEl);
	}

	private renderTarget(container: HTMLElement): void {
		new Setting(container).setName("Link to").addDropdown((dd) => {
			if (this.options.offerSelection) dd.addOption("selection", "Highlighted text");
			if (this.options.offerProperty) dd.addOption("property", "Note property");
			dd.setValue(this.target).onChange((value) => {
				this.target = value as LinkTarget;
				this.render();
			});
			addDropdownTooltip(dd);
		});
	}

	private renderProperty(container: HTMLElement): void {
		new Setting(container).setName("Property").addDropdown((dd) => {
			for (const name of this.options.candidates) dd.addOption(name, name);
			dd.addOption(NEW_PROPERTY, "New property…");
			dd.setValue(this.property).onChange((value) => {
				this.property = value;
				this.render();
			});
			addDropdownTooltip(dd);
		});

		if (this.property !== NEW_PROPERTY) return;

		new Setting(container).setName("Property name").addText((text) => {
			text
				.setPlaceholder("audio")
				.setValue(this.newName)
				.onChange((value) => {
					this.newName = value;
					this.renderExisting();
					this.refreshLinkButton();
				});
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") this.submit();
			});
		});
	}

	/**
	 * The current value of the chosen property, and the question about it.
	 *
	 * In its own container, because the name can change with every keystroke
	 * of the text field and the rest of the form must not lose focus.
	 */
	private renderExisting(): void {
		const container = this.existingEl;
		if (!container) return;
		container.empty();

		const existing = this.existingValueNow();
		if (!hasPropertyValue(existing)) return;

		const shown = propertyText(existing) || "a value this dialog cannot show";

		if (this.options.initial.existingValue === "ask") {
			new Setting(container)
				.setName("Existing value")
				.setDesc(`Current value: ${shown}`)
				.addDropdown((dd) => {
					dd.addOption("replace", "Replace it");
					dd.addOption("append", "Add the link as a list item");
					dd.setValue(this.existingValue).onChange((value) => {
						this.existingValue = value as ExistingValueAction;
					});
				});
			return;
		}

		const outcome =
			this.existingValue === "replace"
				? "It will be replaced."
				: "The link will be added to it.";
		container.createEl("p", {
			cls: "setting-item-description t2ap-current-value",
			text: `Current value: ${shown}. ${outcome}`,
		});
	}

	private renderAlways(container: HTMLElement): void {
		new Setting(container)
			.setName("Always do this")
			.setDesc(
				"Skip this dialog next time. Change it under Settings → General → Output.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.always).onChange((value) => {
					this.always = value;
				}),
			);
	}

	private renderActions(container: HTMLElement): void {
		const actions = new Setting(container)
			.addButton((btn) => {
				this.linkButton = btn;
				btn
					.setButtonText("Link")
					.setCta()
					.onClick(() => this.submit());
			})
			.addButton((btn) => btn.setButtonText("Skip").onClick(() => this.close()));
		actions.settingEl.addClass("t2ap-modal-actions");
		this.refreshLinkButton();
	}

	private refreshLinkButton(): void {
		this.linkButton?.setDisabled(
			this.target === "property" && this.chosenName() === "",
		);
	}

	private chosenName(): string {
		return this.property === NEW_PROPERTY ? this.newName.trim() : this.property;
	}

	private existingValueNow(): unknown {
		const name = this.chosenName();
		return name ? this.options.currentValue(name) : undefined;
	}

	private submit(): void {
		const choice = this.choice();
		if (!choice) return;

		const existingAsked =
			choice.target === "property" &&
			this.options.initial.existingValue === "ask" &&
			hasPropertyValue(this.existingValueNow());

		this.accepted = true;
		this.options.onSubmit(choice, this.always, existingAsked);
		this.close();
	}

	/** Null while the form is not complete. */
	private choice(): AfterSaveChoice | null {
		if (this.target === "selection") return { target: "selection" };

		const property = this.chosenName();
		if (!property) return null;
		return { target: "property", property, existingValue: this.existingValue };
	}
}
