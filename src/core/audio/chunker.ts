/**
 * Split text into synthesis-sized pieces.
 *
 * Two independent reasons this is required:
 *  - Azure truncates a single request's audio at 10 minutes.
 *  - Chrome/Electron's speechSynthesis silently stops on long utterances.
 *
 * Splitting also lets playback start after the first chunk instead of after the
 * whole note, which is the difference between "instant" and "wait 40 seconds".
 */

export interface ChunkOptions {
	/** Soft ceiling. A chunk only exceeds this when a single sentence does. */
	maxChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 2000 };

/** Sentence terminators for Latin scripts plus the CJK full-width forms. */
const SENTENCE_BOUNDARY = /(?<=[.!?？！。…]["'”’)\]]*)\s+/;

export function chunkText(
	text: string,
	opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	if (trimmed.length <= opts.maxChars) return [trimmed];

	const chunks: string[] = [];
	let current = "";

	const flush = () => {
		const value = current.trim();
		if (value) chunks.push(value);
		current = "";
	};

	// Paragraphs first so a chunk boundary lands on a blank line where possible.
	for (const paragraph of trimmed.split(/\n{2,}/)) {
		for (const piece of splitParagraph(paragraph, opts.maxChars)) {
			if (!current) {
				current = piece;
			} else if (current.length + 1 + piece.length <= opts.maxChars) {
				current = `${current}\n${piece}`;
			} else {
				flush();
				current = piece;
			}
		}
	}
	flush();

	return chunks;
}

function splitParagraph(paragraph: string, maxChars: number): string[] {
	const value = paragraph.trim();
	if (!value) return [];
	if (value.length <= maxChars) return [value];

	const out: string[] = [];
	let current = "";

	for (const sentence of value.split(SENTENCE_BOUNDARY)) {
		for (const piece of splitSentence(sentence, maxChars)) {
			if (!current) {
				current = piece;
			} else if (current.length + 1 + piece.length <= maxChars) {
				current = `${current} ${piece}`;
			} else {
				out.push(current);
				current = piece;
			}
		}
	}
	if (current) out.push(current);

	return out;
}

/** Last resort for a single sentence longer than the limit: break on whitespace. */
function splitSentence(sentence: string, maxChars: number): string[] {
	const value = sentence.trim();
	if (!value) return [];
	if (value.length <= maxChars) return [value];

	const out: string[] = [];
	let current = "";

	for (const word of value.split(/\s+/)) {
		if (!current) {
			current = word;
		} else if (current.length + 1 + word.length <= maxChars) {
			current = `${current} ${word}`;
		} else {
			out.push(current);
			current = word;
		}
	}
	if (current) out.push(current);

	// A single unbroken token longer than the limit still has to be cut.
	return out.flatMap((piece) =>
		piece.length <= maxChars ? [piece] : hardSplit(piece, maxChars),
	);
}

function hardSplit(value: string, maxChars: number): string[] {
	const out: string[] = [];
	for (let i = 0; i < value.length; i += maxChars) {
		out.push(value.slice(i, i + maxChars));
	}
	return out;
}
