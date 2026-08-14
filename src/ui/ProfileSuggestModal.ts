import { App, FuzzySuggestModal, type FuzzyMatch } from "obsidian";
import type { VoiceProfile } from "../core/settings/types";

/**
 * Fuzzy picker over saved profiles.
 *
 * Shows the description below the name. That is the reason a profile carries
 * a description. The name "French narrator" alone does not tell the user that
 * this profile is the slow one for articles.
 */
export class ProfileSuggestModal extends FuzzySuggestModal<VoiceProfile> {
	constructor(
		app: App,
		private readonly profiles: VoiceProfile[],
		private readonly onChoose: (profile: VoiceProfile) => void,
		placeholder = "Choose a voice profile…",
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): VoiceProfile[] {
		return this.profiles;
	}

	getItemText(profile: VoiceProfile): string {
		// Included in the fuzzy match so you can search by language too.
		return `${profile.name} ${profile.description} ${profile.locale}`;
	}

	override renderSuggestion(match: FuzzyMatch<VoiceProfile>, el: HTMLElement): void {
		const profile = match.item;
		el.addClass("t2ap-suggestion");
		el.createDiv({ cls: "t2ap-suggestion-title", text: profile.name });

		const subtitle = profile.description
			? `${profile.description} · ${profile.locale}`
			: profile.locale;
		el.createDiv({ cls: "t2ap-suggestion-desc", text: subtitle });
	}

	onChooseItem(profile: VoiceProfile): void {
		this.onChoose(profile);
	}
}
