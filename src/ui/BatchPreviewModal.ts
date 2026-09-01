import { App, Modal, Setting } from "obsidian";
import {
	ITEM_STATUSES,
	isBillable,
	type BatchItem,
	type BatchPlan,
	type ItemStatus,
} from "../core/batch/types";

/** What each status means to somebody reading a preview. */
const STATUS_LABELS: Record<ItemStatus, string> = {
	pending: "To make",
	stale: "To make again, the card changed",
	relink: "To link, the clip is already there",
	done: "Already done",
	"no-text": "Nothing to speak",
	"no-profile": "No such voice profile",
	"unknown-provider": "The provider no longer exists",
	"not-configured": "The provider needs its credentials",
	"cannot-render": "That provider cannot save a file",
};

/** How many notes to name before the list is cut short. */
const SAMPLE_SIZE = 8;

/**
 * What a run would do, before any of it is done.
 *
 * Nothing here is billed and nothing is written, which is the point: Azure
 * charges per character, and a filter that selects more than it looks like, or
 * a property that holds a whole note body rather than one word, is visible in
 * the character count long before it is visible on an invoice.
 */
export class BatchPreviewModal extends Modal {
	constructor(
		app: App,
		private readonly plan: BatchPlan,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.addClass("t2ap-modal");
		this.titleEl.setText(`Preview: ${this.plan.presetName}`);
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		this.renderTotals(contentEl);
		this.renderBreakdown(contentEl);
		this.renderWarnings(contentEl);

		const actions = new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Close")
				.setCta()
				.onClick(() => this.close()),
		);
		actions.settingEl.addClass("t2ap-modal-actions");
	}

	private renderTotals(container: HTMLElement): void {
		const { totals } = this.plan;

		if (totals.notes === 0) {
			container.createEl("p", {
				cls: "setting-item-description",
				text:
					"No note matches this filter. Check the property and the value, " +
					"and that Obsidian has indexed the cards.",
			});
			return;
		}

		const rows: [string, string][] = [
			["Matched notes", String(totals.notes)],
			["Targets", String(totals.targets)],
			["To synthesize", String(totals.billable)],
			["Characters", totals.characters.toLocaleString()],
		];

		for (const [name, value] of rows) {
			new Setting(container).setName(name).addExtraButton((btn) => {
				btn.extraSettingsEl.setText(value);
				btn.extraSettingsEl.addClass("t2ap-preview-value");
				btn.setDisabled(true);
			});
		}

		container.createEl("p", {
			cls: "setting-item-description",
			text:
				totals.billable === 0
					? "Nothing would be sent to a speech provider."
					: `${totals.characters.toLocaleString()} characters would be sent to a ` +
						"speech provider. Providers charge per character.",
		});
	}

	private renderBreakdown(container: HTMLElement): void {
		const counted = ITEM_STATUSES.filter((s) => this.plan.totals.byStatus[s] > 0);
		if (counted.length === 0) return;

		new Setting(container).setName("Breakdown").setHeading();

		for (const status of counted) {
			const setting = new Setting(container)
				.setName(STATUS_LABELS[status])
				.setDesc(this.sampleFor(status));

			setting.addExtraButton((btn) => {
				btn.extraSettingsEl.setText(String(this.plan.totals.byStatus[status]));
				btn.extraSettingsEl.addClass("t2ap-preview-value");
				btn.setDisabled(true);
			});

			if (!isBillable(status) && status !== "done" && status !== "relink") {
				setting.settingEl.addClass("t2ap-profile-orphan");
			}
		}
	}

	/** A few of the notes in this group, so a surprising count is traceable. */
	private sampleFor(status: ItemStatus): string {
		const notes = this.plan.items
			.filter((item) => item.status === status)
			.map((item) => item.noteTitle);
		const unique = [...new Set(notes)];
		const shown = unique.slice(0, SAMPLE_SIZE).join(", ");

		return unique.length > SAMPLE_SIZE
			? `${shown} and ${unique.length - SAMPLE_SIZE} more`
			: shown;
	}

	/**
	 * The name template asked for a property some cards do not have.
	 *
	 * Not a refusal: those clips are named after their note instead. It is worth
	 * saying, because a whole deck landing on one name is how a template typo
	 * looks from the outside.
	 */
	private renderWarnings(container: HTMLElement): void {
		const affected = this.plan.items.filter(
			(item) => item.missingProperties.length > 0 && isBillable(item.status),
		);
		if (affected.length === 0) return;

		const properties = [...new Set(affected.flatMap((i) => i.missingProperties))];
		const status = container.createDiv({ cls: "t2ap-detect-status" });

		status.createDiv({
			cls: "t2ap-detect-warning",
			text:
				`The file name template asks for ${properties.join(", ")}, which ` +
				`${plural(countNotes(affected), "note")} does not have. Those files ` +
				"are named after their note instead.",
		});
	}
}

function countNotes(items: readonly BatchItem[]): number {
	return new Set(items.map((item) => item.notePath)).size;
}

function plural(count: number, noun: string): string {
	return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
