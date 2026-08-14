import type { ButtonComponent, IconName } from "obsidian";

/**
 * Give a button both an icon and a text label.
 *
 * `ButtonComponent.setButtonText()` assigns `buttonEl.textContent`, which
 * destroys every child node, including an icon added by `setIcon()`. Only a
 * manual build of the contents keeps both. The initial empty makes a second
 * call safe, which is how a busy state changes the label.
 */
export function setButtonLabel(
	btn: ButtonComponent,
	icon: IconName,
	text: string,
): void {
	btn.buttonEl.empty();
	btn.setIcon(icon);
	btn.buttonEl.appendText(text);
	btn.buttonEl.addClass("t2ap-icon-button");
}
