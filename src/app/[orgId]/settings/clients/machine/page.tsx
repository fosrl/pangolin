import type { ClientRow } from "@app/components/MachineClientsTable";
import MachineClientsTable from "@app/components/MachineClientsTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import MachineClientsBanner from "@app/components/MachineClientsBanner";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { ListClientsResponse } from "@server/routers/client";
import type { ListRolesResponse } from "@server/routers/role/listRoles";
import { AxiosResponse } from "axios";
import { getTranslations } from "next-intl/server";
import type { Pagination } from "@server/types/Pagination";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Machine Clients"
};

type ClientsPageProps = {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
};

export const dynamic = "force-dynamic";

export default async function ClientsPage(props: ClientsPageProps) {
    const t = await getTranslations();

    const params = await props.params;
    const searchParams = new URLSearchParams(await props.searchParams);

    let machineClients: ListClientsResponse["clients"] = [];
    let pagination: Pagination = {
        page: 1,
        total: 0,
        pageSize: 20
    };

    const cookieHeader = await authCookieHeader();

    const [machineRes, rolesRes] = await Promise.all([
        internal
            .get<AxiosResponse<ListClientsResponse>>(
                `/org/${params.orgId}/clients?${searchParams.toString()}`,
                cookieHeader
            )
            .catch(() => {}),
        internal
            .get<AxiosResponse<ListRolesResponse>>(
                `/org/${params.orgId}/roles?pageSize=500&page=1`,
                cookieHeader
            )
            .catch(() => {})
    ]);

    if (machineRes && machineRes.status === 200) {
        const responseData = machineRes.data.data;
        machineClients = responseData.clients;
        pagination = responseData.pagination;
    }

    const orgRoles =
        rolesRes && rolesRes.status === 200
            ? (rolesRes.data.data.roles ?? [])
            : [];
    const roleFilterOptions = orgRoles.map((r) => ({
        value: String(r.roleId),
        label: r.name
    }));

    function formatSize(mb: number): string {
        if (mb >= 1024 * 1024) {
            return `${(mb / (1024 * 1024)).toFixed(2)} TB`;
        } else if (mb >= 1024) {
            return `${(mb / 1024).toFixed(2)} GB`;
        } else {
            return `${mb.toFixed(2)} MB`;
        }
    }

    const mapClientToRow = (
        client: ListClientsResponse["clients"][0]
    ): ClientRow => {
        return {
            name: client.name,
            id: client.clientId,
            subnet: client.subnet.split("/")[0],
            mbIn: formatSize(client.megabytesIn || 0),
            mbOut: formatSize(client.megabytesOut || 0),
            orgId: params.orgId,
            online: client.online,
            olmVersion: client.olmVersion || undefined,
            olmUpdateAvailable: client.olmUpdateAvailable || false,
            userId: client.userId,
            username: client.username,
            userEmail: client.userEmail,
            niceId: client.niceId,
            agent: client.agent,
            archived: client.archived || false,
            blocked: client.blocked || false,
            approvalState: client.approvalState ?? "approved",
            labels: client.labels ?? [],
            roleLabels: (client.roles ?? []).map((r) => r.name)
        };
    };

    const machineClientRows: ClientRow[] = machineClients.map(mapClientToRow);

    return (
        <>
            <SettingsSectionTitle
                title={t("manageMachineClients")}
                description={t("manageMachineClientsDescription")}
            />

            <MachineClientsBanner orgId={params.orgId} />

            <MachineClientsTable
                machineClients={machineClientRows}
                orgId={params.orgId}
                rowCount={pagination.total}
                roleFilterOptions={roleFilterOptions}
                pagination={{
                    pageIndex: pagination.page - 1,
                    pageSize: pagination.pageSize
                }}
            />
        </>
    );
}
