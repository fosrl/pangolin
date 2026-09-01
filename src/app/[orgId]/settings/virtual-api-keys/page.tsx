import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Virtual API Keys"
};

type VirtualApiKeysIndexPageProps = {
    params: Promise<{ orgId: string }>;
};

export default async function VirtualApiKeysIndexPage(
    props: VirtualApiKeysIndexPageProps
) {
    const params = await props.params;
    redirect(`/${params.orgId}/settings/virtual-api-keys/identity`);
}
