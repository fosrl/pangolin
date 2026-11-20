import IdpTestPanel from "@app/components/idp/IdpTestPanel";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { GetIdpResponse } from "@server/routers/idp";
import { AxiosResponse } from "axios";
import { redirect } from "next/navigation";

export default async function IdpTestPage(props: {
    params: Promise<{ idpId: string }>;
}) {
    const { idpId } = await props.params;

    let storeLoginClaims = false;
    try {
        const res = await internal.get<AxiosResponse<GetIdpResponse>>(
            `/idp/${idpId}`,
            await authCookieHeader()
        );
        storeLoginClaims = res.data.data.idp.storeLoginClaims;
    } catch {
        redirect("/admin/idp");
    }

    return (
        <IdpTestPanel
            idpId={Number(idpId)}
            storeLoginClaims={storeLoginClaims}
        />
    );
}
