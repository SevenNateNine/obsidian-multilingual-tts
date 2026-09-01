import { App, Modal, Setting } from "obsidian";

export interface PropertyPromptOptions {
	/** Property names the note does not supply, in the order the template asks. */
	names: readonly string[];
	/** The name each empty field falls back to, shown so the choice is informed. */
	fallback: string;
	/** Only the fields that were filled in. An empty one keeps the fallback. */
	onSubmit: (values: Record<string, string>) => void;
	onCancel: () => void;
}

/**
 * Asks for the note properties a file name template wants and the note lacks.
 *
 * Opened only when the user turns the option on. Without it a missing property
 * quietly takes the name of the note, which is the right default but hides the
 * gap from somebody who meant to fill it.
 */
export class PropertyPromptModal extends Modal {
	private readonly options: PropertyPromptOptions;
	private readonly values: Record<string, string> = {};
	private accepted = false;

	constructor(app: App, options: PropertyPromptOptions) {
		super(app);
		this.options = options;
	}

	override onOpen(): void {
		this.titleEl.setText(
			this.options.names.length === 1 ? "Name this audio" : "Name this audio file",
		);
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
		// Closing with the title bar or Escape is a cancellation, not an empty
		// answer, because the audio has not been rendered yet.
		if (!this.accepted) this.options.onCancel();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("p", {
			cls: "setting-item-description",
			text:
				this.options.names.length === 1
					? "This note has no such property. Give it a value for the file name, " +
						"or leave it empty."
					: "This note has none of these properties. Give them values for the " +
						"file name, or leave them empty.",
		});

		for (const name of this.options.names) this.addField(contentEl, name);
		this.renderActions(contentEl);
	}

	private addField(container: HTMLElement, name: string): void {
		new Setting(container)
			.setName(name)
			.setDesc(`Empty uses "${this.options.fallback}".`)
			.addText((text) => {
				text.setPlaceholder(this.options.fallback).onChange((value) => {
					this.values[name] = value;
				});
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter") this.submit();
				});
			});
	}

	private renderActions(container: HTMLElement): void {
		new Setting(container)
			.addButton((btn) =>
				btn
					.setButtonText("Save audio")
					.setCta()
					.onClick(() => this.submit()),
			)
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
	}

	private submit(): void {
		this.accepted = true;
		this.options.onSubmit({ ...this.values });
		this.close();
	}
}
