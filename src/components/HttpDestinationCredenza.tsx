"use client";

import { useState, useEffect } from "react";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
import { Switch } from "@app/components/ui/switch";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import { RadioGroup, RadioGroupItem } from "@app/components/ui/radio-group";
import { Textarea } from "@app/components/ui/textarea";
import { Checkbox } from "@app/components/ui/checkbox";
import { Plus, X, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { build } from "@server/build";
import { useTranslations } from "next-intl";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AuthType = "none" | "bearer" | "basic" | "custom";

export type PayloadFormat = "json_array" | "ndjson" | "json_single";

export interface HttpConfig {
    name: string;
    url: string;
    authType: AuthType;
    bearerToken?: string;
    basicCredentials?: string;
    customHeaderName?: string;
    customHeaderValue?: string;
    headers: Array<{ key: string; value: string }>;
    format: PayloadFormat;
    useBodyTemplate: boolean;
    bodyTemplate?: string;
}

export interface Destination {
    destinationId: number;
    orgId: string;
    type: string;
    config: string;
    enabled: boolean;
    sendAccessLogs: boolean;
    sendActionLogs: boolean;
    sendConnectionLogs: boolean;
    sendRequestLogs: boolean;
    sendAISessionLogs: boolean;
    lastError: string | null;
    lastErrorAt: number | null;
    createdAt: number;
    updatedAt: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export const defaultHttpConfig = (): HttpConfig => ({
    name: "",
    url: "",
    authType: "none",
    bearerToken: "",
    basicCredentials: "",
    customHeaderName: "",
    customHeaderValue: "",
    headers: [],
    format: "json_array",
    useBodyTemplate: false,
    bodyTemplate: ""
});

export function parseHttpConfig(raw: string): HttpConfig {
    try {
        return { ...defaultHttpConfig(), ...JSON.parse(raw) };
    } catch {
        return defaultHttpConfig();
    }
}

// ── Headers editor ─────────────────────────────────────────────────────────────

interface HeadersEditorProps {
    headers: Array<{ key: string; value: string }>;
    onChange: (headers: Array<{ key: string; value: string }>) => void;
}

function HeadersEditor({ headers, onChange }: HeadersEditorProps) {
    const t = useTranslations();

    const addRow = () => onChange([...headers, { key: "", value: "" }]);

    const removeRow = (i: number) =>
        onChange(headers.filter((_, idx) => idx !== i));

    const updateRow = (i: number, field: "key" | "value", val: string) => {
        const next = [...headers];
        next[i] = { ...next[i], [field]: val };
        onChange(next);
    };

    return (
        <div className="space-y-3">
            {headers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                    {t("httpDestNoHeadersConfigured")}
                </p>
            )}
            {headers.map((h, i) => (
                <div key={i} className="flex gap-2 items-center">
                    <Input
                        value={h.key}
                        onChange={(e) => updateRow(i, "key", e.target.value)}
                        placeholder={t("httpDestHeaderNamePlaceholder")}
                        className="flex-1"
                    />
                    <Input
                        value={h.value}
                        onChange={(e) => updateRow(i, "value", e.target.value)}
                        placeholder={t("httpDestHeaderValuePlaceholder")}
                        className="flex-1"
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(i)}
                        className="shrink-0 h-9 w-9"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            ))}
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                className="gap-1.5"
            >
                <Plus className="h-3.5 w-3.5" />
                {t("httpDestAddHeader")}
            </Button>
        </div>
    );
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface HttpDestinationCredenzaProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editing: Destination | null;
    orgId: string;
    onSaved: () => void;
}

export function HttpDestinationCredenza({
    open,
    onOpenChange,
    editing,
    orgId,
    onSaved
}: HttpDestinationCredenzaProps) {
    const api = createApiClient(useEnvContext());
    const t = useTranslations();

    const [saving, setSaving] = useState(false);
    const [cfg, setCfg] = useState<HttpConfig>(defaultHttpConfig());
    const [sendAccessLogs, setSendAccessLogs] = useState(false);
    const [sendActionLogs, setSendActionLogs] = useState(false);
    const [sendConnectionLogs, setSendConnectionLogs] = useState(false);
    const [sendRequestLogs, setSendRequestLogs] = useState(false);
    const [sendAISessionLogs, setSendAISessionLogs] = useState(false);

    useEffect(() => {
        if (open) {
            setCfg(
                editing ? parseHttpConfig(editing.config) : defaultHttpConfig()
            );
            setSendAccessLogs(editing?.sendAccessLogs ?? false);
            setSendActionLogs(editing?.sendActionLogs ?? false);
            setSendConnectionLogs(editing?.sendConnectionLogs ?? false);
            setSendRequestLogs(editing?.sendRequestLogs ?? false);
            setSendAISessionLogs(editing?.sendAISessionLogs ?? false);
        }
    }, [open, editing]);

    const update = (patch: Partial<HttpConfig>) =>
        setCfg((prev) => ({ ...prev, ...patch }));

    const urlError: string | null = (() => {
        const raw = cfg.url.trim();
        if (!raw) return null;
        try {
            const parsed = new URL(raw);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                return t("httpDestUrlErrorHttpRequired");
            }
            if (build === "saas" && parsed.protocol !== "https:") {
                return t("httpDestUrlErrorHttpsRequired");
            }
            return null;
        } catch {
            return t("httpDestUrlErrorInvalid");
        }
    })();

    const isValid =
        cfg.name.trim() !== "" && cfg.url.trim() !== "" && urlError === null;

    async function handleSave() {
        if (!isValid) return;
        setSaving(true);
        try {
            const payload = {
                type: "http",
                config: JSON.stringify(cfg),
                sendAccessLogs,
                sendActionLogs,
                sendConnectionLogs,
                sendRequestLogs,
                sendAISessionLogs
            };
            if (editing) {
                await api.post(
                    `/org/${orgId}/event-streaming-destination/${editing.destinationId}`,
                    payload
                );
                toast({ title: t("httpDestUpdatedSuccess") });
            } else {
                await api.put(
                    `/org/${orgId}/event-streaming-destination`,
                    payload
                );
                toast({ title: t("httpDestCreatedSuccess") });
            }
            onSaved();
            onOpenChange(false);
        } catch (e) {
            toast({
                variant: "destructive",
                title: editing
                    ? t("httpDestUpdateFailed")
                    : t("httpDestCreateFailed"),
                description: formatAxiosError(e, t("streamingUnexpectedError"))
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <Credenza open={open} onOpenChange={onOpenChange}>
            <CredenzaContent className="sm:max-w-2xl">
                <CredenzaHeader>
                    <CredenzaTitle>
                        {editing
                            ? t("httpDestEditTitle")
                            : t("httpDestAddTitle")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {editing
                            ? t("httpDestEditDescription")
                            : t("httpDestAddDescription")}
                    </CredenzaDescription>
                </CredenzaHeader>

                <CredenzaBody>
                    {editing?.lastError && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription className="break-words">
                                {editing.lastError}
                            </AlertDescription>
                        </Alert>
                    )}
                    <HorizontalTabs
                        clientSide
                        items={[
                            { title: t("httpDestTabSettings"), href: "" },
                            { title: t("httpDestTabHeaders"), href: "" },
                            { title: t("httpDestTabBody"), href: "" },
                            { title: t("httpDestTabLogs"), href: "" }
                        ]}
                    >
                        {/* ── Settings tab ────────────────────────────── */}
                        <div className="space-y-6 mt-4 p-1">
                            {/* Name */}
                            <div className="space-y-2">
                                <Label htmlFor="dest-name">{t("name")}</Label>
                                <Input
                                    id="dest-name"
                                    placeholder={t("httpDestNamePlaceholder")}
                                    value={cfg.name}
                                    onChange={(e) =>
                                        update({ name: e.target.value })
                                    }
                                />
                            </div>

                            {/* URL */}
                            <div className="space-y-2">
                                <Label htmlFor="dest-url">
                                    {t("httpDestUrlLabel")}
                                </Label>
                                <Input
                                    id="dest-url"
                                    placeholder="https://example.com/webhook"
                                    value={cfg.url}
                                    onChange={(e) =>
                                        update({ url: e.target.value })
                                    }
                                />
                                {urlError && (
                                    <p className="text-xs text-destructive">
                                        {urlError}
                                    </p>
                                )}
                            </div>

                            {/* Authentication */}
                            <div className="space-y-3">
                                <div>
                                    <label className="font-medium block">
                                        {t("httpDestAuthTitle")}
                                    </label>
                                    <p className="text-sm text-muted-foreground mt-0.5">
                                        {t("httpDestAuthDescription")}
                                    </p>
                                </div>

                                <RadioGroup
                                    value={cfg.authType}
                                    onValueChange={(v) =>
                                        update({ authType: v as AuthType })
                                    }
                                    className="gap-2"
                                >
                                    {/* None */}
                                    <div className="flex items-start gap-3 rounded-md border p-3 transition-colors">
                                        <RadioGroupItem
                                            value="none"
                                            id="auth-none"
                                            className="mt-0.5"
                                        />
                                        <div>
                                            <Label
                                                htmlFor="auth-none"
                                                className="cursor-pointer font-medium"
                                            >
                                                {t("httpDestAuthNoneTitle")}
                                            </Label>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {t(
                                                    "httpDestAuthNoneDescription"
                                                )}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Bearer */}
                                    <div className="flex items-start gap-3 rounded-md border p-3">
                                        <RadioGroupItem
                                            value="bearer"
                                            id="auth-bearer"
                                            className="mt-0.5"
                                        />
                                        <div className="flex-1 space-y-3">
                                            <div>
                                                <Label
                                                    htmlFor="auth-bearer"
                                                    className="cursor-pointer font-medium"
                                                >
                                                    {t(
                                                        "httpDestAuthBearerTitle"
                                                    )}
                                                </Label>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {t(
                                                        "httpDestAuthBearerDescription"
                                                    )}
                                                </p>
                                            </div>
                                            {cfg.authType === "bearer" && (
                                                <Input
                                                    placeholder={t(
                                                        "httpDestAuthBearerPlaceholder"
                                                    )}
                                                    value={
                                                        cfg.bearerToken ?? ""
                                                    }
                                                    onChange={(e) =>
                                                        update({
                                                            bearerToken:
                                                                e.target.value
                                                        })
                                                    }
                                                />
                                            )}
                                        </div>
                                    </div>

                                    {/* Basic */}
                                    <div className="flex items-start gap-3 rounded-md border p-3">
                                        <RadioGroupItem
                                            value="basic"
                                            id="auth-basic"
                                            className="mt-0.5"
                                        />
                                        <div className="flex-1 space-y-3">
                                            <div>
                                                <Label
                                                    htmlFor="auth-basic"
                                                    className="cursor-pointer font-medium"
                                                >
                                                    {t(
                                                        "httpDestAuthBasicTitle"
                                                    )}
                                                </Label>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {t(
                                                        "httpDestAuthBasicDescription"
                                                    )}
                                                </p>
                                            </div>
                                            {cfg.authType === "basic" && (
                                                <Input
                                                    placeholder={t(
                                                        "httpDestAuthBasicPlaceholder"
                                                    )}
                                                    value={
                                                        cfg.basicCredentials ??
                                                        ""
                                                    }
                                                    onChange={(e) =>
                                                        update({
                                                            basicCredentials:
                                                                e.target.value
                                                        })
                                                    }
                                                />
                                            )}
                                        </div>
                                    </div>

                                    {/* Custom */}
                                    <div className="flex items-start gap-3 rounded-md border p-3">
                                        <RadioGroupItem
                                            value="custom"
                                            id="auth-custom"
                                            className="mt-0.5"
                                        />
                                        <div className="flex-1 space-y-3">
                                            <div>
                                                <Label
                                                    htmlFor="auth-custom"
                                                    className="cursor-pointer font-medium"
                                                >
                                                    {t(
                                                        "httpDestAuthCustomTitle"
                                                    )}
                                                </Label>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {t(
                                                        "httpDestAuthCustomDescription"
                                                    )}
                                                </p>
                                            </div>
                                            {cfg.authType === "custom" && (
                                                <div className="flex gap-2">
                                                    <Input
                                                        placeholder={t(
                                                            "httpDestAuthCustomHeaderNamePlaceholder"
                                                        )}
                                                        value={
                                                            cfg.customHeaderName ??
                                                            ""
                                                        }
                                                        onChange={(e) =>
                                                            update({
                                                                customHeaderName:
                                                                    e.target
                                                                        .value
                                                            })
                                                        }
                                                        className="flex-1"
                                                    />
                                                    <Input
                                                        placeholder={t(
                                                            "httpDestAuthCustomHeaderValuePlaceholder"
                                                        )}
                                                        value={
                                                            cfg.customHeaderValue ??
                                                            ""
                                                        }
                                                        onChange={(e) =>
                                                            update({
                                                                customHeaderValue:
                                                                    e.target
                                                                        .value
                                                            })
                                                        }
                                                        className="flex-1"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </RadioGroup>
                            </div>
                        </div>

                        {/* ── Headers tab ──────────────────────────────── */}
                        <div className="space-y-6 mt-4 p-1">
                            <div>
                                <label className="font-medium block">
                                    {t("httpDestCustomHeadersTitle")}
                                </label>
                                <p className="text-sm text-muted-foreground mt-0.5">
                                    {t("httpDestCustomHeadersDescription")}
                                </p>
                            </div>
                            <HeadersEditor
                                headers={cfg.headers}
                                onChange={(headers) => update({ headers })}
                            />
                        </div>

                        {/* ── Body tab ─────────────────────────── */}
                        <div className="space-y-6 mt-4 p-1">
                            <div>
                                <label className="font-medium block">
                                    {t("httpDestBodyTemplateTitle")}
                                </label>
                                <p className="text-sm text-muted-foreground mt-0.5">
                                    {t("httpDestBodyTemplateDescription")}
                                </p>
                            </div>

                            <div className="flex items-center gap-3">
                                <Switch
                                    id="use-body-template"
                                    checked={cfg.useBodyTemplate}
                                    onCheckedChange={(v) =>
                                        update({ useBodyTemplate: v })
                                    }
                                />
                                <Label
                                    htmlFor="use-body-template"
                                    className="cursor-pointer"
                                >
                                    {t("httpDestEnableBodyTemplate")}
                                </Label>
                            </div>

                            {cfg.useBodyTemplate && (
                                <div className="space-y-2">
                                    <Label htmlFor="body-template">
                                        {t("httpDestBodyTemplateLabel")}
                                    </Label>
                                    <Textarea
                                        id="body-template"
                                        placeholder={
                                            '{\n  "event": "{{event}}",\n  "timestamp": "{{timestamp}}",\n  "data": {{data}}\n}'
                                        }
                                        value={cfg.bodyTemplate ?? ""}
                                        onChange={(e) =>
                                            update({
                                                bodyTemplate: e.target.value
                                            })
                                        }
                                        className="font-mono text-xs min-h-45 resize-y"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t("httpDestBodyTemplateHint")}
                                    </p>
                                </div>
                            )}

                            {/* Payload Format */}
                            <div className="space-y-3">
                                <div>
                                    <label className="font-medium block">
                                        {t("httpDestPayloadFormatTitle")}
                                    </label>
                                    <p className="text-sm text-muted-foreground mt-0.5">
                                        {t("httpDestPayloadFormatDescription")}
                                    </p>
                                </div>

                                <RadioGroup
                                    value={cfg.format ?? "json_array"}
                                    onValueChange={(v) =>
                                        update({
                                            format: v as PayloadFormat
                                        })
                                    }
                                    className="gap-2"
                                >
                                    {/* JSON Array */}
                                    <div className="flex items-start gap-3 rounded-md border p-3 transition-colors">
                                        <RadioGroupItem
                                            value="json_array"
                                            id="fmt-json-array"
                                            className="mt-0.5"
                                        />
                                        <div>
                                            <Label
                                                htmlFor="fmt-json-array"
                                                className="cursor-pointer font-medium"
                                            >
                                                {t(
                                                    "httpDestFormatJsonArrayTitle"
                                                )}
                                            </Label>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {t(
                                                    "httpDestFormatJsonArrayDescription"
                                                )}
                                            </p>
                                        </div>
                                    </div>

                                    {/* NDJSON */}
                                    <div className="flex items-start gap-3 rounded-md border p-3 transition-colors">
                                        <RadioGroupItem
                                            value="ndjson"
                                            id="fmt-ndjson"
                                            className="mt-0.5"
                                        />
                                        <div>
                                            <Label
                                                htmlFor="fmt-ndjson"
                                                className="cursor-pointer font-medium"
                                            >
                                                {t("httpDestFormatNdjsonTitle")}
                                            </Label>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {t(
                                                    "httpDestFormatNdjsonDescription"
                                                )}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Single event per request */}
                                    <div className="flex items-start gap-3 rounded-md border p-3 transition-colors">
                                        <RadioGroupItem
                                            value="json_single"
                                            id="fmt-json-single"
                                            className="mt-0.5"
                                        />
                                        <div>
                                            <Label
                                                htmlFor="fmt-json-single"
                                                className="cursor-pointer font-medium"
                                            >
                                                {t("httpDestFormatSingleTitle")}
                                            </Label>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {t(
                                                    "httpDestFormatSingleDescription"
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                </RadioGroup>
                            </div>
                        </div>

                        {/* ── Logs tab ──────────────────────────────────── */}
                        <div className="space-y-6 mt-4 p-1">
                            <div>
                                <label className="font-medium block">
                                    {t("httpDestLogTypesTitle")}
                                </label>
                                <p className="text-sm text-muted-foreground mt-0.5">
                                    {t("httpDestLogTypesDescription")}
                                </p>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-start gap-3 rounded-md border p-3">
                                    <Checkbox
                                        id="log-access"
                                        checked={sendAccessLogs}
                                        onCheckedChange={(v) =>
                                            setSendAccessLogs(v === true)
                                        }
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <label
                                            htmlFor="log-access"
                                            className="text-sm font-medium cursor-pointer"
                                        >
                                            {t("httpDestAccessLogsTitle")}
                                        </label>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t("httpDestAccessLogsDescription")}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 rounded-md border p-3">
                                    <Checkbox
                                        id="log-action"
                                        checked={sendActionLogs}
                                        onCheckedChange={(v) =>
                                            setSendActionLogs(v === true)
                                        }
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <label
                                            htmlFor="log-action"
                                            className="text-sm font-medium cursor-pointer"
                                        >
                                            {t("httpDestActionLogsTitle")}
                                        </label>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t("httpDestActionLogsDescription")}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 rounded-md border p-3">
                                    <Checkbox
                                        id="log-connection"
                                        checked={sendConnectionLogs}
                                        onCheckedChange={(v) =>
                                            setSendConnectionLogs(v === true)
                                        }
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <label
                                            htmlFor="log-connection"
                                            className="text-sm font-medium cursor-pointer"
                                        >
                                            {t("httpDestConnectionLogsTitle")}
                                        </label>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t(
                                                "httpDestConnectionLogsDescription"
                                            )}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 rounded-md border p-3">
                                    <Checkbox
                                        id="log-request"
                                        checked={sendRequestLogs}
                                        onCheckedChange={(v) =>
                                            setSendRequestLogs(v === true)
                                        }
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <label
                                            htmlFor="log-request"
                                            className="text-sm font-medium cursor-pointer"
                                        >
                                            {t("httpDestRequestLogsTitle")}
                                        </label>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t(
                                                "httpDestRequestLogsDescription"
                                            )}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 rounded-md border p-3">
                                    <Checkbox
                                        id="log-ai-session"
                                        checked={sendAISessionLogs}
                                        onCheckedChange={(v) =>
                                            setSendAISessionLogs(v === true)
                                        }
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <label
                                            htmlFor="log-ai-session"
                                            className="text-sm font-medium cursor-pointer"
                                        >
                                            {t("httpDestAISessionLogsTitle")}
                                        </label>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t(
                                                "httpDestAISessionLogsDescription"
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </HorizontalTabs>
                </CredenzaBody>

                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={saving}
                        >
                            {t("cancel")}
                        </Button>
                    </CredenzaClose>
                    <Button
                        type="button"
                        onClick={handleSave}
                        loading={saving}
                        disabled={!isValid || saving}
                    >
                        {editing
                            ? t("httpDestSaveChanges")
                            : t("httpDestCreateDestination")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
