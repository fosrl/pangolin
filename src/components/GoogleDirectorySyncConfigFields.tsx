"use client";

import { Button } from "@app/components/ui/button";
import {
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { Textarea } from "@app/components/ui/textarea";
import { parseGoogleServiceAccountKey } from "@app/lib/idpDirectorySyncConfig";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { useFormContext } from "react-hook-form";
import { z, type email } from "zod";

export type GoogleDirectorySyncFormValues = {
    googleServiceAccountKey?: string;
    googleAdminEmail?: string;
    googleCustomerId?: string;
};

export const googleDirectorySyncFormFields = {
    googleServiceAccountKey: z.string().optional(),
    googleAdminEmail: z.string().optional(),
    googleCustomerId: z.string().optional()
};

/** `superRefine` body for forms including `googleDirectorySyncFormFields`. */
export function refineGoogleDirectorySyncFields(
    data: GoogleDirectorySyncFormValues & { directorySyncEnabled?: boolean },
    ctx: z.RefinementCtx,
    {
        keyRequired,
        t
    }: { keyRequired: boolean; t: ReturnType<typeof useTranslations> }
) {
    const rawKey = data.googleServiceAccountKey?.trim();
    if (rawKey) {
        if (!parseGoogleServiceAccountKey(rawKey)) {
            ctx.addIssue({
                code: "custom",
                path: ["googleServiceAccountKey"],
                message: t("idpGoogleServiceAccountKeyInvalid")
            });
        }
    } else if (data.directorySyncEnabled && keyRequired) {
        ctx.addIssue({
            code: "custom",
            path: ["googleServiceAccountKey"],
            message: t("idpGoogleServiceAccountKeyRequired")
        });
    }

    const adminEmail = data.googleAdminEmail?.trim();
    if (adminEmail && !z.email().safeParse(adminEmail).success) {
        ctx.addIssue({
            code: "custom",
            path: ["googleAdminEmail"],
            message: t("emailInvalid")
        });
    }
}

/** API `directorySyncConfig` payload, an omitted key keeps the stored one on update. */
export function buildGoogleDirectorySyncConfig(
    data: GoogleDirectorySyncFormValues
) {
    const rawKey = data.googleServiceAccountKey?.trim();
    return {
        serviceAccountKey: rawKey
            ? (parseGoogleServiceAccountKey(rawKey) ?? undefined)
            : undefined,
        adminEmail: data.googleAdminEmail?.trim() || undefined,
        customerId: data.googleCustomerId?.trim() || undefined
    };
}

type GoogleDirectorySyncConfigFieldsProps = {
    /** Service account of the stored key, the key field becomes optional when set. */
    configuredServiceAccountEmail?: string;
};

// Must be rendered inside the `<Form>` of a form with `GoogleDirectorySyncFormValues` fields.
export default function GoogleDirectorySyncConfigFields({
    configuredServiceAccountEmail
}: GoogleDirectorySyncConfigFieldsProps) {
    const t = useTranslations();
    const form = useFormContext<GoogleDirectorySyncFormValues>();
    const fileInputRef = useRef<HTMLInputElement>(null);

    return (
        <div className="space-y-4">
            <FormField
                control={form.control}
                name="googleServiceAccountKey"
                render={({ field }) => (
                    <FormItem>
                        <div className="flex items-center justify-between">
                            <FormLabel>
                                {t("idpGoogleServiceAccountKey")}
                            </FormLabel>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {t("idpGoogleServiceAccountKeyUpload")}
                            </Button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/json,.json"
                                className="hidden"
                                onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = "";
                                    if (!file) return;
                                    form.setValue(
                                        "googleServiceAccountKey",
                                        await file.text(),
                                        { shouldValidate: true }
                                    );
                                }}
                            />
                        </div>

                        {configuredServiceAccountEmail && (
                            <small className="text-muted-foreground">
                                {t.rich(
                                    "idpGoogleServiceAccountKeyConfigured",
                                    {
                                        email: configuredServiceAccountEmail,
                                        em: (children) => (
                                            <em className="text-primary">
                                                {children}
                                            </em>
                                        )
                                    }
                                )}
                            </small>
                        )}

                        <FormControl>
                            <Textarea
                                {...field}
                                value={field.value ?? ""}
                                rows={6}
                                className="font-mono text-xs"
                                placeholder='{ "type": "service_account", ... }'
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </FormControl>
                        <FormDescription>
                            {t("idpGoogleServiceAccountKeyDescription")}
                        </FormDescription>

                        <FormMessage />
                    </FormItem>
                )}
            />

            <FormField
                control={form.control}
                name="googleAdminEmail"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t("idpGoogleAdminEmail")}</FormLabel>
                        <FormControl>
                            <Input
                                {...field}
                                value={field.value ?? ""}
                                type="email"
                            />
                        </FormControl>
                        <FormDescription>
                            {t("idpGoogleAdminEmailDescription")}
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />

            <FormField
                control={form.control}
                name="googleCustomerId"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t("idpGoogleCustomerId")}</FormLabel>
                        <FormControl>
                            <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormDescription>
                            {t("idpGoogleCustomerIdDescription")}
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </div>
    );
}
