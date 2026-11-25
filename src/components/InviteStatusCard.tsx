"use client";

import { createApiClient, formatAxiosError } from "@app/lib/api";
import { Button } from "@app/components/ui/button";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AxiosResponse } from "axios";
import {
    AcceptInviteResponse,
    AcceptInviteStatus,
    GetUserResponse
} from "@server/routers/user";
import { Loader2 } from "lucide-react";

type CardType = Exclude<AcceptInviteStatus, "accepted"> | "rejected";

type InviteStatusCardProps = {
    user: GetUserResponse | null;
    tokenParam: string;
    inviteId: string;
    inviteToken: string;
    email?: string;
};

export default function InviteStatusCard({
    inviteId,
    email,
    user,
    tokenParam,
    inviteToken
}: InviteStatusCardProps) {
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const t = useTranslations();

    const [loading, setLoading] = useState(true);
    const [type, setType] = useState<CardType>("rejected");

    useEffect(() => {
        async function init() {
            const res = await api
                .post<AxiosResponse<AcceptInviteResponse>>(`/invite/accept`, {
                    inviteId,
                    token: inviteToken
                })
                .catch((e) => {
                    // Only real failures (bad or expired token, revoked
                    // invite, server error) are errors; they all show the
                    // "not valid" card.
                    console.log("Error accepting invite:", formatAxiosError(e));
                });

            const result = res?.data?.data;

            if (result?.accepted) {
                router.push(`/${result.orgId}`);
                return;
            }

            const type: CardType =
                result && result.status !== "accepted"
                    ? result.status
                    : "rejected";
            setType(type);

            if (!user && type === "user_does_not_exist") {
                const inviteRedirect = encodeURIComponent(
                    `/invite?token=${tokenParam}`
                );
                const redirectUrl = email
                    ? `/auth/signup?redirect=${inviteRedirect}&email=${encodeURIComponent(email)}`
                    : `/auth/signup?redirect=${inviteRedirect}`;
                router.push(redirectUrl);
            } else if (!user && type === "not_logged_in") {
                const inviteRedirect = encodeURIComponent(
                    `/invite?token=${tokenParam}`
                );
                const redirectUrl = email
                    ? `/auth/login?redirect=${inviteRedirect}&user=${encodeURIComponent(email)}`
                    : `/auth/login?redirect=${inviteRedirect}`;
                router.push(redirectUrl);
            } else {
                setLoading(false);
            }
        }

        init();
    }, []);

    async function goToLogin() {
        await api.post("/auth/logout", {});
        const inviteRedirect = encodeURIComponent(
            `/invite?token=${tokenParam}`
        );
        const redirectUrl = email
            ? `/auth/login?redirect=${inviteRedirect}&user=${encodeURIComponent(email)}`
            : `/auth/login?redirect=${inviteRedirect}`;
        router.push(redirectUrl);
    }

    async function goToSignup() {
        await api.post("/auth/logout", {});
        const inviteRedirect = encodeURIComponent(
            `/invite?token=${tokenParam}`
        );
        const redirectUrl = email
            ? `/auth/signup?redirect=${inviteRedirect}&email=${encodeURIComponent(email)}`
            : `/auth/signup?redirect=${inviteRedirect}`;
        router.push(redirectUrl);
    }

    function renderBody() {
        if (type === "rejected") {
            return (
                <div>
                    <p className="text-center mb-4">
                        {t("inviteErrorNotValid")}
                    </p>
                    <ul className="list-disc list-inside text-sm space-y-2">
                        <li>{t("inviteErrorExpired")}</li>
                        <li>{t("inviteErrorRevoked")}</li>
                        <li>{t("inviteErrorTypo")}</li>
                    </ul>
                </div>
            );
        } else if (type === "wrong_user") {
            return (
                <div>
                    <p className="text-center mb-4">{t("inviteErrorUser")}</p>
                    <p className="text-center">{t("inviteLoginUser")}</p>
                </div>
            );
        } else if (type === "user_does_not_exist") {
            return (
                <div>
                    <p className="text-center mb-4">{t("inviteErrorNoUser")}</p>
                    <p className="text-center">{t("inviteCreateUser")}</p>
                </div>
            );
        } else if (type === "oidc_not_allowed") {
            return (
                <div>
                    <p className="text-center mb-4">
                        {t("inviteErrorOidcNotAllowed")}
                    </p>
                </div>
            );
        } else if (type === "user_limit_exceeded") {
            return (
                <div>
                    <p className="text-center mb-4 font-semibold">
                        Cannot Accept Invite
                    </p>
                    <p className="text-center text-sm">
                        This organization has reached its user limit. Please
                        contact the organization administrator to upgrade their
                        plan before accepting this invite.
                    </p>
                </div>
            );
        }
    }

    function renderFooter() {
        if (type === "rejected") {
            return (
                <Button
                    onClick={() => {
                        router.push("/");
                    }}
                >
                    {t("goHome")}
                </Button>
            );
        } else if (type === "wrong_user") {
            return (
                <Button onClick={goToLogin}>{t("inviteLogInOtherUser")}</Button>
            );
        } else if (type === "user_does_not_exist") {
            return <Button onClick={goToSignup}>{t("createAnAccount")}</Button>;
        } else if (type === "oidc_not_allowed") {
            return (
                <Button onClick={goToLogin}>{t("inviteLogInOtherUser")}</Button>
            );
        } else if (type === "user_limit_exceeded") {
            return (
                <Button
                    onClick={() => {
                        router.push("/");
                    }}
                >
                    {t("goHome")}
                </Button>
            );
        }
    }

    return (
        <div className="flex items-center justify-center min-h-screen">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="text-center text-2xl font-semibold">
                        {loading ? t("checkingInvite") : t("inviteNotAccepted")}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading && (
                        <div className="flex flex-col items-center space-y-4">
                            <div className="flex items-center space-x-2">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                <span>{t("loading")}</span>
                            </div>
                        </div>
                    )}
                    {!loading && renderBody()}
                </CardContent>

                {!loading && (
                    <CardFooter className="flex justify-center space-x-4">
                        {renderFooter()}
                    </CardFooter>
                )}
            </Card>
        </div>
    );
}
