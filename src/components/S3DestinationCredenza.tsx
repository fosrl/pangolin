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
import { Checkbox } from "@app/components/ui/checkbox";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { useTranslations } from "next-intl";
import { Destination } from "@app/components/HttpDestinationCredenza";

// ── Types ──────────────────────────────────────────────────────────────────────

export type S3PayloadFormat = "json_array" | "ndjson" | "csv";

export interface S3Config {
    name: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
    prefix: string;
    endpoint: string;
    format: S3PayloadFormat;
    gzip: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export const defaultS3Config = (): S3Config => ({
    name: "",
    accessKeyId: "",
    secretAccessKey: "",
    region: "us-east-1",
    bucket: "",
    prefix: "",
    endpoint: "",
    format: "json_array",
    gzip: false
});

export function parseS3Config(raw: string): S3Config {
    try {
        return { ...defaultS3Config(), ...JSON.parse(raw) };
    } catch {
        return defaultS3Config();
    }
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface S3DestinationCredenzaProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editing: Destination | null;
    orgId: string;
    onSaved: () => void;
}

export function S3DestinationCredenza({
    open,
    onOpenChange,
    editing,
    orgId,
    onSaved
}: S3DestinationCredenzaProps) {
    const api = createApiClient(useEnvContext());
    const t = useTranslations();

    const [saving, setSaving] = useState(false);
    const [cfg, setCfg] = useState<S3Config>(defaultS3Config());
    const [sendAccessLogs, setSendAccessLogs] = useState(false);
    const [sendActionLogs, setSendActionLogs] = useState(false);
    const [sendConnectionLogs, setSendConnectionLogs] = useState(false);
    const [sendRequestLogs, setSendRequestLogs] = useState(false);
    const [sendAISessionLogs, setSendAISessionLogs] = useState(false);

    useEffect(() => {
        if (open) {
            setCfg(editing ? parseS3Config(editing.config) : defaultS3Config());
            setSendAccessLogs(editing?.sendAccessLogs ?? false);
            setSendActionLogs(editing?.sendActionLogs ?? false);
            setSendConnectionLogs(editing?.sendConnectionLogs ?? false);
            setSendRequestLogs(editing?.sendRequestLogs ?? false);
            setSendAISessionLogs(editing?.sendAISessionLogs ?? false);
        }
    }, [open, editing]);

    const update = (patch: Partial<S3Config>) =>
        setCfg((prev) => ({ ...prev, ...patch }));

    const isValid =
        cfg.name.trim() !== "" &&
        cfg.accessKeyId.trim() !== "" &&
        cfg.secretAccessKey.trim() !== "" &&
        cfg.region.trim() !== "" &&
        cfg.bucket.trim() !== "";

    async function handleSave() {
        if (!isValid) return;
        setSaving(true);
        try {
            const payload = {
                type: "s3",
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
                toast({ title: t("s3DestUpdatedSuccess") });
            } else {
                await api.put(
                    `/org/${orgId}/event-streaming-destination`,
                    payload
                );
                toast({ title: t("s3DestCreatedSuccess") });
            }
            onSaved();
            onOpenChange(false);
        } catch (e) {
            toast({
                variant: "destructive",
                title: editing
                    ? t("s3DestUpdateFailed")
                    : t("s3DestCreateFailed"),
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
                        {editing ? t("S3DestEditTitle") : t("S3DestAddTitle")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {editing
                            ? t("S3DestEditDescription")
                            : t("S3DestAddDescription")}
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
                            { title: t("s3DestTabSettings"), href: "" },
                            { title: t("s3DestTabFormat"), href: "" },
                            { title: t("httpDestTabLogs"), href: "" }
                        ]}
                    >
                        {/* ── Settings tab ────────────────────────────── */}
                        <div className="space-y-6 mt-4 p-1">
                            {/* Name */}
                            <div className="space-y-2">
                                <Label htmlFor="s3-name">
                                    {t("s3DestNameLabel")}
                                </Label>
                                <Input
                                    id="s3-name"
                                    placeholder={t("s3DestNamePlaceholder")}
                                    value={cfg.name}
                                    onChange={(e) =>
                                        update({ name: e.target.value })
                                    }
                                />
                            </div>

                            {/* AWS Access Key ID */}
                            <div className="space-y-2">
                                <Label htmlFor="s3-access-key-id">
                                    {t("s3DestAccessKeyIdLabel")}
                                </Label>
                                <Input
                                    id="s3-access-key-id"
                                    placeholder="AKIAIOSFODNN7EXAMPLE"
                                    value={cfg.accessKeyId}
                                    onChange={(e) =>
                                        update({
                                            accessKeyId: e.target.value
                                        })
                                    }
                                    autoComplete="off"
                                />
                            </div>

                            {/* AWS Secret Access Key */}
                            <div className="space-y-2">
                                <Label htmlFor="s3-secret-key">
                                    {t("s3DestSecretAccessKeyLabel")}
                                </Label>
                                <Input
                                    id="s3-secret-key"
                                    type="password"
                                    placeholder={t(
                                        "s3DestSecretAccessKeyPlaceholder"
                                    )}
                                    value={cfg.secretAccessKey}
                                    onChange={(e) =>
                                        update({
                                            secretAccessKey: e.target.value
                                        })
                                    }
                                    autoComplete="new-password"
                                />
                            </div>

                            {/* Region */}
                            <div className="space-y-2">
                                <Label htmlFor="s3-region">
                                    {t("s3DestRegionLabel")}
                                </Label>
                                <Input
                                    id="s3-region"
                                    placeholder="us-east-1"
                                    value={cfg.region}
                                    onChange={(e) =>
                                        update({ region: e.target.value })
                                    }
                                />
                            </div>

                            {/* Bucket */}
                            <div className="space-y-2">
                                <Label htmlFor="s3-bucket">
                                    {t("s3DestBucketLabel")}
                                </Label>
                                <Input
                                    id="s3-bucket"
                                    placeholder="my-logs-bucket"
                                    value={cfg.bucket}
                                    onChange={(e) =>
                                        update({ bucket: e.target.value })
                                    }
                                />
                            </div>

                            {/* Prefix */}
                            <div className="space-y-2">
                                <Label htmlFor="s3-prefix">
                                    {t("s3DestPrefixLabel")}
                                </Label>
                                <Input
                                    id="s3-prefix"
                                    placeholder="pangolin/logs"
                                    value={cfg.prefix}
                                    onChange={(e) =>
                                        update({ prefix: e.target.value })
                                    }
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t("s3DestPrefixDescription")}
                                </p>
                            </div>

                            {/* Custom endpoint (optional – for S3-compatible storage) */}
                            <div className="space-y-2">
                                <Label htmlFor="s3-endpoint">
                                    {t("s3DestEndpointLabel")}
                                </Label>
                                <Input
                                    id="s3-endpoint"
                                    placeholder="https://s3.example.com"
                                    value={cfg.endpoint}
                                    onChange={(e) =>
                                        update({ endpoint: e.target.value })
                                    }
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t("s3DestEndpointDescription")}
                                </p>
                            </div>
                        </div>

                        {/* ── Format tab ───────────────────────────────── */}
                        <div className="space-y-6 mt-4 p-1">
                            {/* Gzip compression toggle */}
                            <div className="flex items-start gap-3 rounded-md border p-3">
                                <Switch
                                    id="s3-gzip"
                                    checked={cfg.gzip}
                                    onCheckedChange={(v) => update({ gzip: v })}
                                    className="mt-0.5"
                                />
                                <div>
                                    <Label
                                        htmlFor="s3-gzip"
                                        className="cursor-pointer font-medium"
                                    >
                                        {t("s3DestGzipLabel")}
                                    </Label>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {t("s3DestGzipDescription")}
                                    </p>
                                </div>
                            </div>

                            {/* Payload format selector */}
                            <div className="space-y-3">
                                <div>
                                    <label className="font-medium block">
                                        {t("s3DestFormatTitle")}
                                    </label>
                                    <p className="text-sm text-muted-foreground mt-0.5">
                                        {t("s3DestFormatDescription")}
                                    </p>
                                </div>

                                <RadioGroup
                                    value={cfg.format}
                                    onValueChange={(v) =>
                                        update({
                                            format: v as S3PayloadFormat
                                        })
                                    }
                                    className="gap-2"
                                >
                                    {/* JSON Array */}
                                    <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                                        <RadioGroupItem
                                            value="json_array"
                                            className="mt-0.5"
                                        />
                                        <div>
                                            <p className="text-sm font-medium leading-none">
                                                {t(
                                                    "httpDestFormatJsonArrayTitle"
                                                )}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {t(
                                                    "s3DestFormatJsonArrayDescription"
                                                )}
                                            </p>
                                        </div>
                                    </label>

                                    {/* NDJSON */}
                                    <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                                        <RadioGroupItem
                                            value="ndjson"
                                            className="mt-0.5"
                                        />
                                        <div>
                                            <p className="text-sm font-medium leading-none">
                                                {t("httpDestFormatNdjsonTitle")}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {t(
                                                    "s3DestFormatNdjsonDescription"
                                                )}
                                            </p>
                                        </div>
                                    </label>

                                    {/* CSV */}
                                    <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                                        <RadioGroupItem
                                            value="csv"
                                            className="mt-0.5"
                                        />
                                        <div>
                                            <p className="text-sm font-medium leading-none">
                                                {t("s3DestFormatCsvTitle")}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {t(
                                                    "s3DestFormatCsvDescription"
                                                )}
                                            </p>
                                        </div>
                                    </label>
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
                                        id="s3-log-access"
                                        checked={sendAccessLogs}
                                        onCheckedChange={(v) =>
                                            setSendAccessLogs(v === true)
                                        }
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <Label
                                            htmlFor="s3-log-access"
                                            className="cursor-pointer font-medium"
                                        >
                                            {t("httpDestAccessLogsTitle")}
                                        </Label>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t("httpDestAccessLogsDescription")}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 rounded-md border p-3">
                                    <Checkbox
                                        id="s3-log-action"
                                        checked={sendActionLogs}
                                        onCheckedChange={(v) =>
                                            setSendActionLogs(v === true)
                                        }
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <Label
                                            htmlFor="s3-log-action"
                                            className="cursor-pointer font-medium"
                                        >
                                            {t("httpDestActionLogsTitle")}
                                        </Label>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t("httpDestActionLogsDescription")}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 rounded-md border p-3">
                                    <Checkbox
                                        id="s3-log-connection"
                                        checked={sendConnectionLogs}
                                        onCheckedChange={(v) =>
                                            setSendConnectionLogs(v === true)
                                        }
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <Label
                                            htmlFor="s3-log-connection"
                                            className="cursor-pointer font-medium"
                                        >
                                            {t("httpDestConnectionLogsTitle")}
                                        </Label>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t(
                                                "httpDestConnectionLogsDescription"
                                            )}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 rounded-md border p-3">
                                    <Checkbox
                                        id="s3-log-request"
                                        checked={sendRequestLogs}
                                        onCheckedChange={(v) =>
                                            setSendRequestLogs(v === true)
                                        }
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <Label
                                            htmlFor="s3-log-request"
                                            className="cursor-pointer font-medium"
                                        >
                                            {t("httpDestRequestLogsTitle")}
                                        </Label>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t(
                                                "httpDestRequestLogsDescription"
                                            )}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 rounded-md border p-3">
                                    <Checkbox
                                        id="s3-log-ai-session"
                                        checked={sendAISessionLogs}
                                        onCheckedChange={(v) =>
                                            setSendAISessionLogs(v === true)
                                        }
                                        className="mt-0.5"
                                    />
                                    <div>
                                        <Label
                                            htmlFor="s3-log-ai-session"
                                            className="cursor-pointer font-medium"
                                        >
                                            {t("httpDestAISessionLogsTitle")}
                                        </Label>
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
                            ? t("s3DestSaveChanges")
                            : t("s3DestCreateDestination")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
