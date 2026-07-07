"use client";

import CopyToClipboard from "@app/components/CopyToClipboard";
import { Button } from "@app/components/ui/button";
import { InfoPopup } from "@app/components/ui/info-popup";
import { SettingsContainer } from "@app/components/Settings";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient } from "@app/lib/api";
import { formatSiteResourceDestinationDisplay } from "@app/lib/formatSiteResourceAccess";
import type { ListAllSiteResourcesByOrgResponse } from "@server/routers/siteResource";
import type { ListResourcesResponse } from "@server/routers/resource";
import type ResponseT from "@server/types/Response";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toUnicode } from "punycode";
import { useMemo, useState, type ReactNode } from "react";

const INITIAL_PAGE_SIZE = 5;
const LOAD_MORE_INCREMENT = 20;

type SiteResourceRow =
    ListAllSiteResourcesByOrgResponse["siteResources"][number];

type PublicResourceRow = ListResourcesResponse["resources"][number];

function isForbidden(e: unknown): boolean {
    return isAxiosError(e) && e.response?.status === 403;
}

function isSafeUrlForLink(href: string): boolean {
    try {
        void new URL(href);
        return true;
    } catch {
        return false;
    }
}

/** Meta text inside the left column (width comes from the column wrapper). */
const OVERVIEW_META_CLASS = "w-full min-w-0 text-muted-foreground text-sm";

function publicProtocolLabel(r: PublicResourceRow): string {
    if (r.mode == "http") {
        return r.ssl ? "HTTPS" : "HTTP";
    }
    const p = (r.mode || "").toLowerCase();
    if (p === "tcp") return "TCP";
    if (p === "udp") return "UDP";
    return (r.mode || "—").toUpperCase();
}

function PublicResourceMeta({ resource: r }: { resource: PublicResourceRow }) {
    return (
        <div className={OVERVIEW_META_CLASS}>
            <div className="truncate font-medium text-foreground">
                {publicProtocolLabel(r)}
            </div>
        </div>
    );
}

function PrivateResourceMeta({ row }: { row: SiteResourceRow }) {
    const t = useTranslations();
    const modeLabel: Record<SiteResourceRow["mode"], string> = {
        host: t("editInternalResourceDialogModeHost"),
        cidr: t("editInternalResourceDialogModeCidr"),
        http: t("editInternalResourceDialogModeHttp"),
        ssh: t("editInternalResourceDialogModeSsh")
    };
    const dest = formatSiteResourceDestinationDisplay({
        mode: row.mode,
        destination: row.destination,
        destinationPort: row.destinationPort ?? null,
        scheme: row.scheme
    });
    return (
        <div
            className={OVERVIEW_META_CLASS}
            title={`${modeLabel[row.mode]}\n${dest}`}
        >
            <div className="truncate font-medium text-foreground">
                {modeLabel[row.mode]}
            </div>
        </div>
    );
}

function PublicAccessMethod({ resource: r }: { resource: PublicResourceRow }) {
    const t = useTranslations();
    if (!["http", "ssh", "rdp", "vnc"].includes(r.mode || "")) {
        return (
            <CopyToClipboard
                text={r.proxyPort?.toString() ?? ""}
                isLink={false}
            />
        );
    }
    if (!r.domainId) {
        return (
            <InfoPopup
                info={t("domainNotFoundDescription")}
                text={t("domainNotFound")}
            />
        );
    }
    const fullUrl = `${r.ssl ? "https" : "http"}://${toUnicode(r.fullDomain || "")}`;
    return (
        <CopyToClipboard
            text={fullUrl}
            isLink={isSafeUrlForLink(fullUrl)}
            displayText={fullUrl}
        />
    );
}

function PrivateAccessMethod({ row }: { row: SiteResourceRow }) {
    if (row.mode === "http" && row.fullDomain) {
        const url = `${row.ssl ? "https" : "http"}://${toUnicode(row.fullDomain)}`;
        return (
            <CopyToClipboard
                text={url}
                isLink={isSafeUrlForLink(url)}
                displayText={url}
            />
        );
    }
    if (row.mode === "host" && row.alias) {
        return (
            <CopyToClipboard
                text={row.alias}
                isLink={false}
                displayText={row.alias}
            />
        );
    }
    const fromAlias = row.alias?.trim();
    if (fromAlias) {
        return (
            <CopyToClipboard
                text={fromAlias}
                isLink={false}
                displayText={fromAlias}
            />
        );
    }
    const dest = formatSiteResourceDestinationDisplay({
        mode: row.mode,
        destination: row.destination,
        destinationPort: row.destinationPort,
        scheme: row.scheme
    });
    return (
        <CopyToClipboard
            text={dest}
            isLink={isSafeUrlForLink(dest)}
            displayText={dest}
        />
    );
}

type OverviewRow = {
    key: number;
    meta: ReactNode;
    name: string;
    access: ReactNode;
    editHref: string;
};

type OverviewColumnProps = {
    title: string;
    description: string;
    viewAllHref: string;
    viewAllLabel: string;
    emptyLabel: string;
    isForbidden: boolean;
    isFetching: boolean;
    /** When there are no rows and the first fetch (no SSR initial data) is in flight. */
    isLoading: boolean;
    rows: OverviewRow[];
    canShowMore: boolean;
    onShowMore: () => void;
};

function OverviewColumn({
    title,
    description,
    viewAllHref,
    viewAllLabel,
    emptyLabel,
    isForbidden,
    isFetching,
    isLoading,
    rows,
    canShowMore,
    onShowMore
}: OverviewColumnProps) {
    const t = useTranslations();

    const header = (
        <div className="border-b px-5 py-5">
            <div className="flex items-start justify-between gap-4">
                <div className="text-lg space-y-0.5 pb-6">
                    <h2 className="text-1xl font-semibold tracking-tight flex items-center gap-2">
                        {title}
                    </h2>
                    <p className="text-muted-foreground text-sm">
                        {description}
                    </p>
                </div>
                <Link
                    href={viewAllHref}
                    className="shrink-0 text-muted-foreground text-sm hover:underline"
                >
                    {viewAllLabel}
                </Link>
            </div>
        </div>
    );

    if (isForbidden) {
        return (
            <div className="min-w-0 overflow-hidden rounded-lg border h-full flex flex-col">
                {header}
                <p className="px-5 py-3 text-sm text-muted-foreground">
                    {t("siteResourcesPermissionDenied")}
                </p>
            </div>
        );
    }

    return (
        <div className="min-w-0 overflow-hidden rounded-lg border h-full flex flex-col">
            {header}
            {rows.length === 0 ? (
                <div className="flex flex-1 items-center justify-center px-5 py-3 min-h-24">
                    {isLoading ? (
                        <div
                            className="flex flex-col items-center justify-center gap-2"
                            role="status"
                        >
                            <Loader2
                                className="h-6 w-6 animate-spin text-muted-foreground"
                                aria-hidden
                            />
                            <span className="sr-only">{t("loading")}</span>
                        </div>
                    ) : (
                        <p className="text-center text-sm text-muted-foreground">
                            {emptyLabel}
                        </p>
                    )}
                </div>
            ) : (
                <>
                    <div className="relative flex-1">
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-y-0 left-25 border-l border-border"
                        />
                        <ul className="relative divide-y">
                            {rows.map((row) => (
                                <li key={row.key} className="flex">
                                    <div className="w-25 min-w-0 shrink-0 px-5 py-3">
                                        {row.meta}
                                    </div>
                                    <div className="min-w-0 min-h-0 flex-1 px-5 py-3">
                                        <div className="truncate text-sm font-medium">
                                            {row.name}
                                        </div>
                                        <div className="mt-1 min-w-0 break-words text-sm text-muted-foreground">
                                            {row.access}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center px-5 py-3">
                                        <Button
                                            asChild
                                            type="button"
                                            variant="outline"
                                        >
                                            <Link href={row.editHref}>
                                                {t("edit")}
                                            </Link>
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                    {canShowMore ? (
                        <div className="border-t px-5 py-3 text-center">
                            <button
                                type="button"
                                onClick={onShowMore}
                                disabled={isFetching}
                                className="text-sm hover:underline text-muted-foreground cursor-pointer"
                            >
                                {isFetching
                                    ? t("loading")
                                    : t("siteResourcesShowMore")}
                            </button>
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
}

type SiteResourcesOverviewProps = {
    siteId: number;
    initialPublicData: ListResourcesResponse | null;
    initialPrivateData: ListAllSiteResourcesByOrgResponse | null;
    initialPublicForbidden: boolean;
    initialPrivateForbidden: boolean;
    /** When not under `/[orgId]/...` routes, pass org id explicitly (e.g. credenza on sites list). */
    orgIdOverride?: string;
};

export default function SiteResourcesOverview({
    siteId,
    initialPublicData,
    initialPrivateData,
    initialPublicForbidden,
    initialPrivateForbidden,
    orgIdOverride
}: SiteResourcesOverviewProps) {
    const t = useTranslations();
    const params = useParams<{ orgId: string }>();
    const orgId = orgIdOverride ?? params.orgId;
    const { env } = useEnvContext();
    const api = useMemo(() => createApiClient({ env }), [env]);

    const enabled = Boolean(orgId && siteId);

    const [publicPageSize, setPublicPageSize] = useState(INITIAL_PAGE_SIZE);
    const [privatePageSize, setPrivatePageSize] = useState(INITIAL_PAGE_SIZE);

    const publicQuery = useQuery({
        queryKey: [
            "siteResourcesOverview",
            "public",
            orgId,
            siteId,
            publicPageSize
        ] as const,
        enabled: enabled && !initialPublicForbidden,
        initialData: initialPublicData ?? undefined,
        queryFn: async (): Promise<ListResourcesResponse> => {
            const sp = new URLSearchParams({
                page: "1",
                pageSize: String(publicPageSize),
                siteId: String(siteId)
            });
            const res = await api.get(
                `/org/${orgId}/resources?${sp.toString()}`
            );
            const envelope = res.data as ResponseT<ListResourcesResponse>;
            const payload = envelope.data;
            if (!payload) {
                throw new Error("No data");
            }
            return payload;
        }
    });

    const privateQuery = useQuery({
        queryKey: [
            "siteResourcesOverview",
            "private",
            orgId,
            siteId,
            privatePageSize
        ] as const,
        enabled: enabled && !initialPrivateForbidden,
        initialData: initialPrivateData ?? undefined,
        queryFn: async (): Promise<ListAllSiteResourcesByOrgResponse> => {
            const sp = new URLSearchParams({
                page: "1",
                pageSize: String(privatePageSize),
                siteId: String(siteId)
            });
            const res = await api.get(
                `/org/${orgId}/site-resources?${sp.toString()}`
            );
            const envelope =
                res.data as ResponseT<ListAllSiteResourcesByOrgResponse>;
            const payload = envelope.data;
            if (!payload) {
                throw new Error("No data");
            }
            return payload;
        }
    });

    const publicList = publicQuery.data?.resources ?? [];
    const publicTotal = publicQuery.data?.pagination.total ?? 0;
    const privateList = privateQuery.data?.siteResources ?? [];
    const privateTotal = privateQuery.data?.pagination.total ?? 0;

    const publicForbidden =
        initialPublicForbidden ||
        (publicQuery.isError && isForbidden(publicQuery.error));
    const privateForbidden =
        initialPrivateForbidden ||
        (privateQuery.isError && isForbidden(privateQuery.error));

    const waitingOnPublicList =
        enabled && !publicForbidden && publicQuery.isPending;
    const waitingOnPrivateList =
        enabled && !privateForbidden && privateQuery.isPending;

    const showEmptyPlaceholder =
        !waitingOnPublicList &&
        !waitingOnPrivateList &&
        !publicForbidden &&
        !privateForbidden &&
        publicList.length === 0 &&
        privateList.length === 0;

    const publicViewAllHref = `/${orgId}/settings/resources/public?siteId=${siteId}`;
    const privateViewAllHref = `/${orgId}/settings/resources/private?siteId=${siteId}`;

    const publicRows = publicList.map((r) => ({
        key: r.resourceId,
        meta: <PublicResourceMeta resource={r} />,
        name: r.name,
        access: <PublicAccessMethod resource={r} />,
        editHref: `/${orgId}/settings/resources/public/${r.niceId}`
    }));

    const privateRows = privateList.map((row) => {
        const qs = new URLSearchParams({
            siteId: String(siteId),
            query: row.niceId
        });
        return {
            key: row.siteResourceId,
            meta: <PrivateResourceMeta row={row} />,
            name: row.name,
            access: <PrivateAccessMethod row={row} />,
            editHref: `/${orgId}/settings/resources/private?${qs.toString()}`
        };
    });

    if (showEmptyPlaceholder) {
        return (
            <SettingsContainer>
                <p className="pt-2 text-sm text-muted-foreground">
                    {t("siteResourcesNoneOnSite")}
                </p>
            </SettingsContainer>
        );
    }

    const publicEmptyLoading =
        enabled &&
        !publicForbidden &&
        publicRows.length === 0 &&
        publicQuery.isPending;
    const privateEmptyLoading =
        enabled &&
        !privateForbidden &&
        privateRows.length === 0 &&
        privateQuery.isPending;

    const publicColumn = (
        <OverviewColumn
            key="public"
            title={t("siteResourcesSectionPublic")}
            description={t("siteResourcesSectionPublicDescription")}
            viewAllHref={publicViewAllHref}
            viewAllLabel={t("siteResourcesViewAllPublic")}
            emptyLabel={t("siteResourcesEmptyPublic")}
            isForbidden={publicForbidden}
            isFetching={publicQuery.isFetching}
            isLoading={publicEmptyLoading}
            rows={publicRows}
            canShowMore={publicList.length < publicTotal}
            onShowMore={() => setPublicPageSize((n) => n + LOAD_MORE_INCREMENT)}
        />
    );

    const privateColumn = (
        <OverviewColumn
            key="private"
            title={t("siteResourcesSectionPrivate")}
            description={t("siteResourcesSectionPrivateDescription")}
            viewAllHref={privateViewAllHref}
            viewAllLabel={t("siteResourcesViewAllPrivate")}
            emptyLabel={t("siteResourcesEmptyPrivate")}
            isForbidden={privateForbidden}
            isFetching={privateQuery.isFetching}
            isLoading={privateEmptyLoading}
            rows={privateRows}
            canShowMore={privateList.length < privateTotal}
            onShowMore={() =>
                setPrivatePageSize((n) => n + LOAD_MORE_INCREMENT)
            }
        />
    );

    return (
        <SettingsContainer>
            <div className="grid gap-6 md:grid-cols-2">
                {publicColumn}
                {privateColumn}
            </div>
        </SettingsContainer>
    );
}
