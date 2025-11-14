import { headers } from "next/headers";
import { priv } from "@app/lib/api";
import { GetMaintenanceInfoResponse } from "@server/routers/resource/types";
import { getTranslations } from "next-intl/server";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@app/components/ui/alert";
import { Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MaintenanceScreen() {
    const t = await getTranslations();

    let title = t("maintenanceScreenTitle");
    let message = t("maintenanceScreenMessage");
    let estimatedTime: string | null = null;

    try {
        const headersList = await headers();
        const host = headersList.get("host") || "";
        const hostname = host.split(":")[0];

        const res = await priv.get<GetMaintenanceInfoResponse>(
            `/maintenance/info?fullDomain=${encodeURIComponent(hostname)}`
        );

        if (res && res.status === 200) {
            const maintenanceInfo = res.data;
            title = maintenanceInfo?.maintenanceTitle || title;
            message = maintenanceInfo?.maintenanceMessage || message;
            estimatedTime = maintenanceInfo?.maintenanceEstimatedTime || null;
        }
    } catch (err) {
        console.error(
            "Failed to fetch maintenance info",
            err instanceof Error ? err.message : String(err)
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p>{message}</p>
                    {estimatedTime && (
                        <Alert className="w-full" variant="neutral">
                            <Clock className="h-5 w-5" />
                            <AlertTitle>
                                {t("maintenanceScreenEstimatedCompletion")}
                            </AlertTitle>
                            <AlertDescription className="flex flex-col space-y-2">
                                {estimatedTime}
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
