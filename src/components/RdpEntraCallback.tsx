"use client";

import { useEffect, useState } from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

/** Message posted to the RDP page that opened the sign-in popup. */
export type RdpEntraMessage = {
    type: "pangolin-rdp-entra";
    deviceName?: string;
    accessToken?: string;
    nonce?: string;
    devices?: { deviceId: string; name: string }[];
    error?: string;
};

export const RDP_ENTRA_MESSAGE_TYPE: RdpEntraMessage["type"] =
    "pangolin-rdp-entra";

/**
 * Last page of the Entra RDP sign-in popup: hands the result to the RDP page
 * that opened it and closes itself on success.
 */
export default function RdpEntraCallback(props: {
    // Origin of the RDP page, as recorded in the signed state
    origin: string | null;
    error: string | null;
    result:
        | {
              accessToken: string;
              nonce: string;
              deviceName: string;
          }
        | { devices: { deviceId: string; name: string }[] }
        | null;
}) {
    const t = useTranslations();
    const [delivered, setDelivered] = useState(false);

    useEffect(() => {
        const opener = window.opener as Window | null;
        if (!opener || !props.origin) {
            return;
        }

        const message: RdpEntraMessage = props.result
            ? "devices" in props.result
                ? {
                      type: RDP_ENTRA_MESSAGE_TYPE,
                      devices: props.result.devices
                  }
                : {
                      type: RDP_ENTRA_MESSAGE_TYPE,
                      deviceName: props.result.deviceName,
                      accessToken: props.result.accessToken,
                      nonce: props.result.nonce
                  }
            : {
                  type: RDP_ENTRA_MESSAGE_TYPE,
                  error: props.error ?? t("rdpEntraCallbackError")
              };

        // Only the RDP page that started the flow may receive the token.
        opener.postMessage(message, props.origin);
        setDelivered(true);

        if (props.result) {
            window.close();
        }
    }, [props.origin, props.result, props.error, t]);

    const noOpener = typeof window !== "undefined" && !window.opener;

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>{t("rdpEntraCallbackTitle")}</CardTitle>
                    <CardDescription>
                        {props.result
                            ? t("rdpEntraCallbackSuccess")
                            : t("rdpEntraCallbackError")}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {props.result ? (
                        <div className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                            <span>{t("rdpEntraCallbackSuccess")}</span>
                        </div>
                    ) : (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                {props.error ?? t("rdpEntraCallbackError")}
                            </AlertDescription>
                        </Alert>
                    )}
                    {noOpener && !delivered && (
                        <p className="text-sm text-muted-foreground">
                            {t("rdpEntraCallbackNoOpener")}
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
