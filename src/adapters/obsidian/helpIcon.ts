import { setIcon, setTooltip, type Setting } from "obsidian";

/**
 * Put a help icon after the name of a setting.
 *
 * The row keeps its short description, and the long text stays in the tooltip.
 * A span, not a button, because a click does nothing. `Setting.setTooltip()`
 * is not used, because it covers the whole name, and the icon is the part that
 * offers help. `tabIndex` puts the icon in the tab order, so a keyboard user
 * can read the text too.
 */
export function addHelpIcon(setting: Setting, tooltip: string): void {
	const icon = setting.nameEl.createSpan({ cls: "t2ap-help-icon" });
	setIcon(icon, "help-circle");
	setTooltip(icon, tooltip, { placement: "top" });
	icon.tabIndex = 0;
}
