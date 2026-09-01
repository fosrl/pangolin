"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
    AlertTriangle,
    Bot,
    Code,
    MessagesSquare,
    Terminal,
    User as UserIcon,
    Wrench
} from "lucide-react";
import { Button } from "@app/components/ui/button";
import type { NormalizedAiMessage } from "@server/lib/aiMessageNormalization";

type AiSessionChatViewProps = {
    normalizedRequest: string | null;
    normalizedResponse: string | null;
    requestBody: string | null;
    responseBody: string | null;
    truncated: boolean;
};

function parseMessages(json: string | null): NormalizedAiMessage[] | null {
    if (!json) return null;
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? (parsed as NormalizedAiMessage[]) : null;
    } catch {
        return null;
    }
}

function prettyRaw(raw: string | null): string | null {
    if (!raw) return null;
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
}

function MessageBubble({ message }: { message: NormalizedAiMessage }) {
    const isUser = message.role === "user";
    const isSystem = message.role === "system";
    const isTool = message.role === "tool";

    if (isSystem) {
        return (
            <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Terminal className="h-3.5 w-3.5 mt-0.5 flex-none" />
                <pre className="whitespace-pre-wrap break-words font-sans">
                    {message.content}
                </pre>
            </div>
        );
    }

    return (
        <div
            className={`flex items-start gap-2 ${isUser ? "flex-row-reverse" : ""}`}
        >
            <div
                className={`flex h-7 w-7 flex-none items-center justify-center rounded-full ${
                    isUser
                        ? "bg-primary text-primary-foreground"
                        : isTool
                          ? "bg-amber-100 dark:bg-amber-900/40"
                          : "bg-muted"
                }`}
            >
                {isUser ? (
                    <UserIcon className="h-4 w-4" />
                ) : isTool ? (
                    <Wrench className="h-3.5 w-3.5" />
                ) : (
                    <Bot className="h-4 w-4" />
                )}
            </div>
            <div
                className={`min-w-0 max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                    isUser
                        ? "bg-primary text-primary-foreground"
                        : isTool
                          ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 font-mono text-xs"
                          : "bg-muted"
                }`}
            >
                {message.content || (
                    <span className="italic opacity-60">&nbsp;</span>
                )}
            </div>
        </div>
    );
}

function RawFallbackBlock({
    label,
    raw,
    noDataLabel,
    unparsedLabel
}: {
    label: string;
    raw: string | null;
    noDataLabel: string;
    unparsedLabel?: string;
}) {
    const pretty = prettyRaw(raw);
    return (
        <div className="min-w-0 rounded-md border bg-muted/30 p-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
                {label}
                {pretty && unparsedLabel && (
                    <span className="ml-2 font-normal italic opacity-70">
                        {unparsedLabel}
                    </span>
                )}
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
                {pretty ?? noDataLabel}
            </pre>
        </div>
    );
}

export function AiSessionChatView({
    normalizedRequest,
    normalizedResponse,
    requestBody,
    responseBody,
    truncated
}: AiSessionChatViewProps) {
    const t = useTranslations();
    const [rawMode, setRawMode] = useState(false);

    const requestMessages = useMemo(
        () => parseMessages(normalizedRequest),
        [normalizedRequest]
    );
    const responseMessages = useMemo(
        () => parseMessages(normalizedResponse),
        [normalizedResponse]
    );

    const hasRequestMessages = !!requestMessages && requestMessages.length > 0;
    const hasResponseMessages =
        !!responseMessages && responseMessages.length > 0;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                {truncated ? (
                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500">
                        <AlertTriangle className="h-3.5 w-3.5 flex-none" />
                        {t("aiSessionLogTruncated")}
                    </div>
                ) : (
                    <div />
                )}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRawMode((prev) => !prev)}
                >
                    {rawMode ? (
                        <MessagesSquare className="mr-2 h-3.5 w-3.5" />
                    ) : (
                        <Code className="mr-2 h-3.5 w-3.5" />
                    )}
                    {rawMode ? t("aiSessionViewChat") : t("aiSessionViewRaw")}
                </Button>
            </div>
            {rawMode ? (
                <div className="flex min-w-0 max-h-[32rem] flex-col gap-3 overflow-y-auto rounded-md border bg-background p-4">
                    <RawFallbackBlock
                        label={t("aiSessionRequest")}
                        raw={normalizedRequest}
                        noDataLabel={t("aiSessionNoData")}
                    />
                    <RawFallbackBlock
                        label={t("aiSessionResponse")}
                        raw={normalizedResponse}
                        noDataLabel={t("aiSessionNoData")}
                    />
                </div>
            ) : (
                <div className="flex min-w-0 max-h-[32rem] flex-col gap-3 overflow-y-auto rounded-md border bg-background p-4">
                    {hasRequestMessages ? (
                        requestMessages!.map((message, i) => (
                            <MessageBubble key={`req-${i}`} message={message} />
                        ))
                    ) : (
                        <RawFallbackBlock
                            label={t("aiSessionRequest")}
                            raw={requestBody}
                            noDataLabel={t("aiSessionNoData")}
                            unparsedLabel={t("aiSessionCouldNotParse")}
                        />
                    )}
                    {hasResponseMessages ? (
                        responseMessages!.map((message, i) => (
                            <MessageBubble key={`res-${i}`} message={message} />
                        ))
                    ) : (
                        <RawFallbackBlock
                            label={t("aiSessionResponse")}
                            raw={responseBody}
                            noDataLabel={t("aiSessionNoData")}
                            unparsedLabel={t("aiSessionCouldNotParse")}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
