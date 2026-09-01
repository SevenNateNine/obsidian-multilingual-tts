import { App, Modal, Setting } from "obsidian";
import type MultilingualTtsPlugin from "../main";
import { createAudioTarget } from "../core/settings/types";
import { validateTargets } from "../core/batch/targets";
import type { AudioTarget, BatchPreset } from "../core/batch/types";
import { BatchTargetModal } from "./BatchTargetModal";
import { setButtonLabel } from "../adapters/obsidian/buttonLabel";
import { addHelpIcon } from "../adapters/obsidian/helpIcon";

const FILTER_HELP =
	"The property and value that select the cards. A value written as a " +
	"wikilink and one written plainly are the same value, so [[Flashcard]] " +
	"matches type: [[Flashcard]] and type: Flashcard alike. Case is ignored.";

const TRACK_HELP =
	"Records what each clip was made from, in a property beside its link. A " +
	"card whose words or voice have changed is then spoken again on the next " +
	"run. With this off a clip is made once and never refreshed.";

function copyPreset(preset: BatchPreset): BatchPreset {
	return {
		...preset,
		filter: { ...preset.filter },
		targets: preset.targets.map((target) => ({ ...target })),
	};
}

/**
 * Create or edit one batch preset.
 *
 * Works on a copy and commits on Save. Save is refused while `validateTargets`
 * has anything to say, because every one of those problems produces a silently
 * wrong result at run time rather than a failure the user would notice.
 */
export class BatchPresetModal extends Modal {
	private readonly draft: BatchPreset;

	constructor(
		app: App,
		private readonly plugin: MultilingualTtsPlugin,
		preset: BatchPreset,
		private readonly isNew: boolean,
		private readonly onCommit: (preset: BatchPreset) => Promise<void>,
	) {
		super(app);
		this.draft = copyPreset(preset);
	}

	override onOpen(): void {
		this.modalEl.addClass("t2ap-modal");
		this.titleEl.setText(this.isNew ? "Add batch preset" : "Edit batch preset");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Shown in the preset list and in the preview.")
			.addText((text) =>
				text
					.setPlaceholder("Korean deck")
					.setValue(this.draft.name)
					.onChange((value) => {
						this.draft.name = value;
					}),
			);

		this.renderFilter(contentEl);
		this.renderTargets(contentEl);
		this.renderProblems(contentEl);
		this.renderActions(contentEl);
	}

	private renderFilter(container: HTMLElement): void {
		new Setting(container)
			.setName("Cards")
			.setDesc("Which notes this preset acts on.")
			.setHeading();

		const filter = new Setting(container)
			.setName("Property is")
			.setDesc("A note matches when this property holds this value.")
			.addText((text) =>
				text
					.setPlaceholder("type")
					.setValue(this.draft.filter.property)
					.onChange((value) => {
						this.draft.filter.property = value;
					}),
			)
			.addText((text) =>
				text
					.setPlaceholder("[[Flashcard]]")
					.setValue(this.draft.filter.value)
					.onChange((value) => {
						this.draft.filter.value = value;
					}),
			);
		addHelpIcon(filter, FILTER_HELP);

		const track = new Setting(container)
			.setName("Detect edited cards")
			.setDesc("Speak a card again after its words or its voice change.")
			.addToggle((toggle) =>
				toggle.setValue(this.draft.trackChanges).onChange((value) => {
					this.draft.trackChanges = value;
				}),
			);
		addHelpIcon(track, TRACK_HELP);
	}

	private renderTargets(container: HTMLElement): void {
		new Setting(container)
			.setName("Targets")
			.setDesc("One per property to speak. A card can gain several clips in one pass.")
			.setHeading()
			.addButton((btn) =>
				btn
					.setButtonText("Add target")
					.setCta()
					.onClick(() => this.openTarget(createAudioTarget(), true)),
			);

		if (this.draft.targets.length === 0) {
			container.createEl("p", {
				cls: "setting-item-description",
				text: "No targets yet. Add one to say which property to speak.",
			});
			return;
		}

		this.draft.targets.forEach((target, index) => {
			this.renderTargetRow(container, target, index);
		});
	}

	private renderTargetRow(
		container: HTMLElement,
		target: AudioTarget,
		index: number,
	): void {
		const setting = new Setting(container)
			.setName(target.textField || "(no property)")
			.setDesc(this.describeTarget(target));

		setting.settingEl.addClass("t2ap-provider-row");

		setting.addExtraButton((btn) =>
			btn
				.setIcon("pencil")
				.setTooltip("Edit")
				.onClick(() => this.openTarget(target, false)),
		);

		setting.addExtraButton((btn) =>
			btn
				.setIcon("trash")
				.setTooltip("Delete")
				.onClick(() => {
					this.draft.targets.splice(index, 1);
					this.render();
				}),
		);
	}

	private describeTarget(target: AudioTarget): string {
		const profile = this.plugin.settings.profiles.find(
			(p) => p.id === target.profileId,
		);
		const bits = [
			`→ ${target.audioField || "(no property)"}`,
			profile?.name ?? "default profile",
		];
		if (target.prefix) bits.push(`${target.prefix}…`);
		if (target.nameFrom) bits.push(`named after ${target.nameFrom}`);
		return bits.join(" · ");
	}

	private openTarget(target: AudioTarget, isNew: boolean): void {
		new BatchTargetModal(this.app, this.plugin, target, isNew, (result) => {
			const index = this.draft.targets.findIndex((t) => t.id === result.id);
			if (index >= 0) this.draft.targets[index] = result;
			else this.draft.targets.push(result);
			this.render();
		}).open();
	}

	/** Every problem at once, so a fix does not simply reveal the next one. */
	private renderProblems(container: HTMLElement): void {
		const problems = validateTargets(this.draft.targets);
		if (problems.length === 0) return;

		const list = container.createDiv({ cls: "t2ap-detect-status" });
		for (const problem of problems) {
			list.createDiv({ cls: "t2ap-detect-warning", text: problem });
		}
	}

	private renderActions(container: HTMLElement): void {
		const blocked = validateTargets(this.draft.targets).length > 0;

		const actions = new Setting(container)
			.addButton((btn) => {
				setButtonLabel(btn, "x", "Cancel");
				btn.onClick(() => this.close());
			})
			.addButton((btn) => {
				setButtonLabel(btn, "check", this.isNew ? "Add" : "Save");
				btn.setCta();
				btn.setDisabled(blocked);
				btn.onClick(() => void this.commit());
			});

		actions.settingEl.addClass("t2ap-modal-actions");
	}

	private async commit(): Promise<void> {
		await this.onCommit(copyPreset(this.draft));
		this.close();
	}
}
