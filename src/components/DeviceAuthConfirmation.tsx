"use client";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Monitor } from "lucide-react";
import BrandingLogo from "./BrandingLogo";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useTranslations } from "next-intl";

type DeviceAuthMetadata = {
    ip: string | null;
    city: string | null;
    deviceName: string | null;
    applicationName: string;
    createdAt: number;
};

type DeviceAuthConfirmationProps = {
    metadata: DeviceAuthMetadata;
    code: string;
    onConfirm: () => void;
    onCancel: () => void;
    loading: boolean;
};

export function DeviceAuthConfirmation({
    metadata,
    code,
    onConfirm,
    onCancel,
    loading
}: DeviceAuthConfirmationProps) {
    const { env } = useEnvContext();
    const { isUnlocked } = useLicenseStatusContext();
    const t = useTranslations();

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short"
        });
    };

    const locationText =
        metadata.city && metadata.ip
            ? `${metadata.city} ${metadata.ip}`
            : metadata.ip || t("deviceUnknownLocation");

    const logoWidth = isUnlocked()
        ? env.branding.logo?.authPage?.width || 175
        : 175;
    const logoHeight = isUnlocked()
        ? env.branding.logo?.authPage?.height || 58
        : 58;

    return (
        <Card className="w-full max-w-md">
            <CardHeader className="border-b">
                <div className="flex flex-row items-center justify-center">
                    <BrandingLogo height={logoHeight} width={logoWidth} />
                </div>
                <div className="text-center space-y-1 pt-3">
                    <p className="text-muted-foreground">
                        {t("deviceActivation")}
                    </p>
                </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
                <Alert variant="warning">
                    <AlertDescription>
                        {t("deviceAuthorizationRequested", {
                            location: locationText,
                            date: formatDate(metadata.createdAt)
                        })}
                    </AlertDescription>
                </Alert>

                <div className="space-y-3">
                    <div className="flex flex-col items-center gap-1 p-3 border rounded-md text-center">
                        <p className="text-sm text-muted-foreground">
                            {t("deviceCodeConfirmPrompt")}
                        </p>
                        <p className="text-2xl font-mono font-semibold tracking-widest">
                            {code}
                        </p>
                    </div>

                    <div className="flex items-start gap-3 p-3 border rounded-md">
                        <Monitor className="h-5 w-5 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">
                                {metadata.applicationName}
                            </p>
                            {metadata.deviceName && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("deviceLabel", {
                                        deviceName: metadata.deviceName
                                    })}
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                                {t("deviceWantsAccess")}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2 pt-2">
                        <p className="text-sm font-medium">
                            {t("deviceExistingAccess")}
                        </p>
                        <div className="space-y-1 pl-4">
                            <div className="flex items-center gap-2 text-sm">
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                                <span>{t("deviceFullAccess")}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                                <span>{t("deviceOrganizationsAccess")}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>

            <CardFooter className="gap-2">
                <Button
                    variant="outline"
                    onClick={onCancel}
                    disabled={loading}
                    className="w-full"
                >
                    {t("cancel")}
                </Button>

                <Button
                    className="w-full"
                    onClick={onConfirm}
                    disabled={loading}
                    loading={loading}
                >
                    {t("deviceAuthorize", {
                        applicationName: metadata.applicationName
                    })}
                </Button>
            </CardFooter>
        </Card>
    );
}
