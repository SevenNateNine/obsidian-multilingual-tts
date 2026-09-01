import { hashFieldFor, type AudioTarget } from "./types";

/**
 * What is wrong with a preset's target list, one message per problem.
 *
 * Checked while the user edits, not when a run starts, because none of these
 * fails loudly. A repeated property is overwritten by whichever target runs
 * last. A repeated prefix collides on the file name, where `uniqueVaultPath`
 * adds a numeric suffix without a word and pairs a card with another card's
 * clip.
 */
export function validateTargets(targets: readonly AudioTarget[]): string[] {
	if (targets.length === 0) return ["Add at least one target."];

	const problems: string[] = [];
	for (const [index, target] of targets.entries()) {
		problems.push(...ownProblems(target, index));
	}
	problems.push(...sharedProblems(targets));
	return problems;
}

/** Problems a target has on its own, without reference to its siblings. */
function ownProblems(target: AudioTarget, index: number): string[] {
	const label = `Target ${index + 1}`;
	const text = target.textField.trim();
	const audio = target.audioField.trim();
	const problems: string[] = [];

	if (!text) problems.push(`${label} needs a property to speak.`);
	if (!audio) problems.push(`${label} needs a property to write the link to.`);
	if (text && text === audio) {
		problems.push(`${label} would write its link over "${text}", the words it speaks.`);
	}
	return problems;
}

/** Problems that only exist because two targets are in the same preset. */
function sharedProblems(targets: readonly AudioTarget[]): string[] {
	if (targets.length < 2) return [];

	const problems: string[] = [];
	const written = targets.flatMap(writtenProperties);
	const spoken = new Set(targets.map((t) => t.textField.trim()).filter(Boolean));

	for (const property of duplicates(written)) {
		problems.push(`Two targets write to "${property}". Each one needs its own.`);
	}
	for (const property of new Set(written)) {
		if (spoken.has(property)) {
			problems.push(`"${property}" is spoken by one target and written by another.`);
		}
	}
	for (const prefix of duplicates(targets.map((t) => t.prefix.trim()))) {
		problems.push(
			prefix
				? `Two targets share the prefix "${prefix}". Each one needs its own.`
				: "Two targets have no prefix, so their files collide. Give each one a prefix.",
		);
	}
	return problems;
}

/** Every property a target writes: the link, and the change hash beside it. */
function writtenProperties(target: AudioTarget): string[] {
	const audio = target.audioField.trim();
	return audio ? [audio, hashFieldFor(target)] : [];
}

/** Each value that appears more than once, reported once, in first-seen order. */
function duplicates(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const repeated = new Set<string>();

	for (const value of values) {
		if (seen.has(value)) repeated.add(value);
		seen.add(value);
	}
	return [...repeated];
}
