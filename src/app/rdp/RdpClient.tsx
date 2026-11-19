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
};

const DEFAULT_RDP_CREDENTIALS: RdpCredentialsForm = {
    username: "",
    password: "",
    domain: "",
    kdcProxyUrl: "",
    pcb: "",
    enableClipboard: true
};

// How the remote desktop size follows the browser window:
// - "autoSharp": use physical screen pixels (CSS pixels * devicePixelRatio)
//   and pass the scale factor to the server, so the image is not upscaled by
//   the browser on HiDPI screens, with OS display scaling or with browser zoom.
// - "auto": use CSS pixels, but follow window resizes.
// - "fixed": size is taken once at connect time (previous behavior).
type RdpDisplayMode = "autoSharp" | "auto" | "fixed";

const DISPLAY_MODE_STORAGE_KEY = "pangolin_rdp_display_mode";
const DEFAULT_DISPLAY_MODE: RdpDisplayMode = "autoSharp";
const RESIZE_DEBOUNCE_MS = 300;
// The Display Control channel only opens after the Windows logon, which can
// take half a minute. Resize requests sent before that are dropped by IronRDP,
// so they are repeated until the server has resized the canvas once.
const RESIZE_RETRY_INTERVAL_MS = 3000;
const RESIZE_RETRY_TIMEOUT_MS = 90000;

// Limits from MS-RDPEDISP (DISPLAYCONTROL_MONITOR_LAYOUT).
const MIN_DESKTOP_DIMENSION = 200;
const MAX_DESKTOP_DIMENSION = 8192;
const MIN_SCALE_FACTOR = 100;
const MAX_SCALE_FACTOR = 500;

// Values of the ScreenScale enum of iron-remote-desktop.
const SCREEN_SCALE_FIT = 1;
const SCREEN_SCALE_FULL = 2;
const SCREEN_SCALE_REAL = 3;
type ScreenScaleValue =
    | typeof SCREEN_SCALE_FIT
    | typeof SCREEN_SCALE_FULL
    | typeof SCREEN_SCALE_REAL;

type DesktopTarget = {
    width: number;
    height: number;
    scaleFactor: number;
};

const isDisplayMode = (value: unknown): value is RdpDisplayMode =>
    value === "autoSharp" || value === "auto" || value === "fixed";

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

const computeDesktopTarget = (mode: RdpDisplayMode): DesktopTarget => {
    const ratio =
        mode === "autoSharp" && window.devicePixelRatio > 0
            ? window.devicePixelRatio
            : 1;
    let width = clamp(
        Math.round(window.innerWidth * ratio),
        MIN_DESKTOP_DIMENSION,
        MAX_DESKTOP_DIMENSION
    );
    // The monitor width must be an even number.
    width -= width % 2;
    const height = clamp(
        Math.round(window.innerHeight * ratio),
        MIN_DESKTOP_DIMENSION,
        MAX_DESKTOP_DIMENSION
    );
    const scaleFactor = clamp(
        Math.round(ratio * 100),
        MIN_SCALE_FACTOR,
        MAX_SCALE_FACTOR
    );
    return { width, height, scaleFactor };
};

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
    const api = createApiClient(useEnvContext());
    const STORAGE_KEY = "pangolin_rdp_credentials";
    const resourceName = target?.name?.trim() || null;

    const formSchema = z.object({
        username: z.string().min(1, { message: t("usernameRequired") }),
        password: z.string().min(1, { message: t("passwordRequired") }),
        domain: z.string(),
        kdcProxyUrl: z.string(),
        pcb: z.string(),
        enableClipboard: z.boolean()
    });

    const form = useForm<RdpCredentialsForm>({
        resolver: zodResolver(formSchema),
        defaultValues: DEFAULT_RDP_CREDENTIALS
    });

    useEffect(() => {
        let cancelled = false;

        void loadEncryptedLocalStorage<RdpCredentialsForm>(
            STORAGE_KEY,
            target?.authToken
        ).then((saved) => {
            if (cancelled || !saved) return;
            form.reset({ ...DEFAULT_RDP_CREDENTIALS, ...saved });
        });

        return () => {
            cancelled = true;
        };
    }, [form, target?.authToken]);

    const [showLogin, setShowLogin] = useState(true);
    const [moduleReady, setModuleReady] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [unicodeMode, setUnicodeMode] = useState(false);
    const [cursorOverrideActive, setCursorOverrideActive] = useState(false);
    const [displayMode, setDisplayMode] =
        useState<RdpDisplayMode>(DEFAULT_DISPLAY_MODE);

    const userInteractionRef = useRef<UserInteraction | null>(null);
    const displayModeRef = useRef<RdpDisplayMode>(DEFAULT_DISPLAY_MODE);
    const sessionActiveRef = useRef(false);
    const lastDesktopTargetRef = useRef<DesktopTarget | null>(null);
    // Current viewer scaling (1 = fit, 2 = full, 3 = real).
    const screenScaleRef = useRef<ScreenScaleValue>(SCREEN_SCALE_FIT);
    const remoteElementNodeRef = useRef<HTMLElement | null>(null);
    const canvasObserverRef = useRef<MutationObserver | null>(null);
    // Resize request that has not been confirmed by a canvas change yet.
    const pendingResizeRef = useRef<{
        target: DesktopTarget;
        sendScale: boolean;
        since: number;
    } | null>(null);
    const resizeRetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(
        null
    );
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
        desktopScaleFactor: (percent: number) => unknown;
        preConnectionBlob: (pcb: string) => unknown;
        kdcProxyUrl: (url: string) => unknown;
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
                desktopScaleFactor: rdpMod.desktopScaleFactor,
                preConnectionBlob: rdpMod.preConnectionBlob,
                kdcProxyUrl: rdpMod.kdcProxyUrl
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

    // Restore the display mode chosen in this browser.
    useEffect(() => {
        try {
            const saved = window.localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
            if (isDisplayMode(saved)) {
                displayModeRef.current = saved;
                setDisplayMode(saved);
            }
        } catch {
            // localStorage unavailable; keep the default.
        }
    }, []);

    // Ask the server for a new desktop size if the window, the zoom level or
    // the devicePixelRatio changed. Uses the Display Control channel, so the
    // session is not reconnected.
    const applyDynamicResize = () => {
        const mode = displayModeRef.current;
        const u = userInteractionRef.current;
        if (!sessionActiveRef.current || !u || mode === "fixed") return;

        const next = computeDesktopTarget(mode);
        const last = lastDesktopTargetRef.current;
        if (
            last &&
            last.width === next.width &&
            last.height === next.height &&
            last.scaleFactor === next.scaleFactor
        ) {
            return;
        }
        lastDesktopTargetRef.current = next;
        const sendScale = mode === "autoSharp";
        sendResize(next, sendScale);

        // Track the request until the server resized the canvas. A request
        // that keeps the canvas size (scale-only change) cannot be confirmed.
        const canvas = getCanvas();
        if (
            canvas &&
            (canvas.width !== next.width || canvas.height !== next.height)
        ) {
            pendingResizeRef.current = {
                target: next,
                sendScale,
                since: Date.now()
            };
            startResizeRetry();
        } else {
            stopResizeRetry();
        }
    };

    const getCanvas = (): HTMLCanvasElement | null => {
        const el = remoteElementNodeRef.current;
        return (
            el?.shadowRoot?.querySelector("canvas") ??
            el?.querySelector("canvas") ??
            null
        );
    };

    const sendResize = (target: DesktopTarget, sendScale: boolean) => {
        const u = userInteractionRef.current;
        if (!u) return;
        u.resize(
            target.width,
            target.height,
            sendScale ? target.scaleFactor : undefined
        );
        // resize() sizes the viewer to width x height CSS pixels, which is too
        // large when devicePixelRatio > 1, so re-apply the current scaling.
        u.setScale(screenScaleRef.current);
    };

    const stopResizeRetry = () => {
        pendingResizeRef.current = null;
        if (resizeRetryTimerRef.current) {
            clearInterval(resizeRetryTimerRef.current);
            resizeRetryTimerRef.current = null;
        }
    };

    const startResizeRetry = () => {
        if (resizeRetryTimerRef.current) return;
        resizeRetryTimerRef.current = setInterval(() => {
            const pending = pendingResizeRef.current;
            if (
                !pending ||
                !sessionActiveRef.current ||
                Date.now() - pending.since > RESIZE_RETRY_TIMEOUT_MS
            ) {
                stopResizeRetry();
                return;
            }
            sendResize(pending.target, pending.sendScale);
        }, RESIZE_RETRY_INTERVAL_MS);
    };

    // IronRDP resizes the canvas backing store when the server applied a new
    // desktop size, but does not notify the web component (its canvas
    // resized callback is a no-op). Watch the canvas so the viewer is fitted
    // to the new size and pending resize requests are considered done.
    const observeCanvas = () => {
        canvasObserverRef.current?.disconnect();
        const canvas = getCanvas();
        if (!canvas) return;
        const observer = new MutationObserver(() => {
            stopResizeRetry();
            userInteractionRef.current?.setScale(screenScaleRef.current);
        });
        observer.observe(canvas, {
            attributes: true,
            attributeFilter: ["width", "height"]
        });
        canvasObserverRef.current = observer;
    };

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const scheduleResize = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(applyDynamicResize, RESIZE_DEBOUNCE_MS);
        };

        // Moving the window to a screen with a different devicePixelRatio
        // does not always fire a resize event, so watch the ratio as well.
        let dprQuery: MediaQueryList | null = null;
        const onDprChange = () => {
            watchDpr();
            scheduleResize();
        };
        const watchDpr = () => {
            dprQuery?.removeEventListener("change", onDprChange);
            dprQuery = window.matchMedia(
                `(resolution: ${window.devicePixelRatio}dppx)`
            );
            dprQuery.addEventListener("change", onDprChange);
        };

        window.addEventListener("resize", scheduleResize);
        watchDpr();

        return () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener("resize", scheduleResize);
            dprQuery?.removeEventListener("change", onDprChange);
        };
        // applyDynamicResize only reads refs, so registering once is enough.
    }, []);

    const endSession = () => {
        sessionActiveRef.current = false;
        lastDesktopTargetRef.current = null;
        stopResizeRetry();
        canvasObserverRef.current?.disconnect();
        canvasObserverRef.current = null;
    };

    const applyScreenScale = (scale: ScreenScaleValue) => {
        screenScaleRef.current = scale;
        userInteractionRef.current?.setScale(scale);
    };

    const changeDisplayMode = (mode: RdpDisplayMode) => {
        displayModeRef.current = mode;
        setDisplayMode(mode);
        try {
            window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, mode);
        } catch {
            // Not persisted; still applies to this session.
        }
        applyDynamicResize();
    };

    // Attach the "ready" listener synchronously the moment the custom
    // element mounts. The custom element dispatches `ready` from its own
    // `onMount`, so a deferred useEffect can race and miss it.
    const remoteElementRef = (el: HTMLElement | null) => {
        if (!el) return;
        remoteElementNodeRef.current = el;
        const onReady = (e: Event) => {
            const event = e as CustomEvent;
            userInteractionRef.current = event.detail.irgUserInteraction;
        };
        el.addEventListener("ready", onReady);
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

        const mode = displayModeRef.current;
        const connectTarget = computeDesktopTarget(mode);
        const desktopSize =
            mode === "fixed"
                ? { width: window.innerWidth, height: window.innerHeight }
                : { width: connectTarget.width, height: connectTarget.height };

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
            .withDesktopSize(desktopSize)
            .withExtension(exts.displayControl(true));

        // The scale factor has to be part of the connection: a later resize
        // only works once the Display Control channel is open.
        const sendScale =
            mode === "autoSharp" &&
            connectTarget.scaleFactor !== MIN_SCALE_FACTOR;
        if (sendScale) {
            builder.withExtension(
                exts.desktopScaleFactor(connectTarget.scaleFactor)
            );
        }

        if (values.pcb !== "") {
            builder.withExtension(exts.preConnectionBlob(values.pcb));
        }
        if (values.kdcProxyUrl !== "") {
            builder.withExtension(exts.kdcProxyUrl(values.kdcProxyUrl));
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

            sessionActiveRef.current = true;
            lastDesktopTargetRef.current = {
                ...desktopSize,
                scaleFactor: sendScale
                    ? connectTarget.scaleFactor
                    : MIN_SCALE_FACTOR
            };
            observeCanvas();
            // The window may have changed while connecting.
            applyDynamicResize();

            const termInfo = await sessionInfo.run();
            endSession();
            fileTransferRef.current?.dispose();
            fileTransferRef.current = null;
            setShowLogin(true);
        } catch (err) {
            endSession();
            void api.post(`/org/${target.orgId}/logs/access/attempt`, {
                resourceId: target.resourceId,
                action: false,
                type: "rdp"
            });
            setConnecting(false);
            setShowLogin(true);
            if (isIronError(err)) {
                setSubmitError(err.backtrace());
            } else {
                setSubmitError(`${err}`);
            }
        }
    };

    const onSubmit = (values: RdpCredentialsForm) => {
        setSubmitError(null);
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
                                    <Button
                                        type="submit"
                                        disabled={!moduleReady || connecting}
                                        loading={connecting}
                                        className="w-full"
                                    >
                                        {t("browserGatewayConnect")}
                                    </Button>
                                    {submitError && (
                                        <Alert variant="destructive">
                                            <AlertDescription>
                                                {submitError}
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
                            endSession();
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
                    <label className="ml-2 flex items-center gap-2 text-sm">
                        {t("rdpDisplayMode")}
                        <select
                            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                            value={displayMode}
                            onChange={(e) => {
                                if (isDisplayMode(e.target.value)) {
                                    changeDisplayMode(e.target.value);
                                }
                            }}
                        >
                            <option value="autoSharp">
                                {t("rdpDisplayModeAutoSharp")}
                            </option>
                            <option value="auto">
                                {t("rdpDisplayModeAuto")}
                            </option>
                            <option value="fixed">
                                {t("rdpDisplayModeFixed")}
                            </option>
                        </select>
                    </label>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => applyScreenScale(SCREEN_SCALE_FIT)}
                    >
                        {t("rdpFit")}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => applyScreenScale(SCREEN_SCALE_FULL)}
                    >
                        {t("rdpFull")}
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => applyScreenScale(SCREEN_SCALE_REAL)}
                    >
                        {t("rdpReal")}
                    </Button>
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
