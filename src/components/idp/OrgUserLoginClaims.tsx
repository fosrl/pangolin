"use client";

import IdpTestResultView from "@app/components/idp/IdpTestResultView";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { Button } from "@app/components/ui/button";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import type { GetOrgUserLoginClaimsResponse } from "@server/routers/user";
import { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";

type OrgUserLoginClaimsProps = {
    orgId: string;
    userId: string;
};

/** The claims of an OIDC user's last login, through the org's current mappings. */
export default function OrgUserLoginClaims({
    orgId,
    userId
}: OrgUserLoginClaimsProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const [data, setData] = useState<GetOrgUserLoginClaimsResponse | null>(
        null
    );
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.get<AxiosResponse<GetOrgUserLoginClaimsResponse>>(
            `/org/${orgId}/user/${userId}/login-claims`
        )
            .then((res) => setData(res.data.data))
            .catch((e) => setError(formatAxiosError(e)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, userId]);

    const idpTestHref = data?.idp
        ? env.app.identityProviderMode === "org"
            ? `/${orgId}/settings/idp/${data.idp.idpId}/test`
            : null
        : null;

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("userLoginClaimsTitle")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("userLoginClaimsDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                    {data && !data.idp && (
                        <p className="text-sm text-muted-foreground">
                            {t("userLoginClaimsNotOidc")}
                        </p>
                    )}
                    {data?.idp && !data.result && (
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">
                                {data.idp.storeLoginClaims
                                    ? t("userLoginClaimsNoneYet", {
                                          idpName: data.idp.name
                                      })
                                    : t("userLoginClaimsDisabled", {
                                          idpName: data.idp.name
                                      })}
                            </p>
                            {!data.idp.storeLoginClaims && idpTestHref && (
                                <Button variant="outline" size="sm" asChild>
                                    <Link href={idpTestHref}>
                                        {t("userLoginClaimsOpenIdpTest")}
                                    </Link>
                                </Button>
                            )}
                        </div>
                    )}
                    {data?.result && <IdpTestResultView result={data.result} />}
                </SettingsSectionBody>
            </SettingsSection>
        </SettingsContainer>
    );
}
