"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
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
import { StrategySelect, StrategyOption } from "./StrategySelect";
import { useUserContext } from "@app/hooks/useUserContext";

type LicenseChoice = "business" | "personal";

/**
 * The website's self-hosted pricing calculator, with the buyer's email and
 * org filled in: checkout locks the email to this account and the webhook
 * links the new key to this org.
 */
export function buyLicenseUrl(orgId: string, email?: string | null): string {
    const params = new URLSearchParams({ org_id: orgId });
    if (email) {
        params.set("email", email);
    }
    // return `https://pangolin.net/pricing?${params.toString()}#Self-Hosted`;
    return `http://localhost:3006/pricing?${params.toString()}#Self-Hosted`;
}

type NewLicenseKeyCredenzaProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    orgId: string;
    onChoosePersonal: () => void;
};

/** "Get a license key": buy a Business license on the website, or a free personal key. */
export default function NewLicenseKeyCredenza({
    open,
    setOpen,
    orgId,
    onChoosePersonal
}: NewLicenseKeyCredenzaProps) {
    const t = useTranslations();
    const { user } = useUserContext();
    const [choice, setChoice] = useState<LicenseChoice>("business");
    // Second step for Business: explain the redirect before leaving
    const [confirmingRedirect, setConfirmingRedirect] = useState(false);

    useEffect(() => {
        if (open) {
            setChoice("business");
            setConfirmingRedirect(false);
        }
    }, [open]);

    const options: StrategyOption<LicenseChoice>[] = [
        {
            id: "business",
            title: t("newLicenseKeyBusinessTitle"),
            description: t("newLicenseKeyBusinessDescription")
        },
        {
            id: "personal",
            title: t("newLicenseKeyPersonalTitle"),
            description: t("newLicenseKeyPersonalDescription")
        }
    ];

    function onContinue() {
        if (choice === "business") {
            setConfirmingRedirect(true);
            return;
        }
        setOpen(false);
        onChoosePersonal();
    }

    function onRedirect() {
        window.open(
            buyLicenseUrl(orgId, user?.email),
            "_blank",
            "noopener,noreferrer"
        );
        setOpen(false);
    }

    if (confirmingRedirect) {
        return (
            <Credenza open={open} onOpenChange={setOpen}>
                <CredenzaContent>
                    <CredenzaHeader>
                        <CredenzaTitle>
                            {t("newLicenseKeyRedirectTitle")}
                        </CredenzaTitle>
                        <CredenzaDescription>
                            {t("newLicenseKeyRedirectDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        <div className="space-y-3 text-sm">
                            <p>{t("newLicenseKeyRedirectLinkedTop")}</p>
                            <p>
                                {user?.email
                                    ? t("newLicenseKeyRedirectLinked", {
                                          email: user.email
                                      })
                                    : t("newLicenseKeyRedirectLinkedNoEmail")}
                            </p>
                            <p className="text-muted-foreground">
                                {t("newLicenseKeyRedirectManage")}
                            </p>
                        </div>
                    </CredenzaBody>
                    <CredenzaFooter>
                        <Button
                            variant="outline"
                            onClick={() => setConfirmingRedirect(false)}
                        >
                            {t("licenseEditBack")}
                        </Button>
                        <Button onClick={onRedirect}>
                            {t("newLicenseKeyBuyOnWebsite")}
                            <ExternalLink className="ml-2 h-4 w-4" />
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>
        );
    }

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{t("newLicenseKeyTitle")}</CredenzaTitle>
                    <CredenzaDescription>
                        {t("newLicenseKeyDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <StrategySelect
                        options={options}
                        value={choice}
                        onChange={setChoice}
                        idPrefix="new-license-key"
                    />
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button variant="outline">{t("cancel")}</Button>
                    </CredenzaClose>
                    <Button onClick={onContinue}>
                        {t("newLicenseKeyContinue")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
