import { internal } from "@app/lib/api";
import { GetRemoteExitNodeResponse } from "@server/routers/remoteExitNode/types";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";
import { authCookieHeader } from "@app/lib/api/cookies";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { getTranslations } from "next-intl/server";
import RemoteExitNodeProvider from "@app/providers/RemoteExitNodeProvider";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import ExitNodeInfoCard from "@app/components/ExitNodeInfoCard";

interface SettingsLayoutProps {
    children: React.ReactNode;
    params: Promise<{ remoteExitNodeId: string; orgId: string }>;
}

export default async function SettingsLayout(props: SettingsLayoutProps) {
    const params = await props.params;
    const { children } = props;

    let remoteExitNode = null;
    try {
        const res = await internal.get<
            AxiosResponse<GetRemoteExitNodeResponse>
        >(
            `/org/${params.orgId}/remote-exit-node/${params.remoteExitNodeId}`,
            await authCookieHeader()
        );
        remoteExitNode = res.data.data;
    } catch {
        redirect(`/${params.orgId}/settings/remote-exit-nodes`);
    }

    const t = await getTranslations();

    const navItems = [
        {
            title: t("credentials"),
            href: "/{orgId}/settings/remote-exit-nodes/{remoteExitNodeId}/credentials"
        }
    ];

    return (
        <>
            <SettingsSectionTitle
                title={`Remote Node ${remoteExitNode?.name || "Unknown"}`}
                description="Manage your remote exit node settings and configuration"
            />

            <RemoteExitNodeProvider remoteExitNode={remoteExitNode}>
                <div className="space-y-6">
                    <ExitNodeInfoCard />
                    <HorizontalTabs items={navItems}>{children}</HorizontalTabs>
                </div>
            </RemoteExitNodeProvider>
        </>
    );
}
