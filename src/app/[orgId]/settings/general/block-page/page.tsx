import DnsBlockPageForm from "@app/components/DnsBlockPageForm";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import type { GetDnsBlockPageResponse } from "@server/routers/dnsBlocking/types";
import type { AxiosResponse } from "axios";

export const dynamic = "force-dynamic";

type BlockPageSettingsProps = {
    params: Promise<{ orgId: string }>;
};

export default async function BlockPageSettings({
    params
}: BlockPageSettingsProps) {
    const { orgId } = await params;

    // Fails without a license; the form then shows the defaults, disabled.
    const res = await internal
        .get<AxiosResponse<GetDnsBlockPageResponse>>(
            `/org/${orgId}/dns-block-page`,
            await authCookieHeader()
        )
        .catch(() => null);

    return <DnsBlockPageForm orgId={orgId} values={res?.data.data ?? null} />;
}
