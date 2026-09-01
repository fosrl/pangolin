"use client";

import { LoaderIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { compactNumberFormatter, formatCost } from "./shared";

export type TopEntity = {
    key: string;
    label: string;
    sublabel?: string | null;
    requests: number;
    totalTokens: number;
    costUsd: number | null;
};

type TopEntitiesListProps = {
    entities: TopEntity[];
    isLoading: boolean;
    nameColumnLabel: string;
    emptyLabel?: string;
};

export function TopEntitiesList(props: TopEntitiesListProps) {
    const t = useTranslations();
    const totalCost = props.entities.reduce(
        (sum, e) => sum + (e.costUsd ?? 0),
        0
    );

    return (
        <div className="h-full flex flex-col gap-2">
            {props.entities.length > 0 && (
                <div className="grid grid-cols-12 text-sm text-muted-foreground font-semibold h-4">
                    <div className="col-span-5">{props.nameColumnLabel}</div>
                    <div className="col-span-2 text-end">
                        {t("aiUsageRequests")}
                    </div>
                    <div className="col-span-2 text-end">
                        {t("aiUsageTokens")}
                    </div>
                    <div className="col-span-2 text-end">
                        {t("aiUsageCost")}
                    </div>
                    <div className="col-span-1 text-end">%</div>
                </div>
            )}
            <ol className="w-full overflow-auto gap-1 flex flex-col max-h-100">
                {props.entities.length === 0 && (
                    <div className="flex items-center justify-center size-full text-muted-foreground gap-2 py-8">
                        {props.isLoading ? (
                            <>
                                <LoaderIcon className="size-4 animate-spin" />
                                {t("aiUsageLoading")}
                            </>
                        ) : (
                            (props.emptyLabel ?? t("aiUsageNoData"))
                        )}
                    </div>
                )}
                {props.entities.map((entity) => {
                    const percent =
                        totalCost > 0 ? (entity.costUsd ?? 0) / totalCost : 0;
                    return (
                        <li
                            key={entity.key}
                            className="w-full grid grid-cols-12 rounded-xs hover:bg-muted relative items-center text-sm py-1"
                        >
                            <div
                                className="absolute bg-[#f36117]/40 top-0 bottom-0 left-0 rounded-xs"
                                style={{ width: `${percent * 100}%` }}
                            />
                            <div className="col-span-5 px-2 relative z-1 flex flex-col min-w-0">
                                <span className="truncate">{entity.label}</span>
                                {entity.sublabel && (
                                    <span className="text-xs text-muted-foreground truncate">
                                        {entity.sublabel}
                                    </span>
                                )}
                            </div>
                            <div className="col-span-2 text-end relative z-1">
                                {compactNumberFormatter.format(entity.requests)}
                            </div>
                            <div className="col-span-2 text-end relative z-1">
                                {compactNumberFormatter.format(
                                    entity.totalTokens
                                )}
                            </div>
                            <div className="col-span-2 text-end relative z-1">
                                {formatCost(entity.costUsd)}
                            </div>
                            <div className="col-span-1 text-end relative z-1">
                                {Math.round(percent * 100)}%
                            </div>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
