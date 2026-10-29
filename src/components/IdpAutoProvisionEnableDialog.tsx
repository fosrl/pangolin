"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { useTranslations } from "next-intl";

type IdpAutoProvisionEnableDialogProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    onConfirm: () => Promise<void>;
};

export default function IdpAutoProvisionEnableDialog({
    open,
    setOpen,
    onConfirm
}: IdpAutoProvisionEnableDialogProps) {
    const t = useTranslations();

    return (
        <ConfirmDeleteDialog
            open={open}
            setOpen={setOpen}
            dialog={
                <div className="space-y-2">
                    <p>{t("idpAutoProvisionEnableDescription")}</p>
                    <p className="text-sm text-muted-foreground">
                        {t("idpAutoProvisionEnableWarningText")}
                    </p>
                </div>
            }
            buttonText={t("saveGeneralSettings")}
            onConfirm={onConfirm}
            string={t("idpAutoProvisionEnableConfirmMessage")}
            title={t("idpAutoProvisionEnableTitle")}
            warningText={t("idpAutoProvisionEnableWarningText")}
        />
    );
}
