import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import OAuthClientsTable, {
    OAuthClientRow
} from "@app/components/OAuthClientsTable";
import { getTranslations } from "next-intl/server";
import type { PublicOAuthClient } from "@server/lib/oauth/clientAuth";
import { ResponseT } from "@server/types/Response";

type OAuthClientsPageProps = {
    params: Promise<{ orgId: string }>;
};

export const dynamic = "force-dynamic";

export default async function OAuthClientsPage(props: OAuthClientsPageProps) {
    const params = await props.params;
    const t = await getTranslations();

    let clients: PublicOAuthClient[] = [];
    try {
        const res = await internal.get<
            ResponseT<{ clients: PublicOAuthClient[] }>
        >(`/org/${params.orgId}/oauth-clients`, await authCookieHeader());
        clients = res.data.data?.clients || [];
    } catch (e) {}

    const rows: OAuthClientRow[] = clients.map((client) => ({
        clientId: client.clientId,
        clientName: client.clientName,
        logoUri: client.logoUri,
        redirectUris: client.redirectUris,
        scopes: client.scopes,
        enabled: client.enabled,
        createdAt: client.createdAt,
        lastChars: client.lastChars
    }));

    return (
        <>
            <SettingsSectionTitle
                title={t("oauthClientsTitle")}
                description={t("oauthClientsDescription")}
            />

            <OAuthClientsTable clients={rows} orgId={params.orgId} />
        </>
    );
}
