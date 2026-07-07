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

export type EditOrgLabelDialogProps = {
    open: boolean;
    setOpen: (val: boolean) => void;
    orgId: string;
    onSuccess?: () => void;
    label: {
        name: string;
        color: string;
        labelId: number;
    };
};

export function EditOrgLabelDialog({
    open,
    setOpen,
    orgId,
    onSuccess,
    label
}: EditOrgLabelDialogProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const { isPaidUser } = usePaidStatus();
    const canManageLabels = isPaidUser(tierMatrix.labels);
    const [isSubmitting, startTransition] = useTransition();

    async function editOrgLabel(data: { name: string; color: string }) {
        try {
            const res = await api.patch<
                AxiosResponse<CreateOrEditLabelResponse>
            >(`/org/${orgId}/label/${label.labelId}`, data);

            if (res.status === 200) {
                setOpen(false);
                onSuccess?.();

                toast({
                    title: t("success"),
                    description: t("labelEditSuccessMessage")
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
                    <CredenzaTitle>{t("editLabelDialogTitle")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("editLabelDialogDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <PaidFeaturesAlert tiers={tierMatrix.labels} />
                    <OrgLabelForm
                        disabled={!canManageLabels}
                        defaultValue={label}
                        onSubmit={(data) => {
                            if (!canManageLabels) return;
                            startTransition(async () => editOrgLabel(data));
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
                        {t("labelEdit")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
