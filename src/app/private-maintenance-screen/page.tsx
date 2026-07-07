import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Private Placeholder"
};

export default async function MaintenanceScreen() {
    const t = await getTranslations();

    const title = t("privateMaintenanceScreenTitle");
    const message = t("privateMaintenanceScreenMessage");
    const steps = t("privateMaintenanceScreenSteps");

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p>{message}</p>
                    <p className="text-sm text-muted-foreground">{steps}</p>
                    <a
                        href="https://docs.pangolin.net/manage/dns-cache"
                        className="text-sm text-primary hover:underline"
                    >
                        {t("learnMore")}
                    </a>
                </CardContent>
            </Card>
        </div>
    );
}
