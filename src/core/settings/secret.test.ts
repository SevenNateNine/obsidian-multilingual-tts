import { describe, expect, it } from "vitest";
import { TtsError } from "../errors";
import {
	decodeKey,
	encodeKey,
	isKeyLocked,
	nextStoredKey,
	storedKeyMode,
	type KeyStorage,
} from "./secret";

/** Shaped like an Azure key, but not one. */
const KEY = "0123456789abcdefABCDEF0123456789";
const PASSPHRASE = "correct horse battery staple";

async function expectLocked(run: Promise<unknown>): Promise<TtsError> {
	const error = await run.then(
		() => null,
		(err: unknown) => err,
	);
	expect(error).toBeInstanceOf(TtsError);
	expect((error as TtsError).kind).toBe("locked");
	return error as TtsError;
}

describe("plain mode", () => {
	it("stores the key unchanged, so an older file stays readable", async () => {
		const stored = await encodeKey(KEY, "plain", null);
		expect(stored).toBe(KEY);
		expect(await decodeKey(stored, null)).toBe(KEY);
	});

	it("reads an unprefixed value written before this feature existed", async () => {
		expect(await decodeKey(KEY, null)).toBe(KEY);
		expect(storedKeyMode(KEY)).toBe("plain");
	});
});

describe("obfuscated mode", () => {
	it("round-trips without a passphrase", async () => {
		const stored = await encodeKey(KEY, "obfuscated", null);
		expect(await decodeKey(stored, null)).toBe(KEY);
	});

	it("does not leave the key readable in the stored text", async () => {
		const stored = await encodeKey(KEY, "obfuscated", null);
		expect(stored).not.toContain(KEY);
		expect(storedKeyMode(stored)).toBe("obfuscated");
		expect(isKeyLocked(stored)).toBe(false);
	});

	it("refuses a damaged value rather than returning part of a key", async () => {
		await expectLocked(decodeKey("obf:not valid base64 ***", null));
	});
});

describe("passphrase mode", () => {
	it("round-trips with the right passphrase", async () => {
		const stored = await encodeKey(KEY, "passphrase", PASSPHRASE);
		expect(await decodeKey(stored, PASSPHRASE)).toBe(KEY);
	});

	it("reports the value as locked and hides the key", async () => {
		const stored = await encodeKey(KEY, "passphrase", PASSPHRASE);
		expect(isKeyLocked(stored)).toBe(true);
		expect(storedKeyMode(stored)).toBe("passphrase");
		expect(stored).not.toContain(KEY);
	});

	it("uses a fresh salt, so the same key never encrypts to the same text", async () => {
		const first = await encodeKey(KEY, "passphrase", PASSPHRASE);
		const second = await encodeKey(KEY, "passphrase", PASSPHRASE);
		expect(first).not.toBe(second);
	});

	it("rejects the wrong passphrase", async () => {
		const stored = await encodeKey(KEY, "passphrase", PASSPHRASE);
		await expectLocked(decodeKey(stored, "wrong passphrase"));
	});

	it("rejects a missing passphrase", async () => {
		const stored = await encodeKey(KEY, "passphrase", PASSPHRASE);
		await expectLocked(decodeKey(stored, null));
	});

	it("accepts a passphrase outside ASCII", async () => {
		const passphrase = "비밀번호 🔐 très sûr";
		const stored = await encodeKey(KEY, "passphrase", passphrase);
		expect(await decodeKey(stored, passphrase)).toBe(KEY);
	});

	it("refuses to encrypt when no passphrase is supplied", async () => {
		await expectLocked(encodeKey(KEY, "passphrase", null));
	});
});

describe("a tampered or unreadable envelope", () => {
	async function rewriteEnvelope(
		stored: string,
		change: (envelope: Record<string, unknown>) => void,
	): Promise<string> {
		const body = stored.slice("enc:".length);
		const envelope = JSON.parse(atob(body)) as Record<string, unknown>;
		change(envelope);
		return "enc:" + btoa(JSON.stringify(envelope));
	}

	it("fails closed when the ciphertext is altered", async () => {
		const stored = await encodeKey(KEY, "passphrase", PASSPHRASE);
		const tampered = await rewriteEnvelope(stored, (envelope) => {
			const ct = envelope.ct as string;
			// Flip one base64 character. AES-GCM authenticates, so this must fail.
			envelope.ct = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
		});
		await expectLocked(decodeKey(tampered, PASSPHRASE));
	});

	it("refuses a version it does not know instead of reporting a bad passphrase", async () => {
		const stored = await encodeKey(KEY, "passphrase", PASSPHRASE);
		const future = await rewriteEnvelope(stored, (envelope) => {
			envelope.v = 2;
		});
		const error = await expectLocked(decodeKey(future, PASSPHRASE));
		expect(error.detail ?? error.message).toContain("unsupported");
	});

	it("refuses an envelope with a missing field", async () => {
		const stored = await encodeKey(KEY, "passphrase", PASSPHRASE);
		const broken = await rewriteEnvelope(stored, (envelope) => {
			delete envelope.iv;
		});
		await expectLocked(decodeKey(broken, PASSPHRASE));
	});

	it("refuses a body that is not an envelope at all", async () => {
		await expectLocked(decodeKey("enc:" + btoa("plain words"), PASSPHRASE));
	});
});

describe("nextStoredKey", () => {
	const locked = {
		stored: "enc:whatever-was-written-before",
		plaintext: "",
		mode: "passphrase" as KeyStorage,
		passphrase: null,
		locked: true,
	};

	// The data-loss case. A save before the first unlock must not touch the key.
	it("writes a locked key back untouched", async () => {
		expect(await nextStoredKey(locked)).toBe(locked.stored);
	});

	it("keeps a locked key even when the mode changed under it", async () => {
		expect(await nextStoredKey({ ...locked, mode: "plain" })).toBe(locked.stored);
	});

	it("never asks a locked key for a passphrase it does not have", async () => {
		await expect(nextStoredKey(locked)).resolves.toBe(locked.stored);
	});

	it("re-encodes once the key is unlocked", async () => {
		const stored = await nextStoredKey({
			stored: "enc:old",
			plaintext: KEY,
			mode: "obfuscated",
			passphrase: null,
			locked: false,
		});
		expect(storedKeyMode(stored)).toBe("obfuscated");
		expect(await decodeKey(stored, null)).toBe(KEY);
	});

	it("clears the stored key when an unlocked key is emptied", async () => {
		const stored = await nextStoredKey({
			stored: "obf:something",
			plaintext: "",
			mode: "obfuscated",
			passphrase: null,
			locked: false,
		});
		expect(stored).toBe("");
	});
});

describe("an empty key", () => {
	const modes: KeyStorage[] = ["plain", "obfuscated", "passphrase"];

	it("stays empty in every mode and never needs a passphrase", async () => {
		for (const mode of modes) {
			expect(await encodeKey("", mode, null)).toBe("");
		}
		expect(await decodeKey("", null)).toBe("");
	});
});
