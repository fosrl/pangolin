import IdpTestLinkLanding from "@app/components/idp/IdpTestLinkLanding";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Test Sign-In"
};

export const dynamic = "force-dynamic";

export default async function IdpTestLinkPage(props: {
    params: Promise<{ idpId: string; token: string }>;
}) {
    const { idpId, token } = await props.params;
    return <IdpTestLinkLanding idpId={idpId} token={token} />;
}
