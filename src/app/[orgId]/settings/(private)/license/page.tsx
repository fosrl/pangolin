import GenerateLicenseKeysTable from "@app/components/GenerateLicenseKeysTable";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { ListGeneratedLicenseKeysResponse } from "@server/routers/generatedLicense/types";
import { AxiosResponse } from "axios";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Enterprise Licenses"
};

type Props = {
    params: Promise<{ orgId: string }>;
};

export const dynamic = "force-dynamic";

export default async function Page({ params }: Props) {
    const { orgId } = await params;

    let licenseKeys: ListGeneratedLicenseKeysResponse = [];
    try {
        const data = await internal.get<
            AxiosResponse<ListGeneratedLicenseKeysResponse>
        >(`/org/${orgId}/license`, await authCookieHeader());
        licenseKeys = data.data.data;
    } catch {}

    return <GenerateLicenseKeysTable licenseKeys={licenseKeys} orgId={orgId} />;
}
