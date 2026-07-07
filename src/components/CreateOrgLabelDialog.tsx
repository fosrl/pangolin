"use client";

import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { CreateOrEditLabelResponse } from "@server/routers/labels/types";
import type { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "./Credenza";
import { OrgLabelForm } from "./OrgLabelForm";
import { PaidFeaturesAlert } from "./PaidFeaturesAlert";
import { Button } from "./ui/button";

export type CreateOrgLabelDialogProps = {
    open: boolean;
    setOpen: (val: boolean) => void;
    orgId: string;
    onSuccess?: () => void;
};

export function CreateOrgLabelDialog({
    open,
    setOpen,
    orgId,
    onSuccess
}: CreateOrgLabelDialogProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const { isPaidUser } = usePaidStatus();
    const canManageLabels = isPaidUser(tierMatrix.labels);
    const [isSubmitting, startTransition] = useTransition();

    async function createOrgLabel(data: { name: string; color: string }) {
        try {
            const res = await api.post<
                AxiosResponse<CreateOrEditLabelResponse>
            >(`/org/${orgId}/labels`, data);

            if (res.status === 201) {
                setOpen(false);
                onSuccess?.();

                toast({
                    title: t("success"),
                    description: t("labelCreateSuccessMessage")
                });
            }
        } catch (e: any) {
            if (e.response?.status === 409) {
                toast({
                    title: t("labelDuplicateError"),
                    description: t("labelDuplicateErrorDescription"),
                    variant: "destructive"
                });
            } else {
                toast({
                    title: t("error"),
                    description: formatAxiosError(e, t("errorOccurred")),
                    variant: "destructive"
                });
            }
        }
    }

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent className="md:max-w-md">
                <CredenzaHeader>
                    <CredenzaTitle>{t("createLabelDialogTitle")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("createLabelDialogDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <PaidFeaturesAlert tiers={tierMatrix.labels} />
                    <OrgLabelForm
                        disabled={!canManageLabels}
                        onSubmit={(data) => {
                            if (!canManageLabels) return;
                            startTransition(async () => createOrgLabel(data));
                        }}
                    />
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button
                            variant="outline"
                            onClick={() => setOpen(false)}
                            disabled={isSubmitting}
                        >
                            {t("cancel")}
                        </Button>
                    </CredenzaClose>
                    <Button
                        type="submit"
                        form="org-label-form"
                        disabled={isSubmitting || !canManageLabels}
                        loading={isSubmitting}
                    >
                        {t("labelCreate")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
