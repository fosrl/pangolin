import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { AxiosResponse } from "axios";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import ShareLinksBanner from "@app/components/ShareLinksBanner";
import { redirect } from "next/navigation";
import { cache } from "react";
import { GetOrgResponse } from "@server/routers/org";
import OrgProvider from "@app/providers/OrgProvider";
import { ListAccessTokensResponse } from "@server/routers/accessToken";
import ShareLinksTable, { ShareLinkRow } from "@app/components/ShareLinksTable";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Shareable Links"
};

type ShareLinksPageProps = {
    params: Promise<{ orgId: string }>;
};

export const dynamic = "force-dynamic";

export default async function ShareLinksPage(props: ShareLinksPageProps) {
    const params = await props.params;

    let tokens: ListAccessTokensResponse["accessTokens"] = [];

    try {
        const res = await internal.get<AxiosResponse<ListAccessTokensResponse>>(
            `/org/${params.orgId}/access-tokens`,
            await authCookieHeader()
        );
        tokens = res.data.data.accessTokens;
    } catch (e) {}

    let org = null;
    try {
        const getOrg = cache(async () =>
            internal.get<AxiosResponse<GetOrgResponse>>(
                `/org/${params.orgId}`,
                await authCookieHeader()
            )
        );
        const res = await getOrg();
        org = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/resources`);
    }

    if (!org) {
        redirect(`/${params.orgId}/settings/resources`);
    }

    const rows: ShareLinkRow[] = tokens.map(
        (token) => ({ ...token }) as ShareLinkRow
    );

    const t = await getTranslations();

    return (
        <>
            {/* <ShareableLinksSplash /> */}

            <SettingsSectionTitle
                title={t("shareTitle")}
                description={t("shareDescription")}
            />
            <ShareLinksBanner />
            <OrgProvider org={org}>
                <ShareLinksTable shareLinks={rows} orgId={params.orgId} />
            </OrgProvider>
        </>
    );
}
