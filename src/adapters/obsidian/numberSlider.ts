import type { Setting, SliderComponent, TextComponent } from "obsidian";

export interface NumberSliderOptions {
	min: number;
	max: number;
	step: number;
	value: number;
	onChange: (value: number) => void;
}

/**
 * A slider with a number box that takes a typed value.
 *
 * Obsidian shows the value beside the slider, but that text cannot be edited,
 * so an exact value needs many small drags. `styles.css` hides the built-in
 * text, because this box replaces it.
 */
export function addNumberSlider(setting: Setting, options: NumberSliderOptions): void {
	const { min, max, step } = options;
	let slider: SliderComponent | null = null;
	let box: TextComponent | null = null;

	setting.addText((text) => {
		box = text;
		const input = text.inputEl;
		input.type = "number";
		input.min = String(min);
		input.max = String(max);
		input.step = String(step);
		input.addClass("t2ap-number");
		text.setValue(String(options.value));

		// A part-typed entry such as "-" or "1." is not a value yet. Wait for
		// the next keystroke, and write the committed value back on blur.
		text.onChange((raw) => {
			const typed = Number(raw);
			if (raw.trim() === "" || !Number.isFinite(typed)) return;

			const value = clamp(typed, min, max);
			slider?.setValue(value);
			options.onChange(value);
		});

		input.addEventListener("blur", () => {
			text.setValue(String(slider?.getValue() ?? options.value));
		});
	});

	setting.addSlider((component) => {
		slider = component;
		component
			// Without this the change arrives when the thumb is released, and the
			// number box stands still during the drag.
			.setInstant(true)
			.setLimits(min, max, step)
			.setValue(options.value)
			.onChange((value) => {
				// Not while the box has focus, because that rewrite would fight
				// the keystrokes that caused this change.
				if (box && document.activeElement !== box.inputEl) {
					box.setValue(String(value));
				}
				options.onChange(value);
			});
	});

	setting.settingEl.addClass("t2ap-slider-row");
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
