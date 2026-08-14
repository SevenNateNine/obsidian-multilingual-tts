import { franc } from "franc-min";
import type { Detector } from "../core/text/detectLanguage";

/**
 * Language identification with franc.
 *
 * `minLength: 1` because the caller already enforces its own minimum through
 * `autoDetect.minChars`, and `only` restricts franc to the languages the
 * profiles of the user cover.
 */
export const francDetector: Detector = (text, only) =>
	franc(text, { only, minLength: 1 });
