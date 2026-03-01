import { verifySession } from "@app/lib/auth/verifySession";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import ConnectedAppsClient from "./ConnectedAppsClient";

export const dynamic = "force-dynamic";

export default async function ConnectedAppsPage() {
    const getUser = cache(verifySession);
    const user = await getUser({ skipCheckVerifyEmail: true });

    if (!user) {
        redirect("/auth/login");
    }

    const t = await getTranslations();

    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-xl font-semibold">
                    {t("connectedApps")}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    {t("connectedAppsDescription")}
                </p>
            </div>
            <ConnectedAppsClient />
        </div>
    );
}
