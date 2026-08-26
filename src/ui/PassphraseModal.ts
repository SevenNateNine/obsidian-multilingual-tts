import { App, Modal, Setting, type ButtonComponent } from "obsidian";

export interface PassphraseModalOptions {
	mode: "unlock" | "create";
	/** The provider being unlocked, named so several are told apart. */
	subject: string;
	/**
	 * Check the passphrase. Return an error to show in the dialog, or null to
	 * accept it and close. Verification lives with the caller, so a wrong
	 * passphrase can be retried without opening the dialog again.
	 */
	onSubmit: (passphrase: string) => Promise<string | null>;
	onCancel?: () => void;
}

/**
 * Asks for the passphrase that protects one provider's credentials.
 *
 * `unlock` reads existing credentials. `create` sets a new passphrase and asks
 * for it twice, because a typo in a write-only field is unrecoverable.
 */
export class PassphraseModal extends Modal {
	private readonly options: PassphraseModalOptions;

	private passphrase = "";
	private confirmation = "";
	private busy = false;
	private accepted = false;

	private errorEl: HTMLElement | null = null;
	private submitButton: ButtonComponent | null = null;

	constructor(app: App, options: PassphraseModalOptions) {
		super(app);
		this.options = options;
	}

	override onOpen(): void {
		const creating = this.options.mode === "create";
		this.titleEl.setText(
			creating ? "Set a passphrase" : `Unlock ${this.options.subject}`,
		);
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
		// Clear the passphrase from memory as soon as the dialog is finished.
		this.passphrase = "";
		this.confirmation = "";
		if (!this.accepted) this.options.onCancel?.();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("p", {
			cls: "setting-item-description",
			text:
				this.options.mode === "create"
					? `The credentials of ${this.options.subject} are encrypted with this ` +
						"passphrase. Nobody can recover them if you forget it, and you must " +
						"paste them again."
					: `The stored credentials of ${this.options.subject} are encrypted. ` +
						"Enter the passphrase to use it in this session.",
		});

		this.addField(contentEl, "Passphrase", (value) => {
			this.passphrase = value;
		});

		if (this.options.mode === "create") {
			this.addField(contentEl, "Confirm passphrase", (value) => {
				this.confirmation = value;
			});
		}

		this.errorEl = contentEl.createDiv({ cls: "t2ap-field-error" });
		this.renderActions(contentEl);
	}

	private addField(
		container: HTMLElement,
		name: string,
		onChange: (value: string) => void,
	): void {
		new Setting(container).setName(name).addText((text) => {
			text.inputEl.type = "password";
			text.inputEl.autocomplete = "off";
			text.onChange((value) => {
				onChange(value);
				this.showError("");
			});
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") void this.submit();
			});
		});
	}

	private renderActions(container: HTMLElement): void {
		new Setting(container)
			.addButton((btn) => {
				btn
					.setButtonText(this.options.mode === "create" ? "Encrypt key" : "Unlock")
					.setCta()
					.onClick(() => void this.submit());
				this.submitButton = btn;
			})
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
	}

	private async submit(): Promise<void> {
		if (this.busy) return;

		if (this.passphrase === "") {
			this.showError("Enter a passphrase.");
			return;
		}
		if (this.options.mode === "create" && this.passphrase !== this.confirmation) {
			this.showError("The two passphrases do not match.");
			return;
		}

		this.setBusy(true);
		try {
			const error = await this.options.onSubmit(this.passphrase);
			if (error) {
				this.showError(error);
				return;
			}
			this.accepted = true;
			this.close();
		} finally {
			this.setBusy(false);
		}
	}

	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.submitButton?.setDisabled(busy);
	}

	private showError(message: string): void {
		this.errorEl?.setText(message);
	}
}
