"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { Textarea } from "@app/components/ui/textarea";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { GetBrowserTargetResponse } from "@server/routers/browserGatewayTarget";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
} from "@app/components/ui/card";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import type { SignSshKeyResponse } from "@server/routers/ssh/types";
import { useTranslations } from "next-intl";
import BrandedAuthSurface from "@app/components/BrandedAuthSurface";
import PoweredByPangolin from "@app/components/PoweredByPangolin";
import AuthPageFooterNotices from "@app/components/AuthPageFooterNotices";
import {
    loadEncryptedLocalStorage,
    saveEncryptedLocalStorage
} from "@app/lib/secureLocalStorage";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";

type AuthTab = "password" | "privateKey";

type SshCredentialsForm = {
    username: string;
    password: string;
    privateKey: string;
};

type ConnectCredentials = {
    username: string;
    password?: string;
    privateKey?: string;
    certificate?: string;
};

const DEFAULT_SSH_CREDENTIALS: SshCredentialsForm = {
    username: "",
    password: "",
    privateKey: ""
};

export default function SshClient({
    target,
    error,
    signedKeyData,
    privateKey: signedPrivateKey,
    primaryColor
}: {
    target: GetBrowserTargetResponse | null;
    error: string | null;
    signedKeyData?: SignSshKeyResponse | null;
    privateKey?: string | null;
    primaryColor?: string | null;
}) {
    const STORAGE_KEY = "pangolin_ssh_credentials";
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const resourceName = target?.name?.trim() || null;

    const passwordTabSchema = z.object({
        username: z.string().min(1, { message: t("usernameRequired") }),
        password: z.string().min(1, { message: t("passwordRequired") })
    });

    const privateKeyTabSchema = z.object({
        username: z.string().min(1, { message: t("usernameRequired") }),
        privateKey: z.string().min(1, { message: t("sshPrivateKeyRequired") })
    });

    const form = useForm<SshCredentialsForm>({
        defaultValues: DEFAULT_SSH_CREDENTIALS
    });

    useEffect(() => {
        let cancelled = false;

        void loadEncryptedLocalStorage<SshCredentialsForm>(
            STORAGE_KEY,
            target?.authToken
        ).then((saved) => {
            if (cancelled || !saved) return;
            form.reset({ ...DEFAULT_SSH_CREDENTIALS, ...saved });
        });

        return () => {
            cancelled = true;
        };
    }, [form, target?.authToken]);

    function handleKeyFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result;
            if (typeof text === "string") {
                form.setValue("privateKey", text, { shouldDirty: true });
            }
        };
        reader.readAsText(file);
        e.target.value = "";
    }

    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);
    const [sessionClosedCode, setSessionClosedCode] = useState<number | null>(
        null
    );

    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
    const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(
        null
    );
    const wsRef = useRef<WebSocket | null>(null);

    // Mount the terminal div once connected.
    useEffect(() => {
        if (!connected || !terminalRef.current) return;

        let cancelled = false;

        (async () => {
            const [{ Terminal }, { FitAddon }, { WebLinksAddon }] =
                await Promise.all([
                    import("@xterm/xterm"),
                    import("@xterm/addon-fit"),
                    import("@xterm/addon-web-links")
                ]);
            if (cancelled || !terminalRef.current) return;

            const terminal = new Terminal({
                cursorBlink: true,
                fontSize: 14,
                fontFamily: "Menlo, Monaco, 'Courier New', monospace",
                theme: {
                    background: "#0d0d0d",
                    foreground: "#f0f0f0"
                },
                scrollback: 5000
            });

            const fitAddon = new FitAddon();
            const webLinksAddon = new WebLinksAddon();
            terminal.loadAddon(fitAddon);
            terminal.loadAddon(webLinksAddon);

            terminal.open(terminalRef.current);
            fitAddon.fit();

            xtermRef.current = terminal;
            fitAddonRef.current = fitAddon;

            terminal.onData((data) => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: "data", data }));
                }
            });

            terminal.onResize(({ cols, rows }) => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(
                        JSON.stringify({ type: "resize", cols, rows })
                    );
                }
            });

            const { cols, rows } = terminal;
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(
                    JSON.stringify({ type: "resize", cols, rows })
                );
            }
        })().catch(console.error);

        return () => {
            cancelled = true;
        };
    }, [connected]);

    useEffect(() => {
        const onResize = () => fitAddonRef.current?.fit();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    useEffect(() => {
        return () => {
            wsRef.current?.close();
            xtermRef.current?.dispose();
        };
    }, []);

    useEffect(() => {
        if (signedKeyData && signedPrivateKey && target) {
            connect({
                username: signedKeyData.sshUsername,
                privateKey: signedPrivateKey,
                certificate: signedKeyData.certificate
            });
        }
    }, []);

    function connect(
        override?: ConnectCredentials,
        authMethod: AuthTab = "password"
    ) {
        setConnecting(true);
        setSessionClosedCode(null);
        setConnectError(null);

        if (!target) {
            setConnectError(t("sshErrorNoTarget"));
            setConnecting(false);
            return;
        }

        const values = form.getValues();
        const username = override?.username ?? values.username;
        const password =
            override?.password ??
            (authMethod === "password" ? values.password : "");
        const privateKey =
            override?.privateKey ??
            (authMethod === "privateKey" ? values.privateKey : "");
        const certificate = override?.certificate;

        const proxyAddress = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/gateway/ssh`;
        const url = new URL(proxyAddress);
        url.searchParams.set(
            "mode",
            target.authDaemonMode === "native" ? "native" : "proxy"
        );
        if (target.authDaemonMode !== "native") {
            url.searchParams.set("host", target.ip ?? "");
            url.searchParams.set("port", String(target.port ?? 22));
        }
        url.searchParams.set("username", username);
        url.searchParams.set("authToken", target.authToken ?? "");

        const ws = new WebSocket(url.toString(), ["ssh"]);
        wsRef.current = ws;

        let authConfirmed = false;
        let authErrorShown = false;
        let socketOpened = false;
        let auditLogged = false;

        const logAudit = (action: boolean) => {
            if (auditLogged || !target) return;
            auditLogged = true;
            void api.post(`/org/${target.orgId}/logs/access/attempt`, {
                resourceId: target.resourceId,
                action,
                type: "ssh"
            });
        };

        ws.onopen = () => {
            socketOpened = true;
            ws.send(
                JSON.stringify({
                    type: "auth",
                    password,
                    privateKey,
                    certificate
                })
            );
            if (!override) {
                void saveEncryptedLocalStorage(
                    STORAGE_KEY,
                    form.getValues(),
                    target.authToken
                );
            }
        };

        ws.onmessage = (evt) => {
            if (typeof evt.data === "string") {
                try {
                    const msg = JSON.parse(evt.data as string) as {
                        type: string;
                        data?: string;
                        error?: string;
                    };
                    if (msg.type === "data" && msg.data) {
                        if (!authConfirmed) {
                            authConfirmed = true;
                            logAudit(true);
                            setConnecting(false);
                            setConnected(true);
                        }
                        xtermRef.current?.write(msg.data);
                    } else if (msg.type === "error") {
                        if (!authConfirmed) {
                            authErrorShown = true;
                            logAudit(false);
                            setConnecting(false);
                            setConnectError(
                                msg.error ?? t("sshErrorAuthFailed")
                            );
                        } else {
                            xtermRef.current?.writeln(
                                `\r\n\x1b[31m${t("sshTerminalError", { error: msg.error ?? "" })}\x1b[0m\r\n`
                            );
                        }
                    }
                } catch {
                    if (!authConfirmed) {
                        authConfirmed = true;
                        setConnecting(false);
                        setConnected(true);
                    }
                    xtermRef.current?.write(evt.data);
                }
            } else if (evt.data instanceof Blob) {
                evt.data.text().then((text) => {
                    if (!authConfirmed) {
                        authConfirmed = true;
                        logAudit(true);
                        setConnecting(false);
                        setConnected(true);
                    }
                    xtermRef.current?.write(text);
                });
            }
        };

        ws.onerror = () => {
            logAudit(false);
            setConnecting(false);
            setConnected(false);
            setConnectError(t("sshErrorWebSocket"));
        };

        ws.onclose = (evt) => {
            wsRef.current = null;
            setConnecting(false);
            const isCleanClose = evt.wasClean || evt.code === 1000;
            if (isCleanClose && (authConfirmed || socketOpened)) {
                xtermRef.current?.dispose();
                xtermRef.current = null;
                setConnected(false);
                setSessionClosedCode(evt.code);
                return;
            }
            if (authConfirmed) {
                setConnected(false);
                xtermRef.current?.writeln(
                    `\r\n\x1b[33m${t("sshConnectionClosedCode", { code: evt.code })}\x1b[0m\r\n`
                );
            }
            if (!authConfirmed && !authErrorShown) {
                logAudit(false);
                setConnectError(t("sshErrorConnectionClosed"));
            }
        };
    }

    function disconnect() {
        wsRef.current?.close();
        xtermRef.current?.dispose();
        xtermRef.current = null;
        setConnected(false);
    }

    function applyTabSchemaErrors(
        schema: z.ZodObject<z.ZodRawShape>,
        values: SshCredentialsForm
    ) {
        form.clearErrors();
        const result = schema.safeParse(values);
        if (result.success) return true;
        for (const issue of result.error.issues) {
            const field = issue.path[0];
            if (typeof field === "string") {
                form.setError(field as keyof SshCredentialsForm, {
                    message: issue.message
                });
            }
        }
        return false;
    }

    function onPasswordSubmit(e: React.FormEvent) {
        e.preventDefault();
        setConnectError(null);
        const values = form.getValues();
        if (!applyTabSchemaErrors(passwordTabSchema, values)) return;
        connect(undefined, "password");
    }

    function onPrivateKeySubmit(e: React.FormEvent) {
        e.preventDefault();
        setConnectError(null);
        const values = form.getValues();
        if (!applyTabSchemaErrors(privateKeyTabSchema, values)) return;
        connect(undefined, "privateKey");
    }

    if (signedKeyData && signedPrivateKey) {
        return (
            <>
                {!connected && (
                    <div className="flex items-center justify-center">
                        <Card className="w-full max-w-md">
                            <CardHeader>
                                <CardTitle>{t("sshTitle")}</CardTitle>
                                <CardDescription>
                                    {t("sshConnectingDescription")}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex flex-col items-center space-y-4">
                                {!connectError && (
                                    <div className="flex items-center space-x-2">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        <span>
                                            {connecting
                                                ? t("sshConnecting")
                                                : t("sshInitializing")}
                                        </span>
                                    </div>
                                )}
                                {connectError && (
                                    <Alert
                                        variant="destructive"
                                        className="w-full"
                                    >
                                        <AlertDescription>
                                            {connectError}
                                        </AlertDescription>
                                    </Alert>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                )}
                {connected && (
                    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-900">
                        <div
                            ref={terminalRef}
                            className="flex-1 overflow-hidden"
                            style={{ minHeight: 0 }}
                        />
                    </div>
                )}
            </>
        );
    }

    if (error) {
        return (
            <BrandedAuthSurface primaryColor={primaryColor}>
                <PoweredByPangolin />
                <Card className="w-full">
                    <CardHeader>
                        <CardTitle>{t("sshTitle")}</CardTitle>
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

    if (sessionClosedCode !== null) {
        return (
            <BrandedAuthSurface primaryColor={primaryColor}>
                <PoweredByPangolin />
                <Card className="w-full max-w-md">
                    <CardHeader>
                        <CardTitle>{t("sshTitle")}</CardTitle>
                        <CardDescription>
                            {t("sshConnectionClosedCode", {
                                code: sessionClosedCode
                            })}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Alert>
                            <AlertDescription>
                                This session has ended. You can close this tab
                                now.
                            </AlertDescription>
                        </Alert>
                        <Button
                            type="button"
                            className="w-full"
                            onClick={() => window.close()}
                        >
                            {t("close")}
                        </Button>
                    </CardContent>
                </Card>
                <AuthPageFooterNotices />
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
                            <CardTitle>{t("sshSignInTitle")}</CardTitle>
                            <CardDescription>
                                {resourceName
                                    ? `${t("sshSignInDescription")} (${resourceName})`
                                    : t("sshSignInDescription")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Form {...form}>
                                <HorizontalTabs
                                    clientSide
                                    defaultTab={0}
                                    items={[
                                        {
                                            title: t("sshPasswordTab"),
                                            href: "#"
                                        },
                                        {
                                            title: t("sshPrivateKeyTab"),
                                            href: "#"
                                        }
                                    ]}
                                >
                                    <form
                                        onSubmit={onPasswordSubmit}
                                        className="space-y-4 mt-4 p-1"
                                    >
                                        <FormField
                                            control={form.control}
                                            name="username"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("username")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input {...field} />
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
                                                        {t("password")}
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
                                        <div className="mt-4 space-y-3">
                                            <Button
                                                type="submit"
                                                loading={connecting}
                                                disabled={connecting}
                                                className="w-full"
                                            >
                                                {t("sshAuthenticate")}
                                            </Button>
                                            {connectError && (
                                                <Alert variant="destructive">
                                                    <AlertDescription>
                                                        {connectError}
                                                    </AlertDescription>
                                                </Alert>
                                            )}
                                        </div>
                                    </form>

                                    <form
                                        onSubmit={onPrivateKeySubmit}
                                        className="space-y-4 mt-4 p-1"
                                    >
                                        <p className="text-sm text-muted-foreground">
                                            {t("sshPrivateKeyDisclaimer")}{" "}
                                            <Link
                                                href="https://docs.pangolin.net/manage/ssh#authentication-method"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-primary hover:underline inline-flex items-center gap-1"
                                            >
                                                {t("sshLearnMore")}
                                                <ExternalLink className="size-3.5 shrink-0" />
                                            </Link>
                                        </p>
                                        <FormField
                                            control={form.control}
                                            name="username"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t("username")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="privateKey"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            "sshPrivateKeyField"
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Textarea
                                                            {...field}
                                                            placeholder={t(
                                                                "sshPrivateKeyPlaceholder"
                                                            )}
                                                            rows={5}
                                                            className="font-mono text-xs"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormItem>
                                            <FormLabel>
                                                {t("sshPrivateKeyFile")}
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="file"
                                                    accept=".pem,.key,.pub,*"
                                                    onChange={handleKeyFile}
                                                />
                                            </FormControl>
                                        </FormItem>
                                        <div className="mt-4 space-y-3">
                                            <Button
                                                type="submit"
                                                loading={connecting}
                                                disabled={connecting}
                                                className="w-full"
                                            >
                                                {t("sshAuthenticate")}
                                            </Button>
                                            {connectError && (
                                                <Alert variant="destructive">
                                                    <AlertDescription>
                                                        {connectError}
                                                    </AlertDescription>
                                                </Alert>
                                            )}
                                        </div>
                                    </form>
                                </HorizontalTabs>
                            </Form>
                        </CardContent>
                    </Card>
                    <AuthPageFooterNotices />
                </BrandedAuthSurface>
            )}

            {connected && (
                <div className="fixed inset-0 z-50 flex flex-col bg-neutral-900">
                    {/* <div className="flex flex-wrap items-center gap-2 bg-black p-2 text-white">
                        <Button
                            size="sm"
                            variant="destructive"
                            onClick={disconnect}
                        >
                            {t("sshTerminate")}
                        </Button>
                    </div> */}
                    <div
                        ref={terminalRef}
                        className="flex-1 overflow-hidden"
                        style={{ minHeight: 0 }}
                    />
                </div>
            )}
        </>
    );
}
