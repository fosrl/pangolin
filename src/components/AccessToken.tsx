"use client";

import { createApiClient } from "@app/lib/api";
import { Button } from "@app/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { AuthWithAccessTokenResponse } from "@server/routers/resource";
import { AxiosResponse } from "axios";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type AccessTokenProps = {
    token: string;
};

export default function AccessToken({ token }: AccessTokenProps) {
    const [loading, setLoading] = useState(true);
    const [isValid, setIsValid] = useState(false);

    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const t = useTranslations();

    function appendRequestToken(url: string, token: string) {
        const fullUrl = new URL(url);
        fullUrl.searchParams.append(
            env.server.resourceSessionRequestParam,
            token
        );
        return fullUrl.toString();
    }

    useEffect(() => {
        if (!token) {
            setLoading(false);
            return;
        }

        let accessTokenId = "";
        let accessToken = "";

        const parts = token.split(".");

        if (parts.length === 2) {
            accessTokenId = parts[0];
            accessToken = parts[1];
        } else if (parts.length === 1) {
            accessToken = parts[0];
        } else {
            setLoading(false);
            return;
        }

        async function check() {
            try {
                const res = await api.post<
                    AxiosResponse<AuthWithAccessTokenResponse>
                >(`/auth/access-token`, {
                    accessToken,
                    accessTokenId: accessTokenId || undefined
                });

                if (res.data.data.session) {
                    setIsValid(true);
                    window.location.href = appendRequestToken(
                        res.data.data.redirectUrl!,
                        res.data.data.session
                    );
                }
            } catch (e) {
                console.error(t("accessTokenError"), e);
            } finally {
                setLoading(false);
            }
        }

        check();
    }, [token]);

    function renderTitle() {
        if (isValid) {
            return t("accessGranted");
        } else {
            return t("accessUrlInvalid");
        }
    }

    function renderContent() {
        if (isValid) {
            return <div>{t("accessGrantedDescription")}</div>;
        } else {
            return (
                <div>
                    {t("accessUrlInvalidDescription")}
                    <div className="text-center mt-4">
                        <Button>
                            <Link href="/">{t("goHome")}</Link>
                        </Button>
                    </div>
                </div>
            );
        }
    }

    return loading ? (
        <div></div>
    ) : (
        <Card className="w-full max-w-md">
            <CardHeader>
                <CardTitle className="text-center text-2xl font-semibold">
                    {renderTitle()}
                </CardTitle>
            </CardHeader>
            <CardContent>{renderContent()}</CardContent>
        </Card>
    );
}
