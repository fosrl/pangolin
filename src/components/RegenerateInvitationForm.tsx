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
import { useState, useEffect } from "react";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { toast } from "@app/hooks/useToast";
import CopyTextBox from "@app/components/CopyTextBox";
import { Checkbox } from "@app/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { Label } from "@app/components/ui/label";
import { useTranslations } from "next-intl";

type RegenerateInvitationFormProps = {
    open: boolean;
    setOpen: (open: boolean) => void;
    invitation: {
        id: string;
        email: string;
        roleIds: number[];
        roleLabels: string[];
    } | null;
    onRegenerate: (updatedInvitation: {
        id: string;
        email: string;
        expiresAt: string;
        roleLabels: string[];
        roleIds: number[];
    }) => void;
};

export default function RegenerateInvitationForm({
    open,
    setOpen,
    invitation,
    onRegenerate
}: RegenerateInvitationFormProps) {
    const [loading, setLoading] = useState(false);
    const [inviteLink, setInviteLink] = useState<string | null>(null);
    const [expiresInDays, setExpiresInDays] = useState(3);
    const { env } = useEnvContext();
    const [sendEmail, setSendEmail] = useState(env.email.emailEnabled);
    const [validHours, setValidHours] = useState(72);
    const api = createApiClient({ env });
    const { org } = useOrgContext();

    const t = useTranslations();

    const validForOptions = [
        { hours: 24, name: t("day", { count: 1 }) },
        { hours: 48, name: t("day", { count: 2 }) },
        { hours: 72, name: t("day", { count: 3 }) },
        { hours: 96, name: t("day", { count: 4 }) },
        { hours: 120, name: t("day", { count: 5 }) },
        { hours: 144, name: t("day", { count: 6 }) },
        { hours: 168, name: t("day", { count: 7 }) }
    ];

    useEffect(() => {
        if (open) {
            setSendEmail(env.email.emailEnabled);
            setValidHours(72);
            setExpiresInDays(3);
        }
    }, [open, env.email.emailEnabled]);

    async function handleRegenerate() {
        if (!invitation) return;

        if (!org?.org.orgId) {
            toast({
                variant: "destructive",
                title: t("orgMissing"),
                description: t("orgMissingMessage"),
                duration: 5000
            });
            return;
        }

        setLoading(true);

        try {
            const res = await api.post(`/org/${org.org.orgId}/create-invite`, {
                email: invitation.email,
                roleIds: invitation.roleIds,
                validHours,
                sendEmail: env.email.emailEnabled && sendEmail,
                regenerate: true
            });

            if (res.status === 200) {
                const link = res.data.data.inviteLink;
                setInviteLink(link);
                setExpiresInDays(validHours / 24);

                if (sendEmail && env.email.emailEnabled) {
                    toast({
                        variant: "default",
                        title: t("inviteRegenerated"),
                        description: t("inviteSent", {
                            email: invitation.email
                        }),
                        duration: 5000
                    });
                } else {
                    toast({
                        variant: "default",
                        title: t("inviteRegenerated"),
                        description: t("inviteGenerate", {
                            email: invitation.email
                        }),
                        duration: 5000
                    });
                }

                onRegenerate({
                    id: invitation.id,
                    email: invitation.email,
                    expiresAt: new Date(res.data.data.expiresAt).toISOString(),
                    roleLabels: invitation.roleLabels,
                    roleIds: invitation.roleIds
                });
            }
        } catch (error: any) {
            if (error.response?.status === 409) {
                toast({
                    variant: "destructive",
                    title: t("inviteDuplicateError"),
                    description: t("inviteDuplicateErrorDescription"),
                    duration: 5000
                });
            } else if (error.response?.status === 429) {
                toast({
                    variant: "destructive",
                    title: t("inviteRateLimitError"),
                    description: t("inviteRateLimitErrorDescription"),
                    duration: 5000
                });
            } else {
                toast({
                    variant: "destructive",
                    title: t("inviteRegenerateError"),
                    description: t("inviteRegenerateErrorDescription"),
                    duration: 5000
                });
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <Credenza
            open={open}
            onOpenChange={(isOpen) => {
                setOpen(isOpen);
                if (!isOpen) {
                    setInviteLink(null);
                }
            }}
        >
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>
                        {inviteLink
                            ? t("inviteRegenerated")
                            : t("inviteRegenerate")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {inviteLink
                            ? sendEmail && env.email.emailEnabled
                                ? t("inviteEmailSentDescription")
                                : t("inviteSentDescription")
                            : t("inviteRegenerateDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    {!inviteLink ? (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>{t("email")}</Label>
                                <p className="text-sm">{invitation?.email}</p>
                            </div>

                            {env.email.emailEnabled && (
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="send-email"
                                        checked={sendEmail}
                                        onCheckedChange={(e) =>
                                            setSendEmail(e as boolean)
                                        }
                                    />
                                    <label
                                        htmlFor="send-email"
                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                    >
                                        {t("inviteEmailSent")}
                                    </label>
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label>{t("inviteValid")}</Label>
                                <Select
                                    value={validHours.toString()}
                                    onValueChange={(value) =>
                                        setValidHours(parseInt(value))
                                    }
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue
                                            placeholder={t("selectDuration")}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {validForOptions.map((option) => (
                                            <SelectItem
                                                key={option.hours}
                                                value={option.hours.toString()}
                                            >
                                                {option.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <p>
                                {t("inviteExpiresIn", {
                                    days: expiresInDays
                                })}
                            </p>
                            {inviteLink && <CopyTextBox text={inviteLink} />}
                        </div>
                    )}
                </CredenzaBody>
                <CredenzaFooter>
                    {!inviteLink ? (
                        <>
                            <CredenzaClose asChild>
                                <Button variant="outline">{t("cancel")}</Button>
                            </CredenzaClose>
                            <Button
                                onClick={handleRegenerate}
                                loading={loading}
                            >
                                {t("inviteRegenerateButton")}
                            </Button>
                        </>
                    ) : (
                        <CredenzaClose asChild>
                            <Button>{t("done")}</Button>
                        </CredenzaClose>
                    )}
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
