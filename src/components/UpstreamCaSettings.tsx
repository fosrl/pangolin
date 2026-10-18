"use client";

import { Button } from "@app/components/ui/button";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

const MAX_PEM_BYTES = 100_000;

type GetUpstreamCaResponse = {
    data: { certificatePem: string | null };
};

export default function UpstreamCaSettings({
    resourceId
}: {
    resourceId: number;
}) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [busy, setBusy] = useState<"upload" | "delete" | null>(null);
    const [removeOpen, setRemoveOpen] = useState(false);

    const queryKey = ["resourceUpstreamCa", resourceId] as const;
    const {
        data: certificatePem,
        isPending,
        isError,
        refetch
    } = useQuery({
        queryKey,
        queryFn: async ({ signal }) => {
            const response = await api.get<GetUpstreamCaResponse>(
                `/resource/${resourceId}/upstream-ca`,
                { signal }
            );
            return response.data.data.certificatePem;
        }
    });

    const configured = Boolean(certificatePem?.trim());

    function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;

        if (file.size > MAX_PEM_BYTES) {
            setSelectedFile(null);
            toast({
                variant: "destructive",
                title: t("upstreamCaSaveError"),
                description: t("upstreamCaTooLarge")
            });
            return;
        }

        setSelectedFile(file);
    }

    async function uploadCa() {
        if (!selectedFile || busy) return;
        setBusy("upload");
        try {
            const certificatePem = await selectedFile.text();
            if (
                !certificatePem.trim() ||
                /-----BEGIN [^-]*PRIVATE KEY-----/.test(certificatePem)
            ) {
                toast({
                    variant: "destructive",
                    title: t("upstreamCaSaveError"),
                    description: t("upstreamCaInvalidFile")
                });
                return;
            }

            await api.put(`/resource/${resourceId}/upstream-ca`, {
                certificatePem
            });
            await queryClient.invalidateQueries({ queryKey });
            setSelectedFile(null);
            toast({ title: t("upstreamCaSaved") });
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("upstreamCaSaveError"),
                description: formatAxiosError(error, t("upstreamCaSaveError"))
            });
        } finally {
            setBusy(null);
        }
    }

    async function removeCa() {
        if (busy) return;
        setBusy("delete");
        try {
            await api.delete(`/resource/${resourceId}/upstream-ca`);
            await queryClient.invalidateQueries({ queryKey });
            setRemoveOpen(false);
            setSelectedFile(null);
            toast({ title: t("upstreamCaRemoved") });
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("upstreamCaDeleteError"),
                description: formatAxiosError(error, t("upstreamCaDeleteError"))
            });
        } finally {
            setBusy(null);
        }
    }

    return (
        <>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("upstreamCaTitle")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("upstreamCaDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <div className="max-w-3xl space-y-4">
                        {isPending ? (
                            <p className="text-sm text-muted-foreground">
                                {t("upstreamCaLoading")}
                            </p>
                        ) : isError ? (
                            <div className="space-y-2">
                                <p className="text-sm text-destructive">
                                    {t("upstreamCaLoadError")}
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void refetch()}
                                >
                                    {t("upstreamCaRetry")}
                                </Button>
                            </div>
                        ) : (
                            <p
                                className="text-sm text-muted-foreground"
                                role="status"
                            >
                                {configured
                                    ? t("upstreamCaConfigured")
                                    : t("upstreamCaNotConfigured")}
                            </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                            {t("upstreamCaOnlyWhenVerified")}
                        </p>
                        <input
                            ref={inputRef}
                            type="file"
                            accept=".pem,.crt,.cer,.ca-bundle"
                            className="sr-only"
                            aria-label={t("upstreamCaSelectFile")}
                            onChange={onFileSelected}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            disabled={Boolean(busy) || isPending || isError}
                            onClick={() => inputRef.current?.click()}
                        >
                            {t("upstreamCaSelectFile")}
                        </Button>
                        {selectedFile && (
                            <p className="text-sm break-all">
                                {t("upstreamCaSelectedFile")}{" "}
                                {selectedFile.name}
                            </p>
                        )}
                    </div>
                </SettingsSectionBody>
                <SettingsSectionFooter>
                    {configured && (
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={Boolean(busy) || isPending || isError}
                            onClick={() => setRemoveOpen(true)}
                        >
                            {t("upstreamCaRemove")}
                        </Button>
                    )}
                    <Button
                        type="button"
                        loading={busy === "upload"}
                        disabled={
                            !selectedFile ||
                            Boolean(busy) ||
                            isPending ||
                            isError
                        }
                        onClick={() => void uploadCa()}
                    >
                        {configured
                            ? t("upstreamCaReplace")
                            : t("upstreamCaUpload")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>

            <Credenza open={removeOpen} onOpenChange={setRemoveOpen}>
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("upstreamCaRemoveConfirmTitle")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("upstreamCaRemoveConfirmDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        <p className="text-sm text-muted-foreground">
                            {t("upstreamCaOnlyWhenVerified")}
                        </p>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <CredenzaClose asChild>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={Boolean(busy)}
                            >
                                {t("close")}
                            </Button>
                        </CredenzaClose>
                        <Button
                            type="button"
                            variant="destructive"
                            loading={busy === "delete"}
                            disabled={Boolean(busy)}
                            onClick={() => void removeCa()}
                        >
                            {t("upstreamCaRemove")}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        </>
    );
}
