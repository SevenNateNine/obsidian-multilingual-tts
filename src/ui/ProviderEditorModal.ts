import { App, Modal, Notice, Setting } from "obsidian";
import type MultilingualTtsPlugin from "../main";
import {
	configValue,
	findProviderInstance,
	type ProviderInstance,
} from "../core/settings/types";
import {
	providerTypeInfo,
	secretFields,
	type ProviderField,
} from "../core/tts/providerTypes";
import { KEY_STORAGE_MODES, type KeyStorage } from "../core/settings/secret";
import { PassphraseModal } from "./PassphraseModal";
import { setButtonLabel } from "../adapters/obsidian/buttonLabel";

const KEY_STORAGE_LABELS: Record<KeyStorage, string> = {
	plain: "Plain text",
	obfuscated: "Obfuscated",
	passphrase: "Encrypted with a passphrase",
};

const KEY_STORAGE_DESCRIPTIONS: Record<KeyStorage, string> = {
	plain: "Anything that opens data.json can read the credentials.",
	obfuscated:
		"Encoded, not encrypted. It stops a casual read, a screenshot and a " +
		"pasted bug report. It does not stop anybody who wants the credentials.",
	passphrase:
		"AES-GCM, with the passphrase stretched by PBKDF2. You enter it once " +
		"per session, for this provider only.",
};

function copyInstance(instance: ProviderInstance): ProviderInstance {
	return { ...instance, config: { ...instance.config } };
}

/**
 * Create or edit one provider.
 *
 * Works on a copy and commits only on Save, so Cancel discards a credential
 * that was typed by mistake rather than writing it on every keystroke.
 *
 * The fields come from the type's own description in `tts/providerTypes.ts`, so
 * this dialog never names an engine and a new one needs no edit here.
 */
export class ProviderEditorModal extends Modal {
	private readonly draft: ProviderInstance;

	constructor(
		app: App,
		private readonly plugin: MultilingualTtsPlugin,
		instance: ProviderInstance,
		private readonly isNew: boolean,
		private readonly onCommit: (
			instance: ProviderInstance,
			passphrase: string | null,
		) => Promise<void>,
	) {
		super(app);
		this.draft = copyInstance(instance);
	}

	override onOpen(): void {
		this.modalEl.addClass("t2ap-modal", "t2ap-provider-modal");
		const info = providerTypeInfo(this.draft.type);
		this.titleEl.setText(this.isNew ? `Add ${info.displayName}` : "Edit provider");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const info = providerTypeInfo(this.draft.type);
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: info.description,
		});

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Shown in the provider list and in each profile's engine picker.")
			.addText((text) =>
				text
					.setPlaceholder(info.displayName)
					.setValue(this.draft.name)
					.onChange((value) => {
						this.draft.name = value;
					}),
			);

		if (info.fields.length > 0) this.renderCredentials(contentEl, info.fields);

		// Pinned to the bottom of the scrolling modal body, as in the profile
		// editor, so Save stays reachable from anywhere in the form.
		const actions = new Setting(contentEl)
			.addButton((btn) => {
				setButtonLabel(btn, "x", "Cancel");
				btn.onClick(() => this.close());
			})
			.addButton((btn) => {
				setButtonLabel(btn, "check", this.isNew ? "Add" : "Save");
				btn.setCta();
				btn.onClick(() => void this.commit());
			});

		actions.settingEl.addClass("t2ap-modal-actions");
	}

	private renderCredentials(
		container: HTMLElement,
		fields: readonly ProviderField[],
	): void {
		new Setting(container).setName("Credentials").setHeading();

		// A locked provider cannot show or change anything, and offering the
		// storage mode would let the user re-encode from a value nobody has read.
		if (this.plugin.isProviderLocked(this.draft.id)) {
			this.renderUnlock(container);
			return;
		}

		for (const field of fields) this.renderField(container, field);
		this.renderKeyStorage(container);
	}

	private renderUnlock(container: HTMLElement): void {
		new Setting(container)
			.setName("Encrypted")
			.setDesc("Unlock this provider to see or change its credentials.")
			.addButton((btn) =>
				btn
					.setButtonText("Unlock")
					.setCta()
					.onClick(async () => {
						if (!(await this.plugin.unlockProvider(this.draft.id))) return;
						this.adoptUnlockedSecrets();
						this.render();
					}),
			);
	}

	/** Take the plain text the unlock put back into the live instance. */
	private adoptUnlockedSecrets(): void {
		const live = findProviderInstance(this.plugin.settings, this.draft.id);
		if (!live) return;

		for (const field of secretFields(this.draft.type)) {
			this.draft.config[field.key] = configValue(live.config, field.key);
		}
	}

	private renderField(container: HTMLElement, field: ProviderField): void {
		new Setting(container)
			.setName(field.label)
			.setDesc(field.description)
			.addText((text) => {
				text
					.setPlaceholder(field.placeholder)
					.setValue(configValue(this.draft.config, field.key))
					.onChange((value) => {
						this.draft.config[field.key] = value.trim();
					});
				if (!field.secret) return;
				text.inputEl.type = "password";
				text.inputEl.autocomplete = "off";
			});
	}

	/**
	 * How the credentials are written to data.json.
	 *
	 * The wording says plainly what each level does and does not do. Obfuscation
	 * is not encryption, and a user who believes it is can make a bad decision.
	 */
	private renderKeyStorage(container: HTMLElement): void {
		new Setting(container)
			.setName("Key storage")
			.setDesc(KEY_STORAGE_DESCRIPTIONS[this.draft.keyStorage])
			.addDropdown((dd) => {
				for (const mode of KEY_STORAGE_MODES) {
					dd.addOption(mode, KEY_STORAGE_LABELS[mode]);
				}
				dd.setValue(this.draft.keyStorage).onChange((value) => {
					this.draft.keyStorage = value as KeyStorage;
					this.render();
				});
			});

		if (this.draft.keyStorage !== "plain") return;

		container.createDiv({
			cls: "t2ap-key-warning",
			text:
				"The credentials are stored as plain text in this plugin's data.json. " +
				"If you sync your vault, they sync with it.",
		});
	}

	private async commit(): Promise<void> {
		const name = this.draft.name.trim();
		if (!name) {
			new Notice("Give the provider a name.");
			return;
		}
		this.draft.name = name;

		if (!this.needsPassphrase()) {
			await this.finish(null);
			return;
		}

		// Asked for before anything is written: without it the encode step refuses,
		// and the credentials would be lost with only a Notice to say so.
		new PassphraseModal(this.app, {
			mode: "create",
			subject: name,
			onSubmit: async (passphrase) => {
				await this.finish(passphrase);
				return null;
			},
		}).open();
	}

	/**
	 * True when this session cannot yet encrypt for this provider. A locked one
	 * is written back byte-for-byte, so it needs nothing.
	 */
	private needsPassphrase(): boolean {
		if (this.draft.keyStorage !== "passphrase") return false;
		if (this.plugin.isProviderLocked(this.draft.id)) return false;
		return !this.plugin.hasProviderPassphrase(this.draft.id);
	}

	private async finish(passphrase: string | null): Promise<void> {
		await this.onCommit(copyInstance(this.draft), passphrase);
		this.close();
	}
}
