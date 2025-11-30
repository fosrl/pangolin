"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
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
import ChangePasswordForm from "@app/components/ChangePasswordForm";
import { useTranslations } from "next-intl";

type ChangePasswordDialogProps = {
    open: boolean;
    setOpen: (val: boolean) => void;
};

export default function ChangePasswordDialog({ open, setOpen }: ChangePasswordDialogProps) {
    const t = useTranslations();
    const [currentStep, setCurrentStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const formRef = useRef<{ handleSubmit: () => void }>(null);

    function reset() {
        setCurrentStep(1);
        setLoading(false);
    }

    const handleSubmit = () => {
        if (formRef.current) {
            formRef.current.handleSubmit();
        }
    };

    return (
        <Credenza
            open={open}
            onOpenChange={(val) => {
                setOpen(val);
                reset();
            }}
        >
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>
                        {t('changePassword')}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {t('changePasswordDescription')}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <ChangePasswordForm
                        ref={formRef}
                        isDialog={true}
                        submitButtonText={t('submit')}
                        cancelButtonText="Close"
                        showCancelButton={false}
                        onComplete={() => setOpen(false)}
                        onStepChange={setCurrentStep}
                        onLoadingChange={setLoading}
                    />
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">Close</Button>
                    </CredenzaClose>
                    {(currentStep === 1 || currentStep === 2) && (
                        <Button
                            type="button"
                            loading={loading}
                            disabled={loading}
                            onClick={handleSubmit}
                        >
                            {t('submit')}
                        </Button>
                    )}
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
