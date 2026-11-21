"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { Checkbox } from "@app/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@app/components/ui/tabs";
import { runRdpEntraPopup } from "@app/lib/rdpEntraPopup";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { toast } from "@app/hooks/useToast";
import type {
    UserInteraction,
    IronError,
    FileTransferProvider
} from "@devolutions/iron-remote-desktop/dist";
import type {
    RdpFileTransferProvider,
    FileInfo
} from "@devolutions/iron-remote-desktop-rdp/dist";
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

declare module "react" {
    namespace JSX {
        interface IntrinsicElements {
            "iron-remote-desktop": React.DetailedHTMLProps<
                React.HTMLAttributes<HTMLElement> & {
                    scale?: string;
                    verbose?: string;
                    flexcenter?: string;
                    module?: unknown;
                },
                HTMLElement
            >;
        }
    }
}

type RdpCredentialsForm = {
    username: string;
    password: string;
    domain: string;
    kdcProxyUrl: string;
    pcb: string;
    enableClipboard: boolean;
    // Network Level Authentication (CredSSP). When off, the client connects
    // with TLS only and the Windows sign-in screen handles the logon. Needed
    // for hosts whose accounts NTLM cannot resolve, e.g. Microsoft Entra
    // joined devices without on-premises Active Directory.
    nla: boolean;
    // "entra" signs in with a Microsoft Entra ID token (RDS AAD Auth), which
    // keeps NLA on for Entra joined hosts.
    authMode: "password" | "entra";
    entraIdpId: string;
    // Device ID or computer name of the host in Entra ID
    entraDeviceName: string;
};

const DEFAULT_RDP_CREDENTIALS: RdpCredentialsForm = {
    username: "",
    password: "",
    domain: "",
    kdcProxyUrl: "",
    pcb: "",
    enableClipboard: true,
    nla: true,
    authMode: "password",
    entraIdpId: "",
    entraDeviceName: ""
};

// Entra device names are NetBIOS-style computer names without a suffix.
const ENTRA_DEVICE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

// A device in GUID form is an Entra device ID. The server builds the token
// scope by the same rule, and the assertion has to name the host the same way.
const ENTRA_DEVICE_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTRA_RDP_RESOURCE = "ms-device-service://termsrv.wvd.microsoft.com";

type EntraAssertionParams = {
    accessToken: string;
    resourceUri: string;
    serverNonce: string;
    aadNonce: string;
    key: CryptoKeyPair;
};

type EntraSignIn = {
    accessToken: string;
    nonce: string;
    // Proof-of-possession key the token is bound to; it never leaves the page.
    key: CryptoKeyPair;
    deviceName: string;
};

// Numeric values of `IronErrorKind` from @devolutions/iron-remote-desktop.
// The runtime bundle only ships the enum as a type declaration, so the
// values are mirrored here for classifying connection failures.
const IRON_ERROR_KIND = {
    WrongPassword: 1,
    LogonFailure: 2,
    AccessDenied: 3,
    NegotiationFailure: 6
} as const;

const isIronError = (error: unknown): error is IronError => {
    return (
        typeof error === "object" &&
        error !== null &&
        typeof (error as IronError).backtrace === "function" &&
        typeof (error as IronError).kind === "function"
    );
};

export default function RdpClient({
    target,
    error,
    primaryColor
}: {
    target: GetBrowserTargetResponse | null;
    error: string | null;
    primaryColor?: string | null;
}) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const STORAGE_KEY = "pangolin_rdp_credentials";
    const resourceName = target?.name?.trim() || null;
    const entraIdps = target?.entraIdps ?? [];
    // Set on the resource by an admin; used unless the user enters another
    // device.
    const entraDeviceId = target?.rdpEntraDeviceId ?? null;

    const formSchema = z
        .object({
            username: z.string(),
            password: z.string(),
            domain: z.string(),
            kdcProxyUrl: z.string(),
            pcb: z.string(),
            enableClipboard: z.boolean(),
            nla: z.boolean(),
            authMode: z.enum(["password", "entra"]),
            entraIdpId: z.string(),
            entraDeviceName: z.string()
        })
        .superRefine((values, ctx) => {
            if (values.authMode === "entra") {
                if (values.entraDeviceName.length === 0) {
                    if (entraDeviceId) {
                        return;
                    }
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["entraDeviceName"],
                        message: t("rdpEntraDeviceNameRequired")
                    });
                } else if (
                    !ENTRA_DEVICE_NAME_PATTERN.test(values.entraDeviceName)
                ) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["entraDeviceName"],
                        message: t("rdpEntraDeviceNameInvalid")
                    });
                }
                return;
            }
            // Without NLA the user can sign in on the Windows logon screen,
            // so credentials are only mandatory when CredSSP is used.
            if (!values.nla) return;
            if (values.username.length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["username"],
                    message: t("usernameRequired")
                });
            }
            if (values.password.length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["password"],
                    message: t("passwordRequired")
                });
            }
        });

    const form = useForm<RdpCredentialsForm>({
        resolver: zodResolver(formSchema),
        defaultValues: DEFAULT_RDP_CREDENTIALS
    });
    const authMode = form.watch("authMode");

    useEffect(() => {
        let cancelled = false;

        void loadEncryptedLocalStorage<RdpCredentialsForm>(
            STORAGE_KEY,
            target?.authToken
        ).then((saved) => {
            if (cancelled || !saved) return;
            const restored = { ...DEFAULT_RDP_CREDENTIALS, ...saved };
            if (restored.authMode === "entra" && entraIdps.length === 0) {
                restored.authMode = "password";
            }
            if (entraDeviceId) {
                // The resource's own device is the default; a device from an
                // earlier session must not silently replace it.
                restored.entraDeviceName = "";
            }
            form.reset(restored);
        });

        return () => {
            cancelled = true;
        };
    }, [form, target?.authToken]);

    const [showLogin, setShowLogin] = useState(true);
    const [moduleReady, setModuleReady] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitErrorDetails, setSubmitErrorDetails] = useState<string | null>(
        null
    );
    const [unicodeMode, setUnicodeMode] = useState(false);
    const [cursorOverrideActive, setCursorOverrideActive] = useState(false);

    const userInteractionRef = useRef<UserInteraction | null>(null);
    const backendRef = useRef<unknown>(null);
    // Holds the RdpFileTransferProvider constructor so we can create a fresh
    // instance per session (avoids stale upload state across reconnects).
    const fileTransferClassRef = useRef<typeof RdpFileTransferProvider | null>(
        null
    );
    // Active session's provider instance; replaced on each connect.
    const fileTransferRef = useRef<RdpFileTransferProvider | null>(null);
    const extensionsRef = useRef<{
        displayControl: (enable: boolean) => unknown;
        preConnectionBlob: (pcb: string) => unknown;
        kdcProxyUrl: (url: string) => unknown;
        enableCredssp: (enable: boolean) => unknown;
        entraAssertion: (
            sign: (serverNonce: string) => Promise<string>
        ) => unknown;
        generateEntraPopKey: () => Promise<CryptoKeyPair>;
        entraReqCnf: (publicKey: CryptoKey) => Promise<string>;
        signEntraAssertion: (params: EntraAssertionParams) => Promise<string>;
    } | null>(null);

    // Load the iron-remote-desktop modules client-side and register the
    // `<iron-remote-desktop>` custom element.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [coreMod, rdpMod] = await Promise.all([
                import("@devolutions/iron-remote-desktop/dist"),
                import("@devolutions/iron-remote-desktop-rdp/dist")
            ]);
            if (cancelled) return;

            await rdpMod.init("INFO");

            backendRef.current = rdpMod.Backend;
            extensionsRef.current = {
                displayControl: rdpMod.displayControl,
                preConnectionBlob: rdpMod.preConnectionBlob,
                kdcProxyUrl: rdpMod.kdcProxyUrl,
                enableCredssp: rdpMod.enableCredssp,
                entraAssertion: rdpMod.entraAssertion,
                generateEntraPopKey: rdpMod.generateEntraPopKey,
                entraReqCnf: rdpMod.entraReqCnf,
                signEntraAssertion: rdpMod.signEntraAssertion
            };

            // Store the class; a fresh instance is created per session.
            fileTransferClassRef.current =
                rdpMod.RdpFileTransferProvider as unknown as typeof RdpFileTransferProvider;

            // Importing the package registers the custom element as a side
            // effect. Touch the default export to avoid tree-shaking.
            void coreMod;

            setModuleReady(true);
        })().catch((err) => {
            console.error("Failed to load iron-remote-desktop modules", err);
            toast({
                variant: "destructive",
                title: t("rdpFailedToLoadModule"),
                description: `${err}`
            });
        });

        return () => {
            cancelled = true;
        };
    }, []);

    // Attach the "ready" listener synchronously the moment the custom
    // element mounts. The custom element dispatches `ready` from its own
    // `onMount`, so a deferred useEffect can race and miss it.
    const remoteElementRef = (el: HTMLElement | null) => {
        if (!el) return;
        const onReady = (e: Event) => {
            const event = e as CustomEvent;
            userInteractionRef.current = event.detail.irgUserInteraction;
        };
        el.addEventListener("ready", onReady);
    };

    // Turn an IronRDP failure into a user-facing summary. The raw backtrace
    // is kept as details so the underlying protocol error stays visible.
    const describeConnectError = (
        err: unknown,
        nlaEnabled: boolean,
        entra: boolean
    ): { message: string; details: string | null } => {
        if (!isIronError(err)) {
            return { message: `${err}`, details: null };
        }
        const details = err.backtrace();
        switch (err.kind()) {
            case IRON_ERROR_KIND.WrongPassword:
                return { message: t("rdpErrorWrongPassword"), details };
            case IRON_ERROR_KIND.LogonFailure:
                if (entra) {
                    return { message: t("rdpErrorEntraLogonFailure"), details };
                }
                // NTLM rejected the account. On Microsoft Entra joined
                // hosts (no on-premises AD) this happens for every
                // username format because NTLM cannot resolve cloud-only
                // identities, so point at the NLA switch.
                return {
                    message: nlaEnabled
                        ? `${t("rdpErrorLogonFailure")} ${t("rdpErrorLogonFailureNlaHint")}`
                        : t("rdpErrorLogonFailure"),
                    details
                };
            case IRON_ERROR_KIND.AccessDenied:
                return { message: t("rdpErrorAccessDenied"), details };
            case IRON_ERROR_KIND.NegotiationFailure:
                return {
                    message: nlaEnabled
                        ? t("rdpErrorNegotiationFailed")
                        : `${t("rdpErrorNegotiationFailed")} ${t("rdpErrorNegotiationFailedNlaHint")}`,
                    details
                };
            default:
                return { message: t("rdpConnectionFailed"), details };
        }
    };

    const runEntraPopup = (
        idpId: string,
        params: () => Promise<Record<string, string>>
    ) =>
        runRdpEntraPopup({
            dashboardUrl: env.app.dashboardUrl,
            idpId,
            params,
            messages: {
                noIdp: t("rdpEntraNoIdp"),
                popupBlocked: t("rdpEntraPopupBlocked"),
                cancelled: t("rdpEntraSignInCancelled"),
                timeout: t("rdpEntraSignInTimeout")
            }
        });

    // Runs the Microsoft sign-in and resolves with a token bound to a fresh
    // key held by this page.
    const signInWithEntra = async (
        values: RdpCredentialsForm,
        generatePopKey: () => Promise<CryptoKeyPair>,
        reqCnfOf: (publicKey: CryptoKey) => Promise<string>
    ): Promise<EntraSignIn> => {
        const idpId = values.entraIdpId || String(entraIdps[0]?.idpId ?? "");
        const device = values.entraDeviceName || entraDeviceId || "";
        // Filled in by the popup's parameter callback, after the window opens.
        const pop: { key?: CryptoKeyPair } = {};

        const result = await runEntraPopup(idpId, async () => {
            pop.key = await generatePopKey();
            return {
                deviceName: device,
                reqCnf: await reqCnfOf(pop.key.publicKey)
            };
        });

        if (
            !pop.key ||
            !result.accessToken ||
            !result.nonce ||
            result.deviceName !== device
        ) {
            throw new Error(t("rdpEntraSignInFailed"));
        }

        return {
            accessToken: result.accessToken,
            nonce: result.nonce,
            key: pop.key,
            deviceName: device
        };
    };

    const [entraDevices, setEntraDevices] = useState<
        { deviceId: string; name: string }[] | null
    >(null);
    const [loadingEntraDevices, setLoadingEntraDevices] = useState(false);

    const loadEntraDevices = async () => {
        const idpId =
            form.getValues("entraIdpId") || String(entraIdps[0]?.idpId ?? "");
        setLoadingEntraDevices(true);
        try {
            const result = await runEntraPopup(idpId, async () => ({
                purpose: "devices"
            }));
            const devices = result.devices ?? [];
            setEntraDevices(devices);
            if (devices.length === 1) {
                form.setValue("entraDeviceName", devices[0].deviceId, {
                    shouldValidate: true
                });
            }
        } catch (err) {
            toast({
                variant: "destructive",
                title: t("rdpEntraDevicesFailed"),
                description: err instanceof Error ? err.message : String(err)
            });
        } finally {
            setLoadingEntraDevices(false);
        }
    };

    const startSession = async (values: RdpCredentialsForm) => {
        setConnecting(true);
        const userInteraction = userInteractionRef.current;
        const exts = extensionsRef.current;
        if (!userInteraction || !exts) {
            setConnecting(false);
            setSubmitError(t("rdpModuleInitializing"));
            return;
        }

        const useEntra = values.authMode === "entra" && entraIdps.length > 0;
        let entra: EntraSignIn | null = null;
        if (useEntra) {
            try {
                entra = await signInWithEntra(
                    values,
                    exts.generateEntraPopKey,
                    exts.entraReqCnf
                );
            } catch (err) {
                setConnecting(false);
                setSubmitError(err instanceof Error ? err.message : `${err}`);
                return;
            }
        }

        userInteraction.setEnableClipboard(values.enableClipboard);

        // Dispose any previous session's provider and create a fresh one so
        // there is no stale upload state from a prior connection.
        fileTransferRef.current?.dispose();
        const ProviderClass = fileTransferClassRef.current;
        const fileTransfer = ProviderClass ? new ProviderClass() : null;
        fileTransferRef.current = fileTransfer;

        if (fileTransfer) {
            // Auto-download files when the remote copies them to clipboard.
            fileTransfer.on("files-available", (files: FileInfo[]) => {
                const downloadable = files.filter((f) => !f.isDirectory);
                if (downloadable.length === 0) return;
                toast({
                    title: t("rdpDownloadingFiles", {
                        count: downloadable.length
                    })
                });
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    if (file.isDirectory) continue;
                    const { completion } = fileTransfer.downloadFile(file, i);
                    completion
                        .then((blob) => {
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = file.name;
                            a.click();
                            URL.revokeObjectURL(url);
                        })
                        .catch((err) => {
                            toast({
                                variant: "destructive",
                                title: t("rdpDownloadFailed", {
                                    fileName: file.name
                                }),
                                description: `${err}`
                            });
                        });
                }
            });

            // Notify when individual uploads complete (remote pasted a file).
            fileTransfer.on("upload-complete", (file: File) => {
                toast({ title: t("rdpUploaded", { fileName: file.name }) });
            });

            // Register with the web component so CLIPRDR extensions are
            // wired up before connect() builds the session.
            userInteraction.enableFileTransfer(
                fileTransfer as unknown as FileTransferProvider
            );
        }

        if (!target) {
            setConnecting(false);
            setSubmitError(t("rdpNoConnectionTarget"));
            return;
        }

        const destination = `${target.ip}:${target.port}`;

        const builder = userInteraction
            .configBuilder()
            .withUsername(values.username)
            .withPassword(values.password)
            .withDestination(destination)
            .withProxyAddress(
                `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/gateway/rdp`
            )
            .withServerDomain(values.domain)
            .withAuthToken(target.authToken)
            .withDesktopSize({
                width: window.innerWidth,
                height: window.innerHeight
            })
            .withExtension(exts.displayControl(true));

        if (values.pcb !== "") {
            builder.withExtension(exts.preConnectionBlob(values.pcb));
        }
        if (values.kdcProxyUrl !== "") {
            builder.withExtension(exts.kdcProxyUrl(values.kdcProxyUrl));
        }
        if (entra) {
            const { accessToken, nonce, key, deviceName } = entra;
            const form = ENTRA_DEVICE_ID_PATTERN.test(deviceName)
                ? "id"
                : "name";
            const resourceUri = `${ENTRA_RDP_RESOURCE}/${form}/${deviceName}`;
            builder.withExtension(
                exts.entraAssertion((serverNonce) =>
                    exts.signEntraAssertion({
                        accessToken,
                        resourceUri,
                        serverNonce,
                        aadNonce: nonce,
                        key
                    })
                )
            );
        } else if (!values.nla) {
            builder.withExtension(exts.enableCredssp(false));
        }

        try {
            const sessionInfo = await userInteraction.connect(builder.build());

            void saveEncryptedLocalStorage(
                STORAGE_KEY,
                values,
                target.authToken
            );
            void api.post(`/org/${target.orgId}/logs/access/attempt`, {
                resourceId: target.resourceId,
                action: true,
                type: "rdp"
            });
            setConnecting(false);
            setShowLogin(false);
            userInteraction.setVisibility(true);

            const termInfo = await sessionInfo.run();
            fileTransferRef.current?.dispose();
            fileTransferRef.current = null;
            setShowLogin(true);
        } catch (err) {
            void api.post(`/org/${target.orgId}/logs/access/attempt`, {
                resourceId: target.resourceId,
                action: false,
                type: "rdp"
            });
            setConnecting(false);
            setShowLogin(true);
            const { message, details } = describeConnectError(
                err,
                values.nla,
                entra !== null
            );
            setSubmitError(message);
            setSubmitErrorDetails(details);
        }
    };

    const onSubmit = (values: RdpCredentialsForm) => {
        setSubmitError(null);
        setSubmitErrorDetails(null);
        startSession(values);
    };

    const ui = () => userInteractionRef.current;

    const toggleCursorKind = () => {
        const u = ui();
        if (!u) return;
        if (cursorOverrideActive) {
            u.setCursorStyleOverride(null);
        } else {
            u.setCursorStyleOverride('url("crosshair.png") 7 7, default');
        }
        setCursorOverrideActive((v) => !v);
    };

    if (error) {
        return (
            <BrandedAuthSurface primaryColor={primaryColor}>
                <PoweredByPangolin />
                <Card className="w-full">
                    <CardHeader>
                        <CardTitle>{t("rdpTitle")}</CardTitle>
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
            {showLogin && (
                <BrandedAuthSurface primaryColor={primaryColor}>
                    <PoweredByPangolin />
                    <Card className="w-full">
                        <CardHeader>
                            <CardTitle>{t("rdpSignInTitle")}</CardTitle>
                            <CardDescription>
                                {resourceName
                                    ? `${t("rdpSignInDescription")} (${resourceName})`
                                    : t("rdpSignInDescription")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Form {...form}>
                                <form
                                    onSubmit={form.handleSubmit(onSubmit)}
                                    className="space-y-4"
                                >
                                    {entraIdps.length > 0 && (
                                        <FormField
                                            control={form.control}
                                            name="authMode"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <Tabs
                                                        value={field.value}
                                                        onValueChange={
                                                            field.onChange
                                                        }
                                                    >
                                                        <TabsList className="grid w-full grid-cols-2">
                                                            <TabsTrigger value="password">
                                                                {t(
                                                                    "rdpAuthModePassword"
                                                                )}
                                                            </TabsTrigger>
                                                            <TabsTrigger value="entra">
                                                                {t(
                                                                    "rdpAuthModeEntra"
                                                                )}
                                                            </TabsTrigger>
                                                        </TabsList>
                                                    </Tabs>
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                    {authMode === "entra" && (
                                        <>
                                            {entraIdps.length > 1 && (
                                                <FormField
                                                    control={form.control}
                                                    name="entraIdpId"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "rdpEntraIdp"
                                                                )}
                                                            </FormLabel>
                                                            <Select
                                                                value={
                                                                    field.value ||
                                                                    String(
                                                                        entraIdps[0]
                                                                            .idpId
                                                                    )
                                                                }
                                                                onValueChange={
                                                                    field.onChange
                                                                }
                                                            >
                                                                <FormControl>
                                                                    <SelectTrigger>
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                </FormControl>
                                                                <SelectContent>
                                                                    {entraIdps.map(
                                                                        (
                                                                            entraIdp
                                                                        ) => (
                                                                            <SelectItem
                                                                                key={
                                                                                    entraIdp.idpId
                                                                                }
                                                                                value={String(
                                                                                    entraIdp.idpId
                                                                                )}
                                                                            >
                                                                                {
                                                                                    entraIdp.name
                                                                                }
                                                                            </SelectItem>
                                                                        )
                                                                    )}
                                                                </SelectContent>
                                                            </Select>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                            <FormField
                                                control={form.control}
                                                name="entraDeviceName"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(
                                                                "rdpEntraDeviceName"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                autoComplete="off"
                                                                placeholder={
                                                                    entraDeviceId ??
                                                                    undefined
                                                                }
                                                                {...field}
                                                            />
                                                        </FormControl>
                                                        <FormDescription>
                                                            {t(
                                                                entraDeviceId
                                                                    ? "rdpEntraDeviceDefaultDescription"
                                                                    : "rdpEntraDeviceNameDescription"
                                                            )}
                                                        </FormDescription>
                                                        {entraDevices &&
                                                            entraDevices.length >
                                                                0 && (
                                                                <Select
                                                                    value={
                                                                        entraDevices.some(
                                                                            (
                                                                                device
                                                                            ) =>
                                                                                device.deviceId ===
                                                                                field.value
                                                                        )
                                                                            ? field.value
                                                                            : ""
                                                                    }
                                                                    onValueChange={
                                                                        field.onChange
                                                                    }
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue
                                                                            placeholder={t(
                                                                                "rdpEntraDeviceSelect"
                                                                            )}
                                                                        />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {entraDevices.map(
                                                                            (
                                                                                device
                                                                            ) => (
                                                                                <SelectItem
                                                                                    key={
                                                                                        device.deviceId
                                                                                    }
                                                                                    value={
                                                                                        device.deviceId
                                                                                    }
                                                                                >
                                                                                    {
                                                                                        device.name
                                                                                    }
                                                                                </SelectItem>
                                                                            )
                                                                        )}
                                                                    </SelectContent>
                                                                </Select>
                                                            )}
                                                        {entraDevices &&
                                                            entraDevices.length ===
                                                                0 && (
                                                                <FormDescription>
                                                                    {t(
                                                                        "rdpEntraNoDevices"
                                                                    )}
                                                                </FormDescription>
                                                            )}
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            loading={
                                                                loadingEntraDevices
                                                            }
                                                            disabled={
                                                                loadingEntraDevices
                                                            }
                                                            onClick={() =>
                                                                void loadEntraDevices()
                                                            }
                                                        >
                                                            {t(
                                                                "rdpEntraChooseDevice"
                                                            )}
                                                        </Button>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            <FormDescription>
                                                {t("rdpEntraSignInDescription")}
                                            </FormDescription>
                                        </>
                                    )}
                                    {authMode === "password" && (
                                        <>
                                            <FormField
                                                control={form.control}
                                                name="domain"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t("domain")}
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
                                            <FormField
                                                control={form.control}
                                                name="nla"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <div className="flex items-center gap-x-2">
                                                            <FormControl>
                                                                <Checkbox
                                                                    checked={
                                                                        field.value
                                                                    }
                                                                    onCheckedChange={(
                                                                        checked
                                                                    ) =>
                                                                        field.onChange(
                                                                            checked ===
                                                                                true
                                                                        )
                                                                    }
                                                                />
                                                            </FormControl>
                                                            <FormLabel className="cursor-pointer">
                                                                {t(
                                                                    "rdpNetworkLevelAuth"
                                                                )}
                                                            </FormLabel>
                                                        </div>
                                                        <FormDescription>
                                                            {field.value
                                                                ? t(
                                                                      "rdpNetworkLevelAuthDescription"
                                                                  )
                                                                : t(
                                                                      "rdpNetworkLevelAuthDisabledDescription"
                                                                  )}
                                                        </FormDescription>
                                                    </FormItem>
                                                )}
                                            />
                                        </>
                                    )}
                                    <Button
                                        type="submit"
                                        disabled={!moduleReady || connecting}
                                        loading={connecting}
                                        className="w-full"
                                    >
                                        {authMode === "entra"
                                            ? t("rdpEntraSignIn")
                                            : t("browserGatewayConnect")}
                                    </Button>
                                    {submitError && (
                                        <Alert variant="destructive">
                                            <AlertDescription>
                                                <p>{submitError}</p>
                                                {submitErrorDetails && (
                                                    <p className="mt-2 text-xs break-words opacity-80">
                                                        {submitErrorDetails}
                                                    </p>
                                                )}
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                </form>
                            </Form>
                        </CardContent>
                    </Card>
                    <AuthPageFooterNotices />
                </BrandedAuthSurface>
            )}

            <div
                className="fixed inset-0 z-50 flex flex-col bg-neutral-900"
                style={{ display: showLogin ? "none" : "flex" }}
            >
                <CollapsibleSessionToolbar>
                    <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                            ui()?.shutdown();
                            setShowLogin(true);
                        }}
                    >
                        {t("sshTerminate")}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => ui()?.ctrlAltDel()}
                    >
                        {t("browserGatewayCtrlAltDel")}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => ui()?.metaKey()}
                    >
                        {t("rdpMeta")}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                            const ft = fileTransferRef.current;
                            if (!ft) return;
                            const files = await ft.showFilePicker({
                                multiple: true
                            });
                            if (files.length === 0) return;
                            try {
                                ft.uploadFiles(files);
                                toast({
                                    title: t("rdpFilesReadyToPaste"),
                                    description: t(
                                        "rdpFilesReadyToPasteDescription",
                                        { count: files.length }
                                    )
                                });
                            } catch (err) {
                                toast({
                                    variant: "destructive",
                                    title: t("rdpUploadFailed"),
                                    description: `${err}`
                                });
                            }
                        }}
                    >
                        {t("rdpUploadFiles")}
                    </Button>
                    {/* <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => ui()?.setScale(1)}
                    >
                        {t("rdpFit")}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => ui()?.setScale(2)}
                    >
                        {t("rdpFull")}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => ui()?.setScale(3)}
                    >
                        {t("rdpReal")}
                    </Button> */}
                    {/* <Button
                        size="sm"
                        variant="secondary"
                        onClick={toggleCursorKind}
                    >
                        Toggle cursor
                    </Button> */}
                    <label className="ml-2 flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={unicodeMode}
                            onChange={(e) => {
                                setUnicodeMode(e.target.checked);
                                ui()?.setKeyboardUnicodeMode(e.target.checked);
                            }}
                        />
                        {t("rdpUnicodeKeyboardMode")}
                    </label>
                </CollapsibleSessionToolbar>

                {moduleReady && (
                    <iron-remote-desktop
                        ref={remoteElementRef}
                        verbose="true"
                        scale="fit"
                        flexcenter="true"
                        module={backendRef.current}
                    />
                )}
            </div>
        </>
    );
}
