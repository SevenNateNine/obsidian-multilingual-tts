import { describe, expect, it } from "vitest";
import { SecretVault } from "./SecretVault";
import { encodeKey } from "./secret";
import { TtsError } from "../errors";

/** Shaped like an Azure key, but not one. */
const KEY = "0123456789abcdefABCDEF0123456789";
const OTHER_KEY = "fedcba9876543210FEDCBA9876543210";
const PASSPHRASE = "correct horse battery staple";

describe("adopt", () => {
	it("reads back a value that needs no passphrase", async () => {
		const vault = new SecretVault();
		const stored = await encodeKey(KEY, "obfuscated", null);

		expect(await vault.adopt("azure", "key", stored)).toBe(KEY);
		expect(vault.isLocked("azure")).toBe(false);
	});

	it("leaves an encrypted value locked and empty", async () => {
		const vault = new SecretVault();
		const stored = await encodeKey(KEY, "passphrase", PASSPHRASE);

		expect(await vault.adopt("azure", "key", stored)).toBe("");
		expect(vault.isLocked("azure")).toBe(true);
	});

	it("reports nothing about a provider it has never seen", () => {
		const vault = new SecretVault();
		expect(vault.isLocked("unknown")).toBe(false);
		expect(vault.hasPassphrase("unknown")).toBe(false);
	});
});

describe("unlock", () => {
	it("returns the plain text by field and clears the lock", async () => {
		const vault = new SecretVault();
		await vault.adopt("azure", "key", await encodeKey(KEY, "passphrase", PASSPHRASE));

		expect(await vault.unlock("azure", PASSPHRASE)).toEqual({ key: KEY });
		expect(vault.isLocked("azure")).toBe(false);
		expect(vault.hasPassphrase("azure")).toBe(true);
	});

	// AES-GCM authenticates, so a wrong passphrase and a tampered value fail the
	// same way. Neither one may leave the vault half open.
	it("leaves the provider locked after a wrong passphrase", async () => {
		const vault = new SecretVault();
		await vault.adopt("azure", "key", await encodeKey(KEY, "passphrase", PASSPHRASE));

		await expect(vault.unlock("azure", "wrong")).rejects.toBeInstanceOf(TtsError);
		expect(vault.isLocked("azure")).toBe(true);
		expect(vault.hasPassphrase("azure")).toBe(false);
	});

	it("unlocks one provider without touching another", async () => {
		const vault = new SecretVault();
		const stored = await encodeKey(KEY, "passphrase", PASSPHRASE);
		await vault.adopt("work", "key", stored);
		await vault.adopt("home", "key", stored);

		await vault.unlock("work", PASSPHRASE);

		expect(vault.isLocked("work")).toBe(false);
		expect(vault.isLocked("home")).toBe(true);
	});
});

describe("forDisk", () => {
	it("encodes a newly typed value", async () => {
		const vault = new SecretVault();
		vault.setPlaintext("azure", "key", KEY);

		const stored = await vault.forDisk("azure", "key", "obfuscated");
		expect(stored).toBe(await encodeKey(KEY, "obfuscated", null));
	});

	/**
	 * Without this rule, saving any unrelated setting before the first unlock
	 * would replace a key that nobody has read yet with an empty string.
	 */
	it("writes a locked value back byte for byte", async () => {
		const vault = new SecretVault();
		const stored = await encodeKey(KEY, "passphrase", PASSPHRASE);
		await vault.adopt("azure", "key", stored);

		expect(await vault.forDisk("azure", "key", "passphrase")).toBe(stored);
	});

	/**
	 * Every settings edit writes the whole file and PBKDF2 is deliberately slow,
	 * so the envelope is built once per change. A fresh encode would produce a
	 * new random salt and IV, and so a different string.
	 */
	it("encodes once per change, not once per save", async () => {
		const vault = new SecretVault();
		vault.setPlaintext("azure", "key", KEY);
		vault.setPassphrase("azure", PASSPHRASE);

		const first = await vault.forDisk("azure", "key", "passphrase");
		expect(await vault.forDisk("azure", "key", "passphrase")).toBe(first);
	});

	it("encodes again once the value changes", async () => {
		const vault = new SecretVault();
		vault.setPlaintext("azure", "key", KEY);
		const first = await vault.forDisk("azure", "key", "obfuscated");

		vault.setPlaintext("azure", "key", OTHER_KEY);
		expect(await vault.forDisk("azure", "key", "obfuscated")).not.toBe(first);
	});

	it("re-encodes when only the mode changes", async () => {
		const vault = new SecretVault();
		vault.setPlaintext("azure", "key", KEY);
		await vault.forDisk("azure", "key", "obfuscated");

		expect(await vault.forDisk("azure", "key", "plain")).toBe(KEY);
	});

	it("keeps two providers apart", async () => {
		const vault = new SecretVault();
		vault.setPlaintext("work", "key", KEY);
		vault.setPlaintext("home", "key", OTHER_KEY);

		expect(await vault.forDisk("work", "key", "plain")).toBe(KEY);
		expect(await vault.forDisk("home", "key", "plain")).toBe(OTHER_KEY);
	});
});

describe("setPlaintext", () => {
	// A newly typed value is plain text, so it replaces whatever was stored.
	it("clears the lock, because the new value needs no passphrase", async () => {
		const vault = new SecretVault();
		await vault.adopt("azure", "key", await encodeKey(KEY, "passphrase", PASSPHRASE));

		vault.setPlaintext("azure", "key", OTHER_KEY);

		expect(vault.isLocked("azure")).toBe(false);
		expect(await vault.forDisk("azure", "key", "plain")).toBe(OTHER_KEY);
	});
});

describe("forget", () => {
	it("drops every secret and the session passphrase of one provider", async () => {
		const vault = new SecretVault();
		await vault.adopt("azure", "key", await encodeKey(KEY, "passphrase", PASSPHRASE));
		await vault.unlock("azure", PASSPHRASE);

		vault.forget("azure");

		expect(vault.hasPassphrase("azure")).toBe(false);
		expect(await vault.forDisk("azure", "key", "plain")).toBe("");
	});
});
