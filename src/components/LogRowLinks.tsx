"use client";

import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

type LogRowLinksProps = {
    orgId: string;
    actorType?: string | null;
    actorId?: string | null;
    metadata?: string | null;
};

function getResourceSessionId(metadata?: string | null): string | null {
    if (!metadata) {
        return null;
    }
    try {
        const parsed = JSON.parse(metadata);
        return typeof parsed?.resourceSessionId === "string"
            ? parsed.resourceSessionId
            : null;
    } catch {
        return null;
    }
}

// Links shown in an expanded request/access log row to the user and resource
// session behind it, when the row has them.
export function LogRowLinks({
    orgId,
    actorType,
    actorId,
    metadata
}: LogRowLinksProps) {
    const t = useTranslations();
    const resourceSessionId = getResourceSessionId(metadata);
    const userId = actorType === "user" ? actorId : null;

    if (!resourceSessionId && !userId) {
        return null;
    }

    const linkClassName =
        "inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline";

    return (
        <div>
            <strong>{t("logLinks")}:</strong>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {userId && (
                    <Link
                        href={`/${orgId}/settings/access/users/${encodeURIComponent(userId)}`}
                        className={linkClassName}
                    >
                        {t("logLinkUser")}
                        <ArrowUpRight className="size-3" />
                    </Link>
                )}
                {resourceSessionId && (
                    <Link
                        href={`/${orgId}/settings/access/resource-sessions?sessionId=${encodeURIComponent(resourceSessionId)}`}
                        className={linkClassName}
                    >
                        {t("logLinkResourceSession")}
                        <ArrowUpRight className="size-3" />
                    </Link>
                )}
            </div>
        </div>
    );
}
