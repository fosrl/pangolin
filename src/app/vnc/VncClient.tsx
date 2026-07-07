"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { toast } from "@app/hooks/useToast";
import { GetBrowserTargetResponse } from "@server/routers/browserGatewayTarget";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
} from "@app/components/ui/card";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import BrandedAuthSurface from "@app/components/BrandedAuthSurface";
import PoweredByPangolin from "@app/components/PoweredByPangolin";
import AuthPageFooterNotices from "@app/components/AuthPageFooterNotices";
import CollapsibleSessionToolbar from "@app/components/CollapsibleSessionToolbar";
import { useTranslations } from "next-intl";
import {
    loadEncryptedLocalStorage,
    saveEncryptedLocalStorage
} from "@app/lib/secureLocalStorage";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";

type VncCredentialsForm = {
    username: string;
    password: string;
};

const DEFAULT_VNC_CREDENTIALS: VncCredentialsForm = {
    username: "",
    password: ""
};

export default function VncClient({
    target,
    error,
    primaryColor
}: {
    target: GetBrowserTargetResponse | null;
    error: string | null;
    primaryColor?: string | null;
}) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const STORAGE_KEY = "pangolin_vnc_credentials";
    const resourceName = target?.name?.trim() || null;

    const formSchema = z.object({
        username: z.string(),
        password: z.string()
    });

    const form = useForm<VncCredentialsForm>({
        resolver: zodResolver(formSchema),
        defaultValues: DEFAULT_VNC_CREDENTIALS
    });

    useEffect(() => {
        let cancelled = false;

        void loadEncryptedLocalStorage<VncCredentialsForm>(
            STORAGE_KEY,
            target?.authToken
        ).then((saved) => {
            if (cancelled || !saved) return;
            form.reset({ ...DEFAULT_VNC_CREDENTIALS, ...saved });
        });

        return () => {
            cancelled = true;
        };
    }, [form, target?.authToken]);

    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);
    const rfbRef = useRef<any>(null);
    const screenRef = useRef<HTMLDivElement>(null);

    const disconnect = () => {
        if (rfbRef.current) {
            rfbRef.current.disconnect();
            rfbRef.current = null;
        }
        setConnecting(false);
        setConnected(false);
    };

    useEffect(() => {
        return () => disconnect();
    }, []);

    const connect = async (values: VncCredentialsForm) => {
        setConnecting(true);

        if (!target) {
            setConnectError(t("vncNoResourceTarget"));
            setConnecting(false);
            return;
        }

        if (!screenRef.current) {
            setConnectError(t("sshErrorConnectionClosed"));
            setConnecting(false);
            return;
        }

        disconnect();

        const proxyAddress = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/gateway/vnc`;
        const base = proxyAddress.replace(/\/$/, "");
        const params = new URLSearchParams({
            host: target.ip,
            port: String(target.port),
            authToken: target.authToken
        });

        // try {
        //     const checkParams = new URLSearchParams(params);
        //     checkParams.set("checkOnly", "1");
        //     const response = await fetch(`${base}?${checkParams.toString()}`);
        //     if (!response.ok) {
        //         const detail = (await response.text()).trim();
        //         setConnectError(detail || t("sshErrorConnectionClosed"));
        //         setConnecting(false);
        //         return;
        //     }
        // } catch {
        //     setConnectError(t("sshErrorWebSocket"));
        //     setConnecting(false);
        //     return;
        // }

        let RFB: new (
            target: HTMLElement,
            url: string,
            options?: Record<string, unknown>
        ) => unknown;
        try {
            // @ts-expect-error — @novnc/novnc ships plain JS with no bundled types
            const mod = await import("@novnc/novnc");
            RFB = mod.default ?? mod;
        } catch (err) {
            setConnecting(false);
            setConnectError(t("sshErrorWebSocket"));
            toast({
                variant: "destructive",
                title: t("vncFailedToLoadNovnc"),
                description: `${err}`
            });
            return;
        }

        const wsUrl = `${base}?${params.toString()}`;

        screenRef.current.innerHTML = "";

        const options: Record<string, unknown> = {};
        if (values.username || values.password) {
            options.credentials = {
                username: values.username,
                password: values.password
            };
        }

        let rfb: any;
        try {
            rfb = new RFB(screenRef.current, wsUrl, options);
        } catch {
            setConnecting(false);
            setConnectError(t("sshErrorWebSocket"));
            return;
        }

        let authConfirmed = false;
        let auditLogged = false;

        rfb.scaleViewport = true;
        rfb.resizeSession = true;

        rfb.addEventListener("connect", () => {
            void saveEncryptedLocalStorage(
                STORAGE_KEY,
                values,
                target.authToken
            );
            authConfirmed = true;
            auditLogged = true;
            void api.post(`/org/${target.orgId}/logs/access/attempt`, {
                resourceId: target.resourceId,
                action: true,
                type: "vnc"
            });
            setConnecting(false);
            setConnected(true);
        });

        rfb.addEventListener(
            "disconnect",
            (e: { detail: { clean: boolean } }) => {
                rfbRef.current = null;
                setConnecting(false);
                setConnected(false);
                if (!authConfirmed && !e.detail.clean) {
                    if (!auditLogged) {
                        auditLogged = true;
                        void api.post(
                            `/org/${target.orgId}/logs/access/attempt`,
                            {
                                resourceId: target.resourceId,
                                action: false,
                                type: "vnc"
                            }
                        );
                    }
                    setConnectError(t("sshErrorConnectionClosed"));
                }
            }
        );

        rfb.addEventListener(
            "securityfailure",
            (e: { detail: { status: number; reason?: string } }) => {
                auditLogged = true;
                void api.post(`/org/${target.orgId}/logs/access/attempt`, {
                    resourceId: target.resourceId,
                    action: false,
                    type: "vnc"
                });
                disconnect();
                setConnectError(
                    e.detail.reason ??
                        t("vncAuthFailedStatus", {
                            status: e.detail.status
                        })
                );
            }
        );

        rfbRef.current = rfb;
    };

    const onSubmit = (values: VncCredentialsForm) => {
        setConnectError(null);
        connect(values);
    };

    if (error) {
        return (
            <BrandedAuthSurface primaryColor={primaryColor}>
                <PoweredByPangolin />
                <Card className="w-full">
                    <CardHeader>
                        <CardTitle>{t("vncTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    </CardContent>
                </Card>
            </BrandedAuthSurface>
        );
    }

    return (
        <>
            {!connected && (
                <BrandedAuthSurface primaryColor={primaryColor}>
                    <PoweredByPangolin />
                    <Card className="w-full">
                        <CardHeader>
                            <CardTitle>{t("vncTitle")}</CardTitle>
                            <CardDescription>
                                {resourceName
                                    ? `${t("vncSignInDescription")} (${resourceName})`
                                    : t("vncSignInDescription")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Form {...form}>
                                <form
                                    onSubmit={form.handleSubmit(onSubmit)}
                                    className="space-y-4"
                                >
                                    <FormField
                                        control={form.control}
                                        name="username"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("vncUsernameOptional")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="text"
                                                        autoComplete="username"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="password"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("vncPasswordOptional")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="password"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    {connectError && (
                                        <Alert variant="destructive">
                                            <AlertDescription>
                                                {connectError}
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                    <Button
                                        type="submit"
                                        className="w-full"
                                        loading={connecting}
                                        disabled={connecting}
                                    >
                                        {t("browserGatewayConnect")}
                                    </Button>
                                </form>
                            </Form>
                        </CardContent>
                    </Card>
                    <AuthPageFooterNotices />
                </BrandedAuthSurface>
            )}

            <div
                className="fixed inset-0 z-50 flex flex-col bg-neutral-900"
                style={{ display: connected ? "flex" : "none" }}
            >
                <CollapsibleSessionToolbar>
                    <Button
                        size="sm"
                        variant="destructive"
                        onClick={disconnect}
                    >
                        {t("sshTerminate")}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            if (rfbRef.current) {
                                rfbRef.current.sendCtrlAltDel();
                            }
                        }}
                    >
                        {t("browserGatewayCtrlAltDel")}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            navigator.clipboard
                                ?.readText()
                                .then((text) => {
                                    rfbRef.current?.clipboardPasteFrom(text);
                                })
                                .catch(() => {});
                        }}
                    >
                        {t("vncPasteClipboard")}
                    </Button>
                </CollapsibleSessionToolbar>

                <div
                    ref={screenRef}
                    className="flex-1 overflow-hidden"
                    style={{ background: "#000" }}
                />
            </div>
        </>
    );
}
