import RedirectForm from "@app/components/RedirectForm";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { Button } from "@app/components/ui/button";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import type { GetRedirectResponse } from "@server/routers/redirect";
import type { AxiosResponse } from "axios";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
    title: "Edit Redirect"
};

export const dynamic = "force-dynamic";

type EditRedirectPageProps = {
    params: Promise<{ orgId: string; niceId: string }>;
};

export default async function EditRedirectPage(props: EditRedirectPageProps) {
    const { orgId, niceId } = await props.params;
    const t = await getTranslations();

    let redirect: GetRedirectResponse["redirect"];
    try {
        const res = await internal.get<AxiosResponse<GetRedirectResponse>>(
            `/org/${orgId}/redirect/${niceId}`,
            await authCookieHeader()
        );
        redirect = res.data.data.redirect;
    } catch {
        notFound();
    }

    // The resource selector needs the resource's display fields up front so the
    // trigger shows a name instead of a bare id before the list query resolves.
    const initialResource =
        redirect.resourceId && redirect.resourceNiceId
            ? {
                  resourceId: redirect.resourceId,
                  niceId: redirect.resourceNiceId,
                  name: redirect.resourceName ?? redirect.resourceNiceId,
                  fullDomain: redirect.resourceFullDomain,
                  ssl: redirect.resourceSsl ?? false,
                  wildcard: redirect.resourceWildcard ?? false
              }
            : null;

    return (
        <>
            <div className="flex gap-2 justify-between">
                <SettingsSectionTitle
                    title={redirect.name}
                    description={t("redirectEditDescription")}
                />
                <Button variant="outline" asChild>
                    <Link href={`/${orgId}/settings/redirects`}>
                        {t("redirectGoBack")}
                    </Link>
                </Button>
            </div>

            <RedirectForm
                orgId={orgId}
                redirect={redirect}
                initialResource={initialResource}
            />
        </>
    );
}
