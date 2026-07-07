import { generateBrowserGatewayMetadata } from "@app/lib/browserGatewayMetadata";
import { getBrowserTargetForRequest } from "@app/lib/getBrowserTargetForRequest";
import { loadOrgLoginPageBranding } from "@app/lib/loadOrgLoginPageBranding";
import VncClient from "./VncClient";
import AuthFooter from "@app/components/AuthFooter";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
    return generateBrowserGatewayMetadata("VNC");
}

export default async function VncPage() {
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
                    <VncClient
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
