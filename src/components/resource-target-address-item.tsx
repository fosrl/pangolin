import { cn } from "@app/lib/cn";
import type { DockerState } from "@app/lib/docker";
import { parseHostTarget } from "@app/lib/parseHostTarget";
import { CaretSortIcon } from "@radix-ui/react-icons";
import type { ListSitesResponse } from "@server/routers/site";
import { type ListTargetsResponse } from "@server/routers/target";
import type { ArrayElement } from "@server/types/ArrayElement";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ContainersSelector } from "./ContainersSelector";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
import { SitesSelector } from "./site-selector";

type SiteWithUpdateAvailable = ListSitesResponse["sites"][number];

export type LocalTarget = Omit<
    ArrayElement<ListTargetsResponse["targets"]> & {
        new?: boolean;
        updated?: boolean;
        siteType: string | null;
    },
    "protocol"
>;

export type ResourceTargetSiteItemProps = {
    getDockerStateForSite: (siteId: number) => DockerState;
    updateTarget: (targetId: number, data: Partial<LocalTarget>) => void;
    orgId: string;
    proxyTarget: LocalTarget;
    refreshContainersForSite: (siteId: number) => void;
};

export function ResourceTargetSiteItem({
    orgId,
    getDockerStateForSite,
    updateTarget,
    proxyTarget,
    refreshContainersForSite
}: ResourceTargetSiteItemProps) {
    const t = useTranslations();

    const [selectedSite, setSelectedSite] = useState<Pick<
        SiteWithUpdateAvailable,
        "name" | "siteId" | "type"
    > | null>(() => {
        if (
            proxyTarget.siteName &&
            proxyTarget.siteType &&
            proxyTarget.siteId
        ) {
            return {
                name: proxyTarget.siteName,
                siteId: proxyTarget.siteId,
                type: proxyTarget.siteType
            };
        }
        return null;
    });

    const handleContainerSelectForTarget = (
        hostname: string,
        port?: number
    ) => {
        updateTarget(proxyTarget.targetId, {
            ...proxyTarget,
            ip: hostname,
            ...(port && { port: port })
        });
    };

    return (
        <div
            className="flex w-full min-w-0 items-center h-9 border border-input rounded-md"
            key={proxyTarget.targetId}
        >
            {selectedSite && selectedSite.type === "newt" && (
                <ContainersSelector
                    site={selectedSite}
                    containers={
                        getDockerStateForSite(selectedSite.siteId).containers
                    }
                    isAvailable={
                        getDockerStateForSite(selectedSite.siteId).isAvailable
                    }
                    onContainerSelect={handleContainerSelectForTarget}
                    onRefresh={() =>
                        refreshContainersForSite(selectedSite.siteId)
                    }
                />
            )}

            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        role="combobox"
                        className={cn(
                            "h-9 min-w-0 flex-1 justify-between px-3 rounded-none hover:bg-transparent",
                            !proxyTarget.siteId && "text-muted-foreground"
                        )}
                    >
                        <span className="truncate">
                            {proxyTarget.siteId
                                ? selectedSite?.name
                                : t("siteSelect")}
                        </span>
                        <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0">
                    <SitesSelector
                        orgId={orgId}
                        selectedSite={selectedSite}
                        onSelectSite={(site) => {
                            updateTarget(proxyTarget.targetId, {
                                siteId: site.siteId,
                                siteType: site.type,
                                siteName: site.name
                            });
                            setSelectedSite(site);
                        }}
                    />
                </PopoverContent>
            </Popover>
        </div>
    );
}

export type ResourceTargetAddressItemProps = {
    updateTarget: (targetId: number, data: Partial<LocalTarget>) => void;
    proxyTarget: LocalTarget;
    isHttp: boolean;
};

export function ResourceTargetAddressItem({
    updateTarget,
    proxyTarget,
    isHttp
}: ResourceTargetAddressItemProps) {
    return (
        <div className="flex items-center w-full" key={proxyTarget.targetId}>
            <div className="flex items-center w-full justify-start py-0 space-x-2 px-0 cursor-default border border-input rounded-md">
                {isHttp && (
                    <Select
                        defaultValue={proxyTarget.method ?? "http"}
                        onValueChange={(value) =>
                            updateTarget(proxyTarget.targetId, {
                                ...proxyTarget,
                                method: value
                            })
                        }
                    >
                        <SelectTrigger className="h-9 w-17.5 border-none bg-transparent shadow-none data-[state=open]:bg-transparent rounded-none mr-0 pr-0">
                            {proxyTarget.method || "http"}
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="http">http</SelectItem>
                            <SelectItem value="https">https</SelectItem>
                            <SelectItem value="h2c">h2c</SelectItem>
                        </SelectContent>
                    </Select>
                )}

                {isHttp && (
                    <div className="flex items-center justify-center h-9 mr-0 pl-1">
                        {"://"}
                    </div>
                )}

                <Input
                    defaultValue={proxyTarget.ip}
                    placeholder="Host"
                    className="flex-1 min-w-30 border-none placeholder-gray-400 rounded-xs"
                    onBlur={(e) => {
                        const input = e.target.value.trim();
                        const hasProtocol = /^(https?|h2c):\/\//.test(input);
                        const hasPort = /:\d+(?:\/|$)/.test(input);

                        if (hasProtocol || hasPort) {
                            const parsed = parseHostTarget(input);
                            if (parsed) {
                                updateTarget(proxyTarget.targetId, {
                                    ...proxyTarget,
                                    method: hasProtocol
                                        ? parsed.protocol
                                        : proxyTarget.method,
                                    ip: parsed.host,
                                    port: hasPort
                                        ? parsed.port
                                        : proxyTarget.port
                                });
                            } else {
                                updateTarget(proxyTarget.targetId, {
                                    ...proxyTarget,
                                    ip: input
                                });
                            }
                        } else {
                            updateTarget(proxyTarget.targetId, {
                                ...proxyTarget,
                                ip: input
                            });
                        }
                    }}
                />
                <div className="flex items-center justify-center h-9 mr-0">
                    {":"}
                </div>
                <Input
                    placeholder="Port"
                    defaultValue={
                        proxyTarget.port === 0 ? "" : proxyTarget.port
                    }
                    className="w-18.75 px-2 border-none placeholder-gray-400 rounded-l-xs"
                    type="number"
                    onKeyDown={(e) => {
                        if (["e", "E", "+", "-", "."].includes(e.key)) {
                            e.preventDefault();
                        }
                    }}
                    onBlur={(e) => {
                        const value = parseInt(e.target.value, 10);
                        if (!isNaN(value) && value > 0) {
                            updateTarget(proxyTarget.targetId, {
                                ...proxyTarget,
                                port: value
                            });
                        } else {
                            updateTarget(proxyTarget.targetId, {
                                ...proxyTarget,
                                port: 0
                            });
                        }
                    }}
                />
            </div>
        </div>
    );
}
