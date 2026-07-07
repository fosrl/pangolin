"use client";

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
import { Button } from "@app/components/ui/button";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
    cleanForFQDN,
    PrivateResourceForm,
    isHostname,
    type InternalResourceFormValues
} from "./PrivateResourceForm";
import type { Selectedsite } from "./site-selector";

type CreateInternalResourceDialogProps = {
    open: boolean;
    setOpen: (val: boolean) => void;
    orgId: string;
    onSuccess?: () => void;
    initialSites?: Selectedsite[];
};

export default function CreatePrivateResourceDialog({
    open,
    setOpen,
    orgId,
    onSuccess,
    initialSites
}: CreateInternalResourceDialogProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const [isHttpModeDisabled, setIsHttpModeDisabled] = useState(false);
    const [isSubmitting, startTransition] = useTransition();

    function handleSubmit(values: InternalResourceFormValues) {
        startTransition(async () => {
            try {
                let data = { ...values };
                if (
                    (data.mode === "host" ||
                        data.mode === "http" ||
                        data.mode === "ssh") &&
                    isHostname(data.destination)
                ) {
                    const currentAlias = data.alias?.trim() || "";
                    if (!currentAlias) {
                        let aliasValue = data.destination;
                        if (data.destination?.toLowerCase() === "localhost") {
                            aliasValue = `${cleanForFQDN(data.name)}.internal`;
                        }
                        data = { ...data, alias: aliasValue };
                    }
                }

                await api.put<
                    AxiosResponse<{ data: { siteResourceId: number } }>
                >(`/org/${orgId}/site-resource`, {
                    name: data.name,
                    siteIds: data.siteIds,
                    mode: data.mode,
                    destination: data.destination ?? undefined,
                    enabled: true,
                    ...(data.mode === "http" && {
                        scheme: data.scheme,
                        ssl: data.ssl ?? false,
                        destinationPort: data.destinationPort ?? undefined,
                        domainId: data.httpConfigDomainId
                            ? data.httpConfigDomainId
                            : undefined,
                        subdomain: data.httpConfigSubdomain
                            ? data.httpConfigSubdomain
                            : undefined
                    }),
                    ...(data.mode === "host" && {
                        alias:
                            data.alias &&
                            typeof data.alias === "string" &&
                            data.alias.trim()
                                ? data.alias
                                : undefined,
                        ...(data.authDaemonMode != null && {
                            authDaemonMode: data.authDaemonMode
                        }),
                        ...(data.authDaemonMode === "remote" &&
                            data.authDaemonPort != null && {
                                authDaemonPort: data.authDaemonPort
                            })
                    }),
                    ...(data.mode === "ssh" && {
                        alias:
                            data.alias &&
                            typeof data.alias === "string" &&
                            data.alias.trim()
                                ? data.alias
                                : undefined,
                        destinationPort: data.destinationPort ?? undefined,
                        pamMode: data.pamMode ?? undefined,
                        ...(data.authDaemonMode != null && {
                            authDaemonMode: data.authDaemonMode
                        }),
                        ...(data.authDaemonMode === "remote" &&
                            data.authDaemonPort != null && {
                                authDaemonPort: data.authDaemonPort
                            })
                    }),
                    ...((data.mode === "host" || data.mode === "cidr") && {
                        tcpPortRangeString: data.tcpPortRangeString,
                        udpPortRangeString: data.udpPortRangeString,
                        disableIcmp: data.disableIcmp ?? false
                    }),
                    ...(data.mode === "ssh" && {
                        disableIcmp: data.disableIcmp ?? false
                    }),
                    roleIds: data.roles
                        ? data.roles.map((r) => parseInt(r.id))
                        : [],
                    userIds: data.users ? data.users.map((u) => u.id) : [],
                    clientIds: data.clients
                        ? data.clients.map((c) => parseInt(c.id))
                        : []
                });

                toast({
                    title: t("createInternalResourceDialogSuccess"),
                    description: t(
                        "createInternalResourceDialogInternalResourceCreatedSuccessfully"
                    ),
                    variant: "default"
                });
                setOpen(false);
                onSuccess?.();
            } catch (error) {
                toast({
                    title: t("createInternalResourceDialogError"),
                    description: formatAxiosError(
                        error,
                        t(
                            "createInternalResourceDialogFailedToCreateInternalResource"
                        )
                    ),
                    variant: "destructive"
                });
            }
        });
    }

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent className="max-w-3xl">
                <CredenzaHeader>
                    <CredenzaTitle>
                        {t("createInternalResourceDialogCreateClientResource")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {t(
                            "createInternalResourceDialogCreateClientResourceDescription"
                        )}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <PrivateResourceForm
                        variant="create"
                        open={open}
                        orgId={orgId}
                        formId="create-internal-resource-form"
                        onSubmit={handleSubmit}
                        onSubmitDisabledChange={setIsHttpModeDisabled}
                        initialSites={initialSites}
                    />
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button
                            variant="outline"
                            onClick={() => setOpen(false)}
                            disabled={isSubmitting}
                        >
                            {t("createInternalResourceDialogCancel")}
                        </Button>
                    </CredenzaClose>
                    <Button
                        type="submit"
                        form="create-internal-resource-form"
                        disabled={isSubmitting || isHttpModeDisabled}
                        loading={isSubmitting}
                    >
                        {t("createInternalResourceDialogCreateResource")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
