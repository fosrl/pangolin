import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import type { ClientRow } from "@app/components/UserDevicesTable";
import UserDevicesTable from "@app/components/UserDevicesTable";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { type ListUserDevicesResponse } from "@server/routers/client";
import type { Pagination } from "@server/types/Pagination";
import { AxiosResponse } from "axios";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "User Devices"
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

    let userClients: ListUserDevicesResponse["devices"] = [];

    let pagination: Pagination = {
        page: 1,
        total: 0,
        pageSize: 20
    };

    try {
        const userRes = await internal.get<
            AxiosResponse<ListUserDevicesResponse>
        >(
            `/org/${params.orgId}/user-devices?${searchParams.toString()}`,
            await authCookieHeader()
        );
        const responseData = userRes.data.data;
        userClients = responseData.devices;
        pagination = responseData.pagination;
    } catch (e) {}

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
        client: ListUserDevicesResponse["devices"][number]
    ): ClientRow => {
        // Build fingerprint object if any fingerprint data exists
        const hasFingerprintData =
            client.fingerprintPlatform ||
            client.fingerprintOsVersion ||
            client.fingerprintKernelVersion ||
            client.fingerprintArch ||
            client.fingerprintSerialNumber ||
            client.fingerprintUsername ||
            client.fingerprintHostname ||
            client.deviceModel;

        const fingerprint = hasFingerprintData
            ? {
                  platform: client.fingerprintPlatform,
                  osVersion: client.fingerprintOsVersion,
                  kernelVersion: client.fingerprintKernelVersion,
                  arch: client.fingerprintArch,
                  deviceModel: client.deviceModel,
                  serialNumber: client.fingerprintSerialNumber,
                  username: client.fingerprintUsername,
                  hostname: client.fingerprintHostname
              }
            : null;

        return {
            name: client.name,
            id: client.clientId,
            subnet: client.subnet.split("/")[0],
            mbIn: formatSize(client.megabytesIn ?? 0),
            mbOut: formatSize(client.megabytesOut ?? 0),
            orgId: params.orgId,
            online: client.online,
            olmVersion: client.olmVersion || undefined,
            olmUpdateAvailable: Boolean(client.olmUpdateAvailable),
            userId: client.userId,
            username: client.username,
            userEmail: client.userEmail,
            userType: client.userType ?? null,
            idpName: client.idpName ?? null,
            idpVariant: client.idpVariant ?? null,
            niceId: client.niceId,
            agent: client.agent,
            archived: Boolean(client.archived),
            blocked: Boolean(client.blocked),
            approvalState: client.approvalState,
            fingerprint,
            firstSeen: client.firstSeen ?? null,
            lastSeen: client.lastSeen ?? null
        };
    };

    const userClientRows: ClientRow[] = userClients.map(mapClientToRow);

    return (
        <>
            <SettingsSectionTitle
                title={t("manageUserDevices")}
                description={t("manageUserDevicesDescription")}
            />

            <UserDevicesTable
                userClients={userClientRows}
                orgId={params.orgId}
                rowCount={pagination.total}
                pagination={{
                    pageIndex: pagination.page - 1,
                    pageSize: pagination.pageSize
                }}
            />
        </>
    );
}
