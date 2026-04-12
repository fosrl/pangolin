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
import { AcceptInviteResponse, GetUserResponse } from "@server/routers/user";
import { Loader2 } from "lucide-react";

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
    const [error, setError] = useState("");
    const [type, setType] = useState<
        | "rejected"
        | "wrong_user"
        | "user_does_not_exist"
        | "not_logged_in"
        | "user_limit_exceeded"
    >("rejected");

    useEffect(() => {
        async function init() {
            let error = "";
            const res = await api
                .post<AxiosResponse<AcceptInviteResponse>>(`/invite/accept`, {
                    inviteId,
                    token: inviteToken
                })
                .catch((e) => {
                    error = formatAxiosError(e);
                    console.log("Error accepting invite:", error);
                    setError(error);
                    // console.error(e);
                });

            if (res && res.status === 200) {
                router.push(`/${res.data.data.orgId}`);
                return;
            }

            function cardType() {
                if (error.includes("Invite is not for this user")) {
                    return "wrong_user";
                } else if (
                    error.includes(
                        "User does not exist. Please create an account first."
                    )
                ) {
                    return "user_does_not_exist";
                } else if (
                    error.includes("You must be logged in to accept an invite")
                ) {
                    return "not_logged_in";
                } else if (
                    error.includes("user limit is exceeded") ||
                    error.includes("Can not accept")
                ) {
                    return "user_limit_exceeded";
                } else {
                    return "rejected";
                }
            }

            const type = cardType();
            setType(type);

            if (!user && type === "user_does_not_exist") {
                const redirectUrl = email
                    ? `/auth/signup?redirect=/invite?token=${tokenParam}&email=${email}`
                    : `/auth/signup?redirect=/invite?token=${tokenParam}`;
                router.push(redirectUrl);
            } else if (!user && type === "not_logged_in") {
                const redirectUrl = email
                    ? `/auth/login?redirect=/invite?token=${tokenParam}&email=${email}`
                    : `/auth/login?redirect=/invite?token=${tokenParam}`;
                router.push(redirectUrl);
            } else {
                setLoading(false);
            }
        }

        init();
    }, []);

    async function goToLogin() {
        await api.post("/auth/logout", {});
        const redirectUrl = email
            ? `/auth/login?redirect=/invite?token=${tokenParam}&email=${email}`
            : `/auth/login?redirect=/invite?token=${tokenParam}`;
        router.push(redirectUrl);
    }

    async function goToSignup() {
        await api.post("/auth/logout", {});
        const redirectUrl = email
            ? `/auth/signup?redirect=/invite?token=${tokenParam}&email=${email}`
            : `/auth/signup?redirect=/invite?token=${tokenParam}`;
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
                    <CardTitle className="text-center text-2xl font-bold">
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
