import { setTooltip, type DropdownComponent } from "obsidian";

/**
 * Put the full text of the selected option in a tooltip.
 *
 * Every dropdown has one width, so a long name is cut. The tooltip gives it
 * back. `data-full` holds the text when the option carries a short label.
 */
export function addDropdownTooltip(dd: DropdownComponent): void {
	const select = dd.selectEl;
	const update = (): void => {
		const option = select.selectedOptions[0];
		setTooltip(select, option?.dataset.full ?? option?.text ?? "");
	};

	select.addEventListener("change", update);
	update();
}

/**
 * Keep the closed control short, and show the full label when the list opens.
 *
 * A native select paints the text of the selected option, so a long label
 * makes the control wide. The option text changes on focus, which happens
 * before the list opens, and changes back on blur.
 */
export function setCompactLabels(
	dd: DropdownComponent,
	short: (value: string) => string,
): void {
	const select = dd.selectEl;
	const swap = (full: boolean): void => {
		for (const option of Array.from(select.options)) {
			option.dataset.full ??= option.text;
			option.text = full ? (option.dataset.full ?? option.text) : short(option.value);
		}
	};

	select.addEventListener("focus", () => swap(true));
	select.addEventListener("blur", () => swap(false));
	swap(false);
	addDropdownTooltip(dd);
}
