import type { Metadata } from "next";
import IdentityKeysSplash from "@app/components/IdentityKeysSplash";

export const metadata: Metadata = {
    title: "Identity Keys"
};

type IdentityKeysPageProps = {
    params: Promise<{ orgId: string }>;
};

export default async function IdentityKeysPage(props: IdentityKeysPageProps) {
    const params = await props.params;

    return <IdentityKeysSplash orgId={params.orgId} />;
}
