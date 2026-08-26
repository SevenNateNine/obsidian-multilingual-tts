import { decodeKey, nextStoredKey, storedKeyMode, type KeyStorage } from "./secret";

/**
 * The at-rest state of every provider credential, one entry per field.
 *
 * Each provider instance stores its secrets independently, so one locked Azure
 * resource never blocks another. The passphrase is held per instance, because
 * the storage mode is a per-instance setting.
 *
 * The plain text lives in `ProviderInstance.config` while the plugin runs. This
 * class owns only the form written to data.json and whether it can be read.
 */

interface FieldSecret {
	/** The value data.json holds right now. */
	stored: string;
	/** The plain text in memory. Empty while `locked`. */
	plaintext: string;
	/** The plain text `stored` was built from. Null when nothing built it. */
	encodedFrom: string | null;
	/** True when `stored` is encrypted and nothing has decrypted it yet. */
	locked: boolean;
}

interface InstanceSecrets {
	/** Session only. Never persisted, and dropped when Obsidian closes. */
	passphrase: string | null;
	fields: Map<string, FieldSecret>;
}

function emptyField(): FieldSecret {
	return { stored: "", plaintext: "", encodedFrom: null, locked: false };
}

export class SecretVault {
	private readonly instances = new Map<string, InstanceSecrets>();

	constructor(private readonly cryptoImpl: Crypto = globalThis.crypto) {}

	/**
	 * Take a value as data.json holds it and return the plain text to use.
	 *
	 * The state is recorded before the decode is attempted, so a damaged value is
	 * still described by the vault after this throws. Returns an empty string for
	 * an encrypted value, which stays locked until `unlock`.
	 */
	async adopt(instanceId: string, key: string, stored: string): Promise<string> {
		const field = this.field(instanceId, key);
		field.stored = stored;
		field.plaintext = "";
		field.encodedFrom = null;
		field.locked = storedKeyMode(stored) === "passphrase";
		if (field.locked) return "";

		field.plaintext = await decodeKey(stored, null, this.cryptoImpl);
		field.encodedFrom = field.plaintext;
		return field.plaintext;
	}

	/** True when any secret of this instance is waiting for its passphrase. */
	isLocked(instanceId: string): boolean {
		const instance = this.instances.get(instanceId);
		if (!instance) return false;
		return [...instance.fields.values()].some((field) => field.locked);
	}

	/**
	 * Replace a secret in memory. A newly typed value is plain text, so it
	 * replaces whatever was stored and nothing stays locked. The caller saves.
	 */
	setPlaintext(instanceId: string, key: string, value: string): void {
		const field = this.field(instanceId, key);
		field.plaintext = value;
		field.locked = false;
	}

	/**
	 * Decrypt every locked secret of one instance.
	 *
	 * Returns the plain text by field key, for the caller to put back into the
	 * instance config. Nothing is committed until every field decodes, so a wrong
	 * passphrase leaves the instance exactly as locked as it was.
	 */
	async unlock(
		instanceId: string,
		passphrase: string,
	): Promise<Record<string, string>> {
		const instance = this.instances.get(instanceId);
		if (!instance) return {};

		const decoded = new Map<string, string>();
		for (const [key, field] of instance.fields) {
			if (!field.locked) continue;
			decoded.set(key, await decodeKey(field.stored, passphrase, this.cryptoImpl));
		}

		const result: Record<string, string> = {};
		for (const [key, plaintext] of decoded) {
			const field = this.field(instanceId, key);
			field.plaintext = plaintext;
			field.encodedFrom = plaintext;
			field.locked = false;
			result[key] = plaintext;
		}
		instance.passphrase = passphrase;
		return result;
	}

	/** The passphrase to encrypt with on the next write. */
	setPassphrase(instanceId: string, passphrase: string): void {
		this.instance(instanceId).passphrase = passphrase;
	}

	/**
	 * True when this session can already encrypt for this instance.
	 *
	 * The caller asks before a write in passphrase mode: without one, `forDisk`
	 * refuses, and the credential would be lost with only a Notice to say so.
	 */
	hasPassphrase(instanceId: string): boolean {
		const instance = this.instances.get(instanceId);
		return instance !== undefined && instance.passphrase !== null;
	}

	/**
	 * The value to write for one secret.
	 *
	 * Encoding happens once per change, not once per save: every settings edit
	 * writes the whole file, PBKDF2 is deliberately slow, and there is now one
	 * key per provider. Without this, renaming a profile would re-derive them all.
	 */
	async forDisk(instanceId: string, key: string, mode: KeyStorage): Promise<string> {
		const field = this.field(instanceId, key);
		const unchanged =
			field.plaintext === field.encodedFrom && storedKeyMode(field.stored) === mode;
		if (unchanged && !field.locked) return field.stored;

		field.stored = await nextStoredKey(
			{
				stored: field.stored,
				plaintext: field.plaintext,
				mode,
				passphrase: this.instance(instanceId).passphrase,
				locked: field.locked,
			},
			this.cryptoImpl,
		);
		field.encodedFrom = field.plaintext;
		return field.stored;
	}

	/** Drop every secret of a deleted provider, including its session passphrase. */
	forget(instanceId: string): void {
		this.instances.delete(instanceId);
	}

	private instance(instanceId: string): InstanceSecrets {
		const existing = this.instances.get(instanceId);
		if (existing) return existing;

		const created: InstanceSecrets = { passphrase: null, fields: new Map() };
		this.instances.set(instanceId, created);
		return created;
	}

	private field(instanceId: string, key: string): FieldSecret {
		const instance = this.instance(instanceId);
		const existing = instance.fields.get(key);
		if (existing) return existing;

		const created = emptyField();
		instance.fields.set(key, created);
		return created;
	}
}
