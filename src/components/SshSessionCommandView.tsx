"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2 } from "lucide-react";
import { logQueries } from "@app/lib/queries";

type SshSessionCommandViewProps = {
    orgId: string;
    sshSessionLogId: number;
};

export function SshSessionCommandView({
    orgId,
    sshSessionLogId
}: SshSessionCommandViewProps) {
    const t = useTranslations();
    const { data, isLoading, isError } = useQuery(
        logQueries.sshSessionCommands({ orgId, sshSessionLogId })
    );

    const commands = data?.commands ?? [];
    const total = data?.pagination.total ?? 0;
    const hasInexact = commands.some((c) => c.inexact);

    return (
        <div className="space-y-2">
            {hasInexact && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500">
                    <AlertTriangle className="h-3.5 w-3.5 flex-none" />
                    {t("sshSessionInexactNotice")}
                </div>
            )}
            <div className="flex min-w-0 max-h-[32rem] flex-col gap-1 overflow-y-auto rounded-md border bg-background p-4 font-mono text-xs">
                {isLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t("sshSessionLoadingCommands")}
                    </div>
                ) : isError ? (
                    <span className="text-destructive">
                        {t("sshSessionCommandsError")}
                    </span>
                ) : commands.length === 0 ? (
                    <span className="text-muted-foreground">
                        {t("sshSessionNoCommands")}
                    </span>
                ) : (
                    commands.map((c) => (
                        <div key={c.id} className="flex min-w-0 gap-3">
                            <span className="flex-none text-muted-foreground">
                                {new Date(
                                    c.timestamp * 1000
                                ).toLocaleTimeString()}
                            </span>
                            <span className="flex-none text-muted-foreground">
                                {c.channel === "exec" ? "exec" : "$"}
                            </span>
                            <span className="min-w-0 whitespace-pre-wrap break-all">
                                {c.command || (
                                    <span className="italic text-muted-foreground">
                                        {t("sshSessionRecalledCommand")}
                                    </span>
                                )}
                            </span>
                            {c.inexact && (
                                <span
                                    className="flex-none"
                                    title={t("sshSessionInexactTooltip")}
                                >
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500" />
                                </span>
                            )}
                        </div>
                    ))
                )}
            </div>
            {total > commands.length && (
                <div className="text-xs text-muted-foreground">
                    {t("sshSessionCommandsTruncated", {
                        shown: commands.length,
                        total
                    })}
                </div>
            )}
        </div>
    );
}
