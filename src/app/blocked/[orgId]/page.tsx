import { priv } from "@app/lib/api";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { fillBlockPageText, parseBlockedDomain } from "@app/lib/dnsBlockPage";
import type { LoadDnsBlockPageResponse } from "@server/routers/dnsBlocking/types";
import type { AxiosResponse } from "axios";
import { ShieldBan } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Blocked",
    robots: { index: false, follow: false }
};

type BlockedPageProps = {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<{ domain?: string | string[] }>;
};

// Where the Pangolin client sends a browser that opened a blocked site. Public:
// the device is not signed in to the dashboard in that browser.
export default async function BlockedPage({
    params,
    searchParams
}: BlockedPageProps) {
    const { orgId } = await params;
    const { domain: domainParam } = await searchParams;
    const t = await getTranslations();

    let page: LoadDnsBlockPageResponse | null = null;
    try {
        const res = await priv.get<AxiosResponse<LoadDnsBlockPageResponse>>(
            `/dns-block-page?orgId=${encodeURIComponent(orgId)}`
        );
        if (res.status === 200) page = res.data.data;
    } catch {
        // unknown org, or a build without DNS blocking: show the defaults
    }

    const domain = parseBlockedDomain(domainParam);
    const vars = {
        domain: domain ?? t("dnsBlockPageUnknownDomain"),
        orgName: page?.orgName ?? t("dnsBlockPageUnknownOrg")
    };

    const title = page?.title
        ? fillBlockPageText(page.title, vars)
        : t("dnsBlockPageDefaultTitle");
    const message = page?.message
        ? fillBlockPageText(page.message, vars)
        : t("dnsBlockPageDefaultMessage", vars);
    const contact = page?.contact
        ? fillBlockPageText(page.contact, vars)
        : null;

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ShieldBan className="h-5 w-5 text-destructive" />
                        {title}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {domain && (
                        <p className="font-mono text-sm break-all rounded-md bg-muted px-3 py-2">
                            {domain}
                        </p>
                    )}
                    <p className="whitespace-pre-line">{message}</p>
                    {contact && (
                        <p className="text-sm text-muted-foreground whitespace-pre-line">
                            {contact}
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
