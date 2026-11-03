import type { FieldValues, UseFormSetValue } from "react-hook-form";

export type IdpOidcProviderType = "oidc" | "google" | "azure";

export function applyOidcIdpProviderType<T extends FieldValues>(
    setValue: UseFormSetValue<T>,
    provider: IdpOidcProviderType
): void {
    setValue("type" as never, provider as never);

    if (provider === "google") {
        setValue(
            "authUrl" as never,
            "https://accounts.google.com/o/oauth2/v2/auth" as never
        );
        setValue(
            "tokenUrl" as never,
            "https://oauth2.googleapis.com/token" as never
        );
        setValue("usernamePath" as never, "email" as never);
        setValue("externalIdPath" as never, "sub" as never);
        setValue("emailPath" as never, "email" as never);
        setValue("namePath" as never, "name" as never);
        setValue("scopes" as never, "openid profile email" as never);
    } else if (provider === "azure") {
        setValue(
            "authUrl" as never,
            "https://login.microsoftonline.com/{{TENANT_ID}}/oauth2/v2.0/authorize" as never
        );
        setValue(
            "tokenUrl" as never,
            "https://login.microsoftonline.com/{{TENANT_ID}}/oauth2/v2.0/token" as never
        );
        setValue("usernamePath" as never, "email" as never);
        setValue("externalIdPath" as never, "oid" as never);
        setValue("emailPath" as never, "email" as never);
        setValue("namePath" as never, "name" as never);
        setValue("scopes" as never, "openid profile email" as never);
        setValue("tenantId" as never, "" as never);
    } else {
        setValue("authUrl" as never, "" as never);
        setValue("tokenUrl" as never, "" as never);
        setValue("usernamePath" as never, "sub" as never);
        setValue("externalIdPath" as never, "sub" as never);
        setValue("namePath" as never, "name" as never);
        setValue("emailPath" as never, "email" as never);
        setValue("scopes" as never, "openid profile email" as never);
    }
}
