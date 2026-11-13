import { z } from "zod";

// Provider-specific credentials for the IdP API integration, stored encrypted in
// `idp.apiConfig`. Variants missing from `idpAPIConfigSchemas`
// reuse the OIDC client credentials.

export type IDPAPIVariant = "oidc" | "google" | "azure";

export const googleServiceAccountKeySchema = z.object({
    type: z.literal("service_account"),
    client_email: z.email(),
    private_key: z.string().includes("PRIVATE KEY"),
    token_uri: z.url()
});

export const googleIDPAPIConfigSchema = z.strictObject({
    serviceAccountKey: googleServiceAccountKeySchema,
    /** Admin to impersonate with domain-wide delegation, omitted when the service account has an admin role. */
    adminEmail: z.email().optional(),
    /** Workspace customer ID, defaults to `my_customer` when omitted. */
    customerId: z.string().nonempty().optional()
});

export type GoogleIDPAPIConfig = z.output<
    typeof googleIDPAPIConfigSchema
>;

export const idpAPIConfigSchemas = {
    google: googleIDPAPIConfigSchema
} satisfies Partial<Record<IDPAPIVariant, z.ZodType>>;

export function variantRequiresIDPAPIConfig(
    variant: IDPAPIVariant
): variant is keyof typeof idpAPIConfigSchemas {
    return variant in idpAPIConfigSchemas;
}

/** Non-secret view of the stored config, safe to send to the browser. */
export type RedactedIDPAPIConfig = {
    serviceAccountEmail?: string;
    adminEmail?: string;
    customerId?: string;
};

export function redactIDPAPIConfig(
    variant: IDPAPIVariant,
    config: unknown
): RedactedIDPAPIConfig | null {
    if (variant === "google") {
        const parsed = googleIDPAPIConfigSchema.safeParse(config);
        if (!parsed.success) return null;
        return {
            serviceAccountEmail: parsed.data.serviceAccountKey.client_email,
            adminEmail: parsed.data.adminEmail,
            customerId: parsed.data.customerId
        };
    }
    return null;
}

/** Parse the pasted service account JSON key, returns `null` when invalid. */
export function parseGoogleServiceAccountKey(raw: string) {
    try {
        const parsed = googleServiceAccountKeySchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}
