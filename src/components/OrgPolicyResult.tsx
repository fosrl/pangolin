"use client";

import { useState } from "react";
import { CheckOrgUserAccessResponse } from "@server/routers/org";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, Shield } from "lucide-react";
import Enable2FaDialog from "./Enable2FaDialog";
import ChangePasswordDialog from "./ChangePasswordDialog";
import { useTranslations } from "next-intl";
import { useUserContext } from "@app/hooks/useUserContext";
import { useRouter } from "next/navigation";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient } from "@app/lib/api";

type OrgPolicyResultProps = {
    orgId: string;
    userId: string;
    accessRes: CheckOrgUserAccessResponse;
};

type PolicyItem = {
    id: string;
    name: string;
    description: string;
    compliant: boolean;
    action?: () => void;
    actionText?: string;
};

export default function OrgPolicyResult({
    orgId,
    userId,
    accessRes
}: OrgPolicyResultProps) {
    const [show2FaDialog, setShow2FaDialog] = useState(false);
    const [showChangePasswordDialog, setShowChangePasswordDialog] = useState(false);
    const t = useTranslations();
    const { user } = useUserContext();
    const router = useRouter();
    let requireedSteps = 0;
    let completedSteps = 0;
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const policies: PolicyItem[] = [];
    if (
        accessRes.policies?.requiredTwoFactor === false ||
        accessRes.policies?.requiredTwoFactor === true
    ) {
        const isTwoFactorCompliant =
            accessRes.policies?.requiredTwoFactor === true;
        policies.push({
            id: "two-factor",
            name: t("twoFactorAuthentication"),
            description: t("twoFactorDescription"),
            compliant: isTwoFactorCompliant,
            action: !isTwoFactorCompliant
                ? () => setShow2FaDialog(true)
                : undefined,
            actionText: !isTwoFactorCompliant ? t("enableTwoFactor") : undefined
        });
        requireedSteps += 1;
        if (isTwoFactorCompliant) {
            completedSteps += 1;
        }
    }

    // Add max session length policy if the organization has it enforced
    if (accessRes.policies?.maxSessionLength) {
        const maxSessionPolicy = accessRes.policies?.maxSessionLength;
        const maxHours = maxSessionPolicy.maxSessionLengthHours;
        
        // Use hours if less than 24, otherwise convert to days
        const useHours = maxHours < 24;
        const maxTime = useHours ? maxHours : Math.round(maxHours / 24);
        
        const descriptionKey = useHours 
            ? "reauthenticationDescriptionHours"
            : "reauthenticationDescription";
        
        const description = useHours
            ? t(descriptionKey, { maxHours })
            : t(descriptionKey, { maxDays: maxTime });

        policies.push({
            id: "max-session-length",
            name: t("reauthenticationRequired"),
            description,
            compliant: maxSessionPolicy.compliant,
            action: !maxSessionPolicy.compliant
                ? async () => {
                      try {
                          await api.post("/auth/logout", undefined);
                          router.push(`/auth/login?orgId=${orgId}`);
                      } catch (error) {
                          console.error("Error during logout:", error);
                          router.push(`/auth/login?orgId=${orgId}`);
                      }
                  }
                : undefined,
            actionText: !maxSessionPolicy.compliant
                ? t("reauthenticateNow")
                : undefined
        });
        requireedSteps += 1;
        if (maxSessionPolicy.compliant) {
            completedSteps += 1;
        }
    }

    // Add password age policy if the organization has it enforced
    if (accessRes.policies?.passwordAge) {
        const passwordAgePolicy = accessRes.policies.passwordAge;
        const maxDays = passwordAgePolicy.maxPasswordAgeDays;
        const daysAgo = Math.round(passwordAgePolicy.passwordAgeDays);

        policies.push({
            id: "password-age",
            name: t("passwordExpiryRequired"),
            description: t("passwordExpiryDescription", {
                maxDays,
                daysAgo
            }),
            compliant: passwordAgePolicy.compliant,
            action: !passwordAgePolicy.compliant
                ? () => setShowChangePasswordDialog(true)
                : undefined,
            actionText: !passwordAgePolicy.compliant
                ? t("changePasswordNow")
                : undefined
        });
        requireedSteps += 1;
        if (passwordAgePolicy.compliant) {
            completedSteps += 1;
        }
    }

    const progressPercentage =
        requireedSteps === 0 ? 100 : (completedSteps / requireedSteps) * 100;

    const allCompliant = completedSteps === requireedSteps;

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        {t("securityRequirements")}
                    </CardTitle>
                    <CardDescription>
                        {allCompliant
                            ? t("allRequirementsMet")
                            : t("completeRequirementsToContinue")}
                    </CardDescription>
                </CardHeader>

                <div className="px-6 pb-4">
                    <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                        <span>
                            {completedSteps} of {requireedSteps} steps completed
                        </span>
                        <span>{Math.round(progressPercentage)}%</span>
                    </div>
                    <Progress value={progressPercentage} className="h-2" />
                </div>

                <CardContent className="space-y-4">
                    {policies.map((policy) => (
                        <div
                            key={policy.id}
                            className="flex items-start gap-3 p-4 border rounded-lg"
                        >
                            <div className="flex-shrink-0 mt-0.5">
                                {policy.compliant ? (
                                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                                ) : (
                                    <XCircle className="h-5 w-5 text-red-500" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-medium">
                                    {policy.name}
                                </h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {policy.description}
                                </p>
                                {policy.action && policy.actionText && (
                                    <div className="mt-3">
                                        <Button
                                            size="sm"
                                            onClick={policy.action}
                                            className="w-full sm:w-auto"
                                        >
                                            {policy.actionText}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Enable2FaDialog
                open={show2FaDialog}
                setOpen={(val) => {
                    setShow2FaDialog(val);
                    router.refresh();
                }}
            />

            <ChangePasswordDialog
                open={showChangePasswordDialog}
                setOpen={(val) => {
                    setShowChangePasswordDialog(val);
                    router.refresh();
                }}
            />
        </>
    );
}
