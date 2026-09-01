/**
 * Whether a writing system names its language on its own.
 *
 * Language identification from word statistics needs a sentence to work with.
 * Identification from the script needs one character: nothing written in
 * Hangul is French. Splitting the two lets a single Korean or Chinese
 * character be read correctly, while a single Latin character still falls
 * back rather than guessing.
 */

/**
 * Scripts that one language uses, so one character already names it.
 *
 * Latin, Cyrillic, Arabic and Devanagari are deliberately absent: several
 * languages share each of them, and only word statistics tell those apart.
 *
 * Han is included but is the one imperfect entry: Chinese and Japanese share
 * it. A lone Han character resolves to Chinese, because that is the choice
 * the detector makes when kana are absent. Text with kana in it resolves to
 * Japanese normally.
 */
const OWN_SCRIPT =
	/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Greek}\p{Script=Hebrew}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Bengali}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Myanmar}\p{Script=Sinhala}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Ethiopic}\p{Script=Khmer}\p{Script=Lao}]/u;

/** Scripts that several languages share, so length still decides. */
const SHARED_SCRIPT =
	/[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}]/u;

/**
 * True when the script alone identifies the language of `text`.
 *
 * Punctuation, digits and spaces belong to no script and are ignored, so
 * "안녕하세요." still qualifies. One character from a shared script disqualifies
 * the whole selection, because that character is the ambiguous part.
 */
export function identifiesLanguageByScript(text: string): boolean {
	return OWN_SCRIPT.test(text) && !SHARED_SCRIPT.test(text);
}
