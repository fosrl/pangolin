import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Remote Exit Node"
};

export default async function RemoteExitNodePage(props: {
    params: Promise<{ orgId: string; remoteExitNodeId: string }>;
}) {
    const params = await props.params;
    redirect(
        `/${params.orgId}/settings/remote-exit-nodes/${params.remoteExitNodeId}/networking`
    );
}
