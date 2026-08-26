/**
 * What each kind of speech engine needs before it can run.
 *
 * The table below is the single source of truth for a provider's credential
 * fields, so the settings screen renders any provider without naming one. A new
 * engine is one entry here, one adapter class, and one line in the composition
 * root.
 *
 * This module is a leaf on purpose: it imports nothing, so `settings/types.ts`
 * can name a provider type without a cycle.
 */

export const PROVIDER_TYPES = ["system", "azure"] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

/** One credential a provider type needs, and how to ask for it. */
export interface ProviderField {
	key: string;
	label: string;
	description: string;
	placeholder: string;
	/** Shown as a password input, and encoded at rest by `SecretVault`. */
	secret: boolean;
}

export interface ProviderTypeInfo {
	type: ProviderType;
	displayName: string;
	description: string;
	/** False for a singleton the user can neither add nor remove. */
	instantiable: boolean;
	fields: readonly ProviderField[];
}

/**
 * The one provider that is always present.
 *
 * The id is the literal type name rather than a UUID, so a profile written
 * before providers were a list migrates without a lookup, and a hand-edited
 * data.json stays readable.
 */
export const SYSTEM_PROVIDER_ID = "system";

/** The id the single Azure block of schema 2 becomes. Same reasoning. */
export const LEGACY_AZURE_PROVIDER_ID = "azure";

export const PROVIDER_TYPE_INFO: Record<ProviderType, ProviderTypeInfo> = {
	system: {
		type: "system",
		displayName: "System voices",
		description:
			"The voices installed on this device. Free and offline, and they play " +
			"but cannot be saved to a file.",
		instantiable: false,
		fields: [],
	},
	azure: {
		type: "azure",
		displayName: "Azure Speech",
		description:
			"High-quality neural voices with speaking styles. Needs a speech key " +
			"and a region from an Azure Speech resource.",
		instantiable: true,
		fields: [
			{
				key: "key",
				label: "Speech key",
				description: "From your Azure Speech resource's Keys and Endpoint page.",
				placeholder: "Enter your speech key",
				secret: true,
			},
			{
				key: "region",
				label: "Region",
				description: "The resource's region identifier, for example eastus.",
				placeholder: "eastus",
				secret: false,
			},
		],
	},
};

export function providerTypeInfo(type: ProviderType): ProviderTypeInfo {
	return PROVIDER_TYPE_INFO[type];
}

/** The types a user can add. `system` is excluded: exactly one always exists. */
export function instantiableTypes(): ProviderTypeInfo[] {
	return PROVIDER_TYPES.map(providerTypeInfo).filter((info) => info.instantiable);
}

/** The credential fields of a type that are written to disk encoded. */
export function secretFields(type: ProviderType): readonly ProviderField[] {
	return providerTypeInfo(type).fields.filter((field) => field.secret);
}

export function isProviderType(value: unknown): value is ProviderType {
	return PROVIDER_TYPES.includes(value as ProviderType);
}
