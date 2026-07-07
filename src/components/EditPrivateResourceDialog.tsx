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
import { resourceQueries } from "@app/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
    cleanForFQDN,
    PrivateResourceForm,
    type InternalResourceData,
    type InternalResourceFormValues,
    isHostname
} from "./PrivateResourceForm";

type EditInternalResourceDialogProps = {
    open: boolean;
    setOpen: (val: boolean) => void;
    resource: InternalResourceData;
    orgId: string;
    onSuccess?: () => void;
};

export default function EditPrivateResourceDialog({
    open,
    setOpen,
    resource,
    orgId,
    onSuccess
}: EditInternalResourceDialogProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const queryClient = useQueryClient();
    const [isSubmitting, startTransition] = useTransition();
    const [isHttpModeDisabled, setIsHttpModeDisabled] = useState(false);

    async function handleSubmit(values: InternalResourceFormValues) {
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

            await api.post(`/site-resource/${resource.id}`, {
                name: data.name,
                siteIds: data.siteIds,
                mode: data.mode,
                niceId: data.niceId,
                destination: data.destination ?? undefined,
                ...(data.mode === "http" && {
                    scheme: data.scheme,
                    ssl: data.ssl ?? false,
                    destinationPort: data.destinationPort ?? null,
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
                            : null,
                    ...(data.authDaemonMode != null && {
                        authDaemonMode: data.authDaemonMode
                    }),
                    ...(data.authDaemonMode === "remote" && {
                        authDaemonPort: data.authDaemonPort || null
                    })
                }),
                ...(data.mode === "ssh" && {
                    alias:
                        data.alias &&
                        typeof data.alias === "string" &&
                        data.alias.trim()
                            ? data.alias
                            : null,
                    destinationPort: data.destinationPort ?? null,
                    pamMode: data.pamMode ?? undefined,
                    ...(data.authDaemonMode != null && {
                        authDaemonMode: data.authDaemonMode
                    }),
                    ...(data.authDaemonMode === "remote" && {
                        authDaemonPort: data.authDaemonPort || null
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
                roleIds: (data.roles || []).map((r) => parseInt(r.id)),
                userIds: (data.users || []).map((u) => u.id),
                clientIds: (data.clients || []).map((c) => parseInt(c.id))
            });

            await queryClient.invalidateQueries(
                resourceQueries.siteResourceRoles({
                    siteResourceId: resource.id
                })
            );
            await queryClient.invalidateQueries(
                resourceQueries.siteResourceUsers({
                    siteResourceId: resource.id
                })
            );
            await queryClient.invalidateQueries(
                resourceQueries.siteResourceClients({
                    siteResourceId: resource.id
                })
            );

            toast({
                title: t("editInternalResourceDialogSuccess"),
                description: t(
                    "editInternalResourceDialogInternalResourceUpdatedSuccessfully"
                ),
                variant: "default"
            });
            setOpen(false);
            onSuccess?.();
        } catch (error) {
            toast({
                title: t("editInternalResourceDialogError"),
                description: formatAxiosError(
                    error,
                    t(
                        "editInternalResourceDialogFailedToUpdateInternalResource"
                    )
                ),
                variant: "destructive"
            });
        }
    }

    return (
        <Credenza
            open={open}
            onOpenChange={(isOpen) => {
                if (!isOpen) setOpen(false);
            }}
        >
            <CredenzaContent className="max-w-3xl">
                <CredenzaHeader>
                    <CredenzaTitle>
                        {t("editInternalResourceDialogEditClientResource")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {t(
                            "editInternalResourceDialogUpdateResourceProperties",
                            {
                                resourceName: resource.name
                            }
                        )}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <PrivateResourceForm
                        variant="edit"
                        open={open}
                        resource={resource}
                        orgId={orgId}
                        siteResourceId={resource.id}
                        formId="edit-internal-resource-form"
                        onSubmit={(values) =>
                            startTransition(() => handleSubmit(values))
                        }
                        onSubmitDisabledChange={setIsHttpModeDisabled}
                    />
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button
                            variant="outline"
                            onClick={() => setOpen(false)}
                            disabled={isSubmitting}
                        >
                            {t("editInternalResourceDialogCancel")}
                        </Button>
                    </CredenzaClose>
                    <Button
                        type="submit"
                        form="edit-internal-resource-form"
                        disabled={isSubmitting || isHttpModeDisabled}
                        loading={isSubmitting}
                    >
                        {t("editInternalResourceDialogSaveResource")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
