"use client";

import { useEnvContext } from "@app/hooks/useEnvContext";
import { useLocalStorage } from "@app/hooks/useLocalStorage";
import { cn } from "@app/lib/cn";
import {
    type LatestVersionResponse,
    type ProductUpdate,
    productUpdatesQueries
} from "@app/lib/queries";
import { build } from "@server/build";
import { useQueries } from "@tanstack/react-query";
import {
    ArrowRight,
    BellIcon,
    ChevronRightIcon,
    ExternalLinkIcon,
    RocketIcon,
    XIcon
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Transition } from "@headlessui/react";
import * as React from "react";
import { gt, valid } from "semver";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { timeAgoFormatter } from "@app/lib/timeAgoFormatter";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "./ui/tooltip";

export default function ProductUpdates({
    isCollapsed
}: {
    isCollapsed?: boolean;
}) {
    const { env } = useEnvContext();

    const productUpdatesEnabled = env.app.notifications.product_updates;
    const versionCheckEnabled =
        env.app.notifications.new_releases && build !== "saas";

    const data = useQueries({
        queries: [
            productUpdatesQueries.list(productUpdatesEnabled, env.app.version),
            productUpdatesQueries.latestVersion(
                env.app.notifications.new_releases
            )
        ],
        combine(result) {
            const [updatesQuery, versionQuery] = result;

            const updatesSettled =
                !productUpdatesEnabled ||
                updatesQuery.isFetched ||
                updatesQuery.isError;
            const versionSettled =
                !versionCheckEnabled ||
                versionQuery.isFetched ||
                versionQuery.isError;

            if (!updatesSettled || !versionSettled) return null;

            const updates = updatesQuery.isError
                ? []
                : Array.isArray(updatesQuery.data?.data)
                  ? updatesQuery.data.data
                  : [];

            const latestVersion = versionQuery.isError
                ? undefined
                : versionQuery.data;

            return { updates, latestVersion };
        }
    });
    const t = useTranslations();
    const [showMoreUpdatesText, setShowMoreUpdatesText] = React.useState(false);

    // we delay the small text animation so that the user can notice it
    React.useEffect(() => {
        const timeout = setTimeout(() => setShowMoreUpdatesText(true), 600);
        return () => clearTimeout(timeout);
    }, []);

    const [ignoredVersionUpdate, setIgnoredVersionUpdate] = useLocalStorage<
        string | null
    >("product-updates:skip-version", null);

    const [productUpdatesRead, setProductUpdatesRead] = useLocalStorage<
        number[]
    >("product-updates:read", []);

    if (!data) return null;

    const versionResponse = data.latestVersion?.data;
    const latestVersion = versionResponse?.pangolin?.latestVersion;
    const currentVersion = env.app.version;

    let showNewVersionPopup = false;
    if (
        latestVersion &&
        valid(latestVersion) &&
        valid(currentVersion) &&
        ignoredVersionUpdate !== latestVersion
    ) {
        try {
            showNewVersionPopup = gt(latestVersion, currentVersion);
        } catch {
            showNewVersionPopup = false;
        }
    }

    const readUpdateIds = Array.isArray(productUpdatesRead)
        ? productUpdatesRead
        : [];

    const filteredUpdates = data.updates.filter(
        (update) => !readUpdateIds.includes(update.id)
    );

    if (filteredUpdates.length === 0 && !showNewVersionPopup) {
        return null;
    }

    return (
        <div
            className={cn(
                "flex flex-col gap-2 overflow-clip",
                isCollapsed && "hidden"
            )}
        >
            <div className="flex flex-col gap-1">
                {filteredUpdates.length > 0 && (
                    <div className="mt-3 flex flex-col gap-2">
                        {filteredUpdates.length > 1 && (
                            <small
                                className={cn(
                                    "text-xs text-muted-foreground flex items-center gap-1",
                                    showMoreUpdatesText
                                        ? "animate-in fade-in duration-300"
                                        : "opacity-0"
                                )}
                            >
                                <BellIcon className="flex-none size-3" />
                                <span>
                                    {showNewVersionPopup
                                        ? t("productUpdateMoreInfo", {
                                              noOfUpdates:
                                                  filteredUpdates.length
                                          })
                                        : t("productUpdateInfo", {
                                              noOfUpdates:
                                                  filteredUpdates.length
                                          })}
                                </span>
                            </small>
                        )}
                        <ProductUpdatesListPopup
                            updates={filteredUpdates}
                            show={filteredUpdates.length > 0}
                            onDimissAll={() =>
                                setProductUpdatesRead([
                                    ...readUpdateIds,
                                    ...filteredUpdates.map(
                                        (update) => update.id
                                    )
                                ])
                            }
                            onDimiss={(id) =>
                                setProductUpdatesRead([...readUpdateIds, id])
                            }
                        />
                    </div>
                )}
            </div>

            <NewVersionAvailable
                version={versionResponse}
                onDimiss={() => {
                    setIgnoredVersionUpdate(latestVersion ?? null);
                }}
                show={showNewVersionPopup}
            />
        </div>
    );
}

type ProductUpdatesListPopupProps = {
    updates: ProductUpdate[];
    show: boolean;
    onDimiss: (id: number) => void;
    onDimissAll: () => void;
};

function ProductUpdatesListPopup({
    updates,
    show,
    onDimiss,
    onDimissAll
}: ProductUpdatesListPopupProps) {
    const [showContent, setShowContent] = React.useState(false);
    const [popoverOpen, setPopoverOpen] = React.useState(false);
    const t = useTranslations();

    // we need to delay the initial opening state to have an animation on `appear`
    React.useEffect(() => {
        if (show) {
            requestAnimationFrame(() => setShowContent(true));
        }
    }, [show]);

    React.useEffect(() => {
        if (updates.length === 0) {
            setShowContent(false);
            setPopoverOpen(false);
        }
    }, [updates.length]);

    return (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <Transition show={showContent}>
                <PopoverTrigger asChild>
                    <div
                        className={cn(
                            "relative z-1 cursor-pointer block group",
                            "rounded-md border bg-secondary p-2 py-3 w-full flex flex-col gap-2 text-sm",
                            "transition duration-300 ease-in-out",
                            "data-closed:opacity-0 data-closed:translate-y-full"
                        )}
                    >
                        <div className="flex items-center gap-2">
                            <BellIcon className="flex-none size-4" />
                            <div className="flex justify-between items-center flex-1">
                                <p className="font-medium text-start">
                                    {t("productUpdateWhatsNew")}
                                </p>
                                <div className="p-1 cursor-pointer">
                                    <ChevronRightIcon className="size-3.5 flex-none opacity-50 transition-transform duration-300 ease-in-out group-hover:translate-x-1" />
                                </div>
                            </div>
                        </div>
                        <small
                            className={cn(
                                "text-start text-muted-foreground",
                                "overflow-hidden h-8",
                                "[-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
                            )}
                        >
                            {updates[0]?.contents}
                        </small>
                    </div>
                </PopoverTrigger>
            </Transition>
            <PopoverContent
                side="right"
                align="end"
                sideOffset={10}
                className="p-0 flex flex-col w-85"
            >
                <div className="p-3 flex justify-between border-b items-center">
                    <span className="text-sm inline-flex gap-2 items-center font-medium">
                        {t("productUpdateTitle")}
                        {updates.length > 0 && (
                            <Badge variant="secondary">{updates.length}</Badge>
                        )}
                    </span>
                    <Button variant="outline" onClick={onDimissAll}>
                        {t("dismissAll")}
                    </Button>
                </div>
                <ol className="p-3 flex flex-col gap-1 max-h-112 overflow-y-auto">
                    {updates.length === 0 && (
                        <small className="border rounded-md flex p-4 border-dashed justify-center items-center text-muted-foreground">
                            {t("productUpdateEmpty")}
                        </small>
                    )}
                    {updates.map((update) => (
                        <li
                            key={update.id}
                            className="border rounded-md flex flex-col p-4 gap-2.5 group hover:bg-accent relative"
                        >
                            <div className="flex justify-between gap-2 items-start">
                                <h4 className="text-sm font-medium inline-flex items-start gap-1">
                                    <span>{update.title}</span>
                                    <Badge
                                        variant={
                                            update.type === "Important"
                                                ? "yellow"
                                                : "secondary"
                                        }
                                        className={cn(
                                            update.type === "New" &&
                                                "bg-black text-white dark:bg-white dark:text-black"
                                        )}
                                    >
                                        {update.type}
                                    </Badge>
                                </h4>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="outline"
                                                className="p-1 py-1 opacity-100 h-auto group-hover:opacity-100"
                                                onClick={() =>
                                                    onDimiss(update.id)
                                                }
                                            >
                                                <XIcon className="flex-none size-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent
                                            side="right"
                                            sideOffset={8}
                                        >
                                            {t("dismiss")}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <small className="text-muted-foreground">
                                    {update.contents}{" "}
                                    {update.link && (
                                        <a
                                            href={update.link}
                                            target="_blank"
                                            className="underline text-foreground inline-flex flex-wrap items-center gap-1 text-xs"
                                        >
                                            Read more{" "}
                                            <ExternalLinkIcon className="size-3 flex-none" />
                                        </a>
                                    )}
                                </small>
                            </div>
                            <time
                                dateTime={update.publishedAt.toLocaleString()}
                                className="text-xs text-muted-foreground"
                            >
                                {timeAgoFormatter(update.publishedAt)}
                            </time>
                        </li>
                    ))}
                </ol>
            </PopoverContent>
        </Popover>
    );
}

type NewVersionAvailableProps = {
    onDimiss: () => void;
    show: boolean;
    version: LatestVersionResponse | null | undefined;
};

function NewVersionAvailable({
    version,
    show,
    onDimiss
}: NewVersionAvailableProps) {
    const t = useTranslations();
    const [open, setOpen] = React.useState(false);

    // we need to delay the initial opening state to have an animation on `appear`
    React.useEffect(() => {
        if (show) {
            requestAnimationFrame(() => setOpen(true));
        }
    }, [show]);

    if (!version?.pangolin?.latestVersion) {
        return null;
    }

    return (
        <Transition show={open}>
            {version && (
                <a
                    href={version.pangolin.releaseNotes}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                        "relative z-2 group cursor-pointer block",
                        "rounded-md border bg-secondary p-2 py-3 w-full flex flex-col gap-2 text-sm",
                        "transition duration-300 ease-in-out",
                        "data-closed:opacity-0 data-closed:translate-y-full"
                    )}
                >
                    <div className="flex items-center gap-2">
                        <RocketIcon className="flex-none size-4" />
                        <p className="font-medium flex-1">
                            {t("pangolinUpdateAvailable")}
                        </p>
                        <button
                            className="p-1 cursor-pointer z-10"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOpen(false);
                                onDimiss();
                            }}
                        >
                            <XIcon className="size-3 flex-none opacity-50" />
                        </button>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <small className="text-muted-foreground">
                            {t("pangolinUpdateAvailableInfo", {
                                version: version.pangolin.latestVersion
                            })}
                        </small>
                        <div className="inline-flex items-center gap-1 text-xs">
                            <span>
                                {t("pangolinUpdateAvailableReleaseNotes")}
                            </span>
                            <ArrowRight className="flex-none size-3" />
                        </div>
                    </div>
                </a>
            )}
        </Transition>
    );
}
