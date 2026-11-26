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
import { parseGoogleServiceAccountKey } from "@app/lib/idpApiConfig";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription } from "./ui/alert";

export type GoogleDirectorySyncFormValues = {
    googleServiceAccountKey?: string;
    /** Remove the stored key on save (edit pages). A new key in the field replaces it anyway. */
    googleRemoveServiceAccountKey?: boolean;
    googleAdminEmail?: string;
    googleCustomerId?: string;
};

export const googleDirectorySyncFormFields = {
    googleServiceAccountKey: z.string().optional(),
    googleRemoveServiceAccountKey: z.boolean().optional(),
    googleAdminEmail: z.string().optional(),
    googleCustomerId: z.string().optional()
};

/** `superRefine` body for forms including `googleDirectorySyncFormFields`. */
export function refineGoogleDirectorySyncFields(
    data: GoogleDirectorySyncFormValues & { apiIntegrationEnabled?: boolean },
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
    } else if (
        data.apiIntegrationEnabled &&
        // a removed key must be replaced while the integration stays on
        (keyRequired || data.googleRemoveServiceAccountKey)
    ) {
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

/**
 * API `apiConfig` payload. On update, an omitted key keeps the stored one and a
 * `null` key removes it (which clears the stored config).
 */
export function buildGoogleIDPAPIConfig(data: GoogleDirectorySyncFormValues) {
    const rawKey = data.googleServiceAccountKey?.trim();
    return {
        serviceAccountKey: rawKey
            ? (parseGoogleServiceAccountKey(rawKey) ?? undefined)
            : data.googleRemoveServiceAccountKey
              ? null
              : undefined,
        adminEmail: data.googleAdminEmail?.trim() || undefined,
        customerId: data.googleCustomerId?.trim() || undefined
    };
}

type GoogleIDPAPIConfigFieldsProps = {
    /** Service account of the stored key, the key field becomes optional when set. */
    configuredServiceAccountEmail?: string;
};

// Must be rendered inside the `<Form>` of a form with `GoogleDirectorySyncFormValues` fields.
export default function GoogleIDPAPIConfigFields({
    configuredServiceAccountEmail
}: GoogleIDPAPIConfigFieldsProps) {
    const t = useTranslations();
    const form = useFormContext<GoogleDirectorySyncFormValues>();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const removeKey = useWatch({
        control: form.control,
        name: "googleRemoveServiceAccountKey"
    });
    // a saved key hides the input until "Replace" (or "Remove", to paste another)
    const [replacing, setReplacing] = useState(false);
    useEffect(() => {
        // saved (or removed): back to the notice
        setReplacing(false);
    }, [configuredServiceAccountEmail]);
    const showKeyInput =
        !configuredServiceAccountEmail || replacing || Boolean(removeKey);

    function setRemoveKey(remove: boolean) {
        form.setValue("googleRemoveServiceAccountKey", remove, {
            shouldValidate: true
        });
        if (!remove) {
            form.setValue("googleServiceAccountKey", "");
            form.clearErrors("googleServiceAccountKey");
        }
    }

    function cancelReplace() {
        setReplacing(false);
        form.setValue("googleServiceAccountKey", "");
        form.clearErrors("googleServiceAccountKey");
    }

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
                            {showKeyInput && (
                                <div className="flex gap-2">
                                    {replacing && !removeKey && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={cancelReplace}
                                        >
                                            {t("cancel")}
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            fileInputRef.current?.click()
                                        }
                                    >
                                        {t("idpGoogleServiceAccountKeyUpload")}
                                    </Button>
                                </div>
                            )}
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

                        {configuredServiceAccountEmail &&
                            (removeKey ? (
                                <Alert variant="warning">
                                    <AlertDescription className="flex items-center justify-between gap-3">
                                        <span>
                                            {t(
                                                "idpGoogleServiceAccountKeyRemoved"
                                            )}
                                        </span>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setRemoveKey(false)}
                                        >
                                            {t(
                                                "idpGoogleServiceAccountKeyUndoRemove"
                                            )}
                                        </Button>
                                    </AlertDescription>
                                </Alert>
                            ) : (
                                <Alert>
                                    <InfoIcon className="h-4 w-4" />
                                    <AlertDescription className="flex items-center justify-between gap-3">
                                        <span>
                                            {t.rich(
                                                replacing
                                                    ? "idpGoogleServiceAccountKeyReplacing"
                                                    : "idpGoogleServiceAccountKeyConfigured",
                                                {
                                                    email: configuredServiceAccountEmail,
                                                    em: (children) => (
                                                        <strong className="text-primary font-medium">
                                                            {children}
                                                        </strong>
                                                    )
                                                }
                                            )}
                                        </span>
                                        {!replacing && (
                                            <div className="flex flex-none gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        setReplacing(true)
                                                    }
                                                >
                                                    {t(
                                                        "idpGoogleServiceAccountKeyReplace"
                                                    )}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        setRemoveKey(true)
                                                    }
                                                >
                                                    {t(
                                                        "idpGoogleServiceAccountKeyRemove"
                                                    )}
                                                </Button>
                                            </div>
                                        )}
                                    </AlertDescription>
                                </Alert>
                            ))}

                        {showKeyInput && (
                            <>
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
                            </>
                        )}

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
