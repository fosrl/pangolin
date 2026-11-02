import { z } from "zod";

// Provider-specific credentials for directory sync, stored encrypted in
// `idp.directorySyncConfig`. Variants missing from `directorySyncConfigSchemas`
// reuse the OIDC client credentials.

export type DirectorySyncVariant = "oidc" | "google" | "azure";

export const googleServiceAccountKeySchema = z.object({
    type: z.literal("service_account"),
    client_email: z.email(),
    private_key: z.string().includes("PRIVATE KEY"),
    token_uri: z.url()
});

export const googleDirectorySyncConfigSchema = z.strictObject({
    serviceAccountKey: googleServiceAccountKeySchema,
    /** Admin to impersonate with domain-wide delegation, omitted when the service account has an admin role. */
    adminEmail: z.email().optional(),
    /** Workspace customer ID, defaults to `my_customer` when omitted. */
    customerId: z.string().nonempty().optional()
});

export type GoogleDirectorySyncConfig = z.output<
    typeof googleDirectorySyncConfigSchema
>;

export const directorySyncConfigSchemas = {
    google: googleDirectorySyncConfigSchema
} satisfies Partial<Record<DirectorySyncVariant, z.ZodType>>;

export function variantRequiresDirectorySyncConfig(
    variant: DirectorySyncVariant
): variant is keyof typeof directorySyncConfigSchemas {
    return variant in directorySyncConfigSchemas;
}

/** Non-secret view of the stored config, safe to send to the browser. */
export type RedactedDirectorySyncConfig = {
    serviceAccountEmail?: string;
    adminEmail?: string;
    customerId?: string;
};

export function redactDirectorySyncConfig(
    variant: DirectorySyncVariant,
    config: unknown
): RedactedDirectorySyncConfig | null {
    if (variant === "google") {
        const parsed = googleDirectorySyncConfigSchema.safeParse(config);
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
