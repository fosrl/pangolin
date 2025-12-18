import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { ListRemoteExitNodesResponse } from "@server/routers/remoteExitNode/types";
import { AxiosResponse } from "axios";
import ExitNodesTable, {
    RemoteExitNodeRow
} from "@app/components/ExitNodesTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { getTranslations } from "next-intl/server";

type RemoteExitNodesPageProps = {
    params: Promise<{ orgId: string }>;
};

export const dynamic = "force-dynamic";

export default async function RemoteExitNodesPage(
    props: RemoteExitNodesPageProps
) {
    const params = await props.params;
    let remoteExitNodes: ListRemoteExitNodesResponse["remoteExitNodes"] = [];
    try {
        const res = await internal.get<
            AxiosResponse<ListRemoteExitNodesResponse>
        >(`/org/${params.orgId}/remote-exit-nodes`, await authCookieHeader());
        remoteExitNodes = res.data.data.remoteExitNodes;
    } catch (e) {}

    const t = await getTranslations();

    const remoteExitNodeRows: RemoteExitNodeRow[] = remoteExitNodes.map(
        (node) => {
            return {
                name: node.name,
                id: node.remoteExitNodeId,
                exitNodeId: node.exitNodeId,
                address: node.address?.split("/")[0] || "-",
                endpoint: node.endpoint || "-",
                online: node.online,
                type: node.type,
                dateCreated: node.dateCreated,
                version: node.version || undefined,
                orgId: params.orgId
            };
        }
    );

    return (
        <>
            <SettingsSectionTitle
                title={t("remoteExitNodeManageRemoteExitNodes")}
                description={t("remoteExitNodeDescription")}
            />

            <ExitNodesTable
                remoteExitNodes={remoteExitNodeRows}
                orgId={params.orgId}
            />
        </>
    );
}
