import { App, FuzzySuggestModal, type FuzzyMatch } from "obsidian";
import type { BatchPreset } from "../core/batch/types";

/**
 * Fuzzy picker over batch presets.
 *
 * Shows the filter under the name, because two decks are told apart by what
 * they select rather than by what they were called. A preset named "Cards" is
 * only recognisable as `type is [[Flashcard]]`.
 */
export class BatchPresetSuggestModal extends FuzzySuggestModal<BatchPreset> {
	constructor(
		app: App,
		private readonly presets: BatchPreset[],
		private readonly onChoose: (preset: BatchPreset) => void,
		placeholder = "Choose a batch preset…",
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): BatchPreset[] {
		return this.presets;
	}

	getItemText(preset: BatchPreset): string {
		// The properties are in the match text, so a deck is findable by the
		// field it speaks as well as by its name.
		const fields = preset.targets.map((t) => t.textField).join(" ");
		return `${preset.name} ${preset.filter.property} ${preset.filter.value} ${fields}`;
	}

	override renderSuggestion(match: FuzzyMatch<BatchPreset>, el: HTMLElement): void {
		const preset = match.item;
		el.addClass("t2ap-suggestion");
		el.createDiv({ cls: "t2ap-suggestion-title", text: preset.name });
		el.createDiv({ cls: "t2ap-suggestion-desc", text: describePreset(preset) });
	}

	onChooseItem(preset: BatchPreset): void {
		this.onChoose(preset);
	}
}

/** One line: what a preset selects, and how many clips it makes per card. */
export function describePreset(preset: BatchPreset): string {
	const { property, value } = preset.filter;
	const selects = property && value ? `${property} is ${value}` : "no filter yet";
	const count = preset.targets.length;

	return `${selects} · ${count === 1 ? "1 target" : `${count} targets`}`;
}
