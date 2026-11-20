import IdpTestPanel from "@app/components/idp/IdpTestPanel";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { GetIdpResponse as GetOrgIdpResponse } from "@server/routers/idp";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";

export default async function OrgIdpTestPage(props: {
    params: Promise<{ orgId: string; idpId: string }>;
}) {
    const { orgId, idpId } = await props.params;

    let storeLoginClaims = false;
    try {
        const res = await internal.get<AxiosResponse<GetOrgIdpResponse>>(
            `/org/${orgId}/idp/${idpId}`,
            await authCookieHeader()
        );
        storeLoginClaims = res.data.data.idp.storeLoginClaims;
    } catch {
        redirect(`/${orgId}/settings/idp`);
    }

    return (
        <IdpTestPanel
            idpId={Number(idpId)}
            orgId={orgId}
            storeLoginClaims={storeLoginClaims}
        />
    );
}
