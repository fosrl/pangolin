import { generateBrowserGatewayMetadata } from "@app/lib/browserGatewayMetadata";
import { getBrowserTargetForRequest } from "@app/lib/getBrowserTargetForRequest";
import { loadOrgLoginPageBranding } from "@app/lib/loadOrgLoginPageBranding";
import RdpClient from "./RdpClient";
import AuthFooter from "@app/components/AuthFooter";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
    return generateBrowserGatewayMetadata("RDP");
}

export default async function RdpPage() {
    const t = await getTranslations();
    const { target } = await getBrowserTargetForRequest();
    const error = target ? null : t("browserGatewayNoResourceForDomain");
    const { primaryColor } = target
        ? await loadOrgLoginPageBranding(target.orgId)
        : { primaryColor: null };

    return (
        <div className="h-full flex flex-col">
            <div className="flex-1 flex md:items-center justify-center">
                <div className="w-full max-w-md p-3">
                    <RdpClient
                        target={target}
                        error={error}
                        primaryColor={primaryColor}
                    />
                </div>
            </div>
            <AuthFooter />
        </div>
    );
}
