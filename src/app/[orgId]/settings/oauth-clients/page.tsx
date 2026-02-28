import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { AxiosResponse } from "axios";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import OAuthClientsTable, {
    OAuthClientRow
} from "@app/components/OAuthClientsTable";
import { getTranslations } from "next-intl/server";

type OAuthClientListItem = {
    clientId: string;
    clientName: string;
    clientUri: string | null;
    logoUri: string | null;
    redirectUris: string;
    scopes: string;
    pkceRequired: boolean;
    enabled: boolean;
    orgId: string;
    createdAt: number;
    updatedAt: number;
    lastChars: string;
};

type ListResponse = {
    data: {
        clients: OAuthClientListItem[];
    };
    success: boolean;
    error: boolean;
    message: string;
    status: number;
};

type OAuthClientsPageProps = {
    params: Promise<{ orgId: string }>;
};

export const dynamic = "force-dynamic";

function parseRedirectUris(redirectUris: string): string[] {
    try {
        const parsed = JSON.parse(redirectUris);
        if (Array.isArray(parsed)) {
            return parsed.filter((item) => typeof item === "string");
        }
        return [];
    } catch {
        return [];
    }
}

export default async function OAuthClientsPage(props: OAuthClientsPageProps) {
    const params = await props.params;
    const t = await getTranslations();

    let clients: OAuthClientListItem[] = [];
    try {
        const res = await internal.get<AxiosResponse<ListResponse>>(
            `/org/${params.orgId}/oauth-clients`,
            await authCookieHeader()
        );
        clients = res.data.data.clients || [];
    } catch (e) {}

    const rows: OAuthClientRow[] = clients.map((client) => ({
        clientId: client.clientId,
        clientName: client.clientName,
        redirectUris: parseRedirectUris(client.redirectUris),
        scopes: client.scopes,
        enabled: client.enabled,
        createdAt: new Date(client.createdAt).toISOString(),
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
