import { TtsError } from "../errors";

/**
 * At-rest encoding for the Azure speech key.
 *
 * Obsidian writes plugin settings to data.json as plain text, so the one field
 * that is a credential gets three levels of protection here.
 *
 * Each stored value carries a prefix that names its own encoding. Decoding
 * therefore never depends on a setting, and a value written by an older build
 * has no prefix and stays readable. The prefix is safe because an Azure speech
 * key is alphanumeric and can never contain a colon.
 */

export const KEY_STORAGE_MODES = ["plain", "obfuscated", "passphrase"] as const;

export type KeyStorage = (typeof KEY_STORAGE_MODES)[number];

const OBFUSCATED_PREFIX = "obf:";
const ENCRYPTED_PREFIX = "enc:";

/**
 * PBKDF2 cost, the OWASP figure for PBKDF2-HMAC-SHA256.
 *
 * The count travels inside each envelope, so a later build can raise it without
 * making a key written by this build unreadable. The user pays this cost once
 * per session, not once per request.
 */
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** The persisted form of an encrypted key. Every field is base64. */
interface Envelope {
	v: 1;
	kdf: "PBKDF2-SHA256";
	iterations: number;
	salt: string;
	iv: string;
	ct: string;
}

/** The encoding a stored value was written with. Unprefixed text is plain. */
export function storedKeyMode(stored: string): KeyStorage {
	if (stored.startsWith(ENCRYPTED_PREFIX)) return "passphrase";
	if (stored.startsWith(OBFUSCATED_PREFIX)) return "obfuscated";
	return "plain";
}

/** True when the value needs a passphrase before anything can read it. */
export function isKeyLocked(stored: string): boolean {
	return storedKeyMode(stored) === "passphrase";
}

/**
 * Turn a plain-text key into the form written to data.json.
 *
 * An empty key stays empty in every mode, so an unconfigured plugin never
 * writes an envelope and never asks for a passphrase.
 */
export async function encodeKey(
	plaintext: string,
	mode: KeyStorage,
	passphrase: string | null,
	cryptoImpl: Crypto = globalThis.crypto,
): Promise<string> {
	if (plaintext === "") return "";
	if (mode === "plain") return plaintext;
	if (mode === "obfuscated") return OBFUSCATED_PREFIX + obfuscate(plaintext);

	if (!passphrase) {
		throw new TtsError("locked", "encodeKey needs a passphrase in passphrase mode");
	}
	return ENCRYPTED_PREFIX + (await encrypt(plaintext, passphrase, cryptoImpl));
}

/**
 * Recover the plain-text key from a stored value.
 *
 * Throws a locked `TtsError` when the value is encrypted and the passphrase is
 * absent or wrong. The caller can tell those apart with `isKeyLocked`.
 */
export async function decodeKey(
	stored: string,
	passphrase: string | null,
	cryptoImpl: Crypto = globalThis.crypto,
): Promise<string> {
	if (stored === "") return "";

	if (stored.startsWith(OBFUSCATED_PREFIX)) {
		return deobfuscate(stored.slice(OBFUSCATED_PREFIX.length));
	}

	if (stored.startsWith(ENCRYPTED_PREFIX)) {
		if (!passphrase) {
			throw new TtsError("locked", "the stored speech key is encrypted");
		}
		return decrypt(stored.slice(ENCRYPTED_PREFIX.length), passphrase, cryptoImpl);
	}

	return stored;
}

export interface KeyWriteRequest {
	/** The value data.json holds right now. */
	stored: string;
	/** The plain-text key in memory. Empty while the stored key is locked. */
	plaintext: string;
	mode: KeyStorage;
	passphrase: string | null;
	/** True when `stored` is encrypted and nothing has decrypted it yet. */
	locked: boolean;
}

/**
 * The value to write for the key.
 *
 * A locked key is written back exactly as it was read. Without that rule, saving
 * any unrelated setting before the first unlock would replace a key that nobody
 * has read yet with an empty string, and the key would be gone.
 */
export async function nextStoredKey(
	request: KeyWriteRequest,
	cryptoImpl: Crypto = globalThis.crypto,
): Promise<string> {
	if (request.locked) return request.stored;
	return encodeKey(request.plaintext, request.mode, request.passphrase, cryptoImpl);
}

/**
 * Reversible encoding, not encryption.
 *
 * This is the same class of protection that Remotely Save applies to its own
 * settings file. It defeats a screenshot, a glance over a shoulder, and a
 * data.json pasted into a bug report. It defeats nobody who wants the key.
 */
function obfuscate(secret: string): string {
	return reverse(toBase64(new TextEncoder().encode(secret)));
}

function deobfuscate(stored: string): string {
	try {
		return new TextDecoder().decode(fromBase64(reverse(stored)));
	} catch {
		// A hand-edited or truncated value must not read back as a partial key.
		throw new TtsError("locked", "the stored speech key is damaged");
	}
}

async function encrypt(
	plaintext: string,
	passphrase: string,
	cryptoImpl: Crypto,
): Promise<string> {
	const salt = cryptoImpl.getRandomValues(new Uint8Array(SALT_BYTES));
	const iv = cryptoImpl.getRandomValues(new Uint8Array(IV_BYTES));
	const key = await deriveKey(passphrase, salt, ITERATIONS, cryptoImpl);

	const ct = await cryptoImpl.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(plaintext),
	);

	const envelope: Envelope = {
		v: 1,
		kdf: "PBKDF2-SHA256",
		iterations: ITERATIONS,
		salt: toBase64(salt),
		iv: toBase64(iv),
		ct: toBase64(new Uint8Array(ct)),
	};
	return toBase64(new TextEncoder().encode(JSON.stringify(envelope)));
}

async function decrypt(
	stored: string,
	passphrase: string,
	cryptoImpl: Crypto,
): Promise<string> {
	const envelope = parseEnvelope(stored);
	const key = await deriveKey(
		passphrase,
		fromBase64(envelope.salt),
		envelope.iterations,
		cryptoImpl,
	);

	try {
		const plaintext = await cryptoImpl.subtle.decrypt(
			{ name: "AES-GCM", iv: fromBase64(envelope.iv) },
			key,
			fromBase64(envelope.ct),
		);
		return new TextDecoder().decode(plaintext);
	} catch {
		// AES-GCM authenticates, so a wrong passphrase and a tampered ciphertext
		// fail the same way. Neither one can be told apart, and neither is fatal.
		throw new TtsError("locked", "wrong passphrase, or the stored key was altered");
	}
}

function parseEnvelope(stored: string): Envelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(fromBase64(stored)));
	} catch {
		throw new TtsError("locked", "the stored speech key is damaged");
	}

	if (!isRecord(parsed) || parsed.v !== 1 || parsed.kdf !== "PBKDF2-SHA256") {
		// A newer build can write a format this one cannot read. Refuse it rather
		// than derive a key with the wrong parameters and report a bad passphrase.
		throw new TtsError("locked", "the stored speech key uses an unsupported format");
	}

	const { iterations, salt, iv, ct } = parsed;
	if (
		typeof iterations !== "number" ||
		!Number.isInteger(iterations) ||
		iterations < 1 ||
		typeof salt !== "string" ||
		typeof iv !== "string" ||
		typeof ct !== "string"
	) {
		throw new TtsError("locked", "the stored speech key is damaged");
	}

	return { v: 1, kdf: "PBKDF2-SHA256", iterations, salt, iv, ct };
}

function deriveKey(
	passphrase: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number,
	cryptoImpl: Crypto,
): Promise<CryptoKey> {
	return cryptoImpl.subtle
		.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
			"deriveKey",
		])
		.then((material) =>
			cryptoImpl.subtle.deriveKey(
				{ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
				material,
				{ name: "AES-GCM", length: 256 },
				false,
				["encrypt", "decrypt"],
			),
		);
}

function reverse(text: string): string {
	return [...text].reverse().join("");
}

/** btoa handles single bytes only, so the text is encoded to UTF-8 first. */
function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** The explicit buffer type keeps the result assignable to `BufferSource`. */
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (const [index, character] of [...binary].entries()) {
		bytes[index] = character.charCodeAt(0);
	}
	return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
