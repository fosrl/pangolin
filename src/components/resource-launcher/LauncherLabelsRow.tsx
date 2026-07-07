"use client";

import type { LauncherLabel } from "@server/routers/launcher/types";
import { LabelBadge } from "@app/components/label-badge";
import { LabelOverflowBadge } from "@app/components/label-overflow-badge";
import { cn } from "@app/lib/cn";
import { useLayoutEffect, useRef, useState } from "react";

const MAX_LABEL_ROWS = 2;
const SINGLE_ROW_MAX_LABELS = 5;

type LauncherLabelsRowProps = {
    labels: LauncherLabel[];
    className?: string;
    variant?: "wrap" | "single-row";
};

function countFlexRows(container: HTMLElement): number {
    const rowTops = new Set<number>();

    for (const child of container.children) {
        const element = child as HTMLElement;
        if (element.style.display === "none") {
            continue;
        }
        rowTops.add(element.offsetTop);
    }

    return rowTops.size;
}

export function LauncherLabelsRow({
    labels,
    className,
    variant = "wrap"
}: LauncherLabelsRowProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const [visibleCount, setVisibleCount] = useState(labels.length);

    const labelKey = labels.map((label) => label.labelId).join(",");

    useLayoutEffect(() => {
        if (variant === "single-row") {
            return;
        }

        const container = containerRef.current;
        const measure = measureRef.current;
        if (!container || !measure || labels.length === 0) {
            return;
        }

        const recompute = () => {
            const width = container.clientWidth;
            if (width <= 0) {
                setVisibleCount(labels.length);
                return;
            }

            measure.style.width = `${width}px`;

            const labelNodes = measure.querySelectorAll<HTMLElement>(
                "[data-measure-label]"
            );
            const overflowNode = measure.querySelector<HTMLElement>(
                "[data-measure-overflow]"
            );

            const fits = (visible: number) => {
                labelNodes.forEach((node, index) => {
                    node.style.display = index < visible ? "" : "none";
                });

                if (overflowNode) {
                    const overflowCount = labels.length - visible;
                    if (overflowCount > 0) {
                        overflowNode.style.display = "";
                    } else {
                        overflowNode.style.display = "none";
                    }
                }

                return countFlexRows(measure) <= MAX_LABEL_ROWS;
            };

            let best = 0;
            for (let visible = labels.length; visible >= 0; visible--) {
                if (fits(visible)) {
                    best = visible;
                    break;
                }
            }

            setVisibleCount(best);
        };

        recompute();

        const observer = new ResizeObserver(recompute);
        observer.observe(container);

        return () => observer.disconnect();
    }, [labelKey, labels, variant]);

    if (labels.length === 0) {
        return null;
    }

    const resolvedVisibleCount =
        variant === "single-row"
            ? Math.min(labels.length, SINGLE_ROW_MAX_LABELS)
            : visibleCount;
    const visibleLabels = labels.slice(0, resolvedVisibleCount);
    const overflowLabels = labels.slice(resolvedVisibleCount);

    return (
        <div
            ref={containerRef}
            className={cn("relative min-w-0 w-full", className)}
        >
            <div
                className={cn(
                    "flex items-center gap-1",
                    variant === "single-row" ? "flex-nowrap" : "flex-wrap"
                )}
            >
                {visibleLabels.map((label) => (
                    <LabelBadge
                        key={label.labelId}
                        name={label.name}
                        color={label.color}
                        displayOnly
                        className="shrink-0"
                    />
                ))}
                {overflowLabels.length > 0 ? (
                    <LabelOverflowBadge
                        labels={overflowLabels.map((label) => ({
                            color: label.color,
                            name: label.name
                        }))}
                        displayOnly
                        className="shrink-0"
                    />
                ) : null}
            </div>

            {variant === "wrap" ? (
                <div
                    ref={measureRef}
                    className="pointer-events-none invisible absolute left-0 top-0 flex flex-wrap items-center gap-1"
                    aria-hidden
                >
                    {labels.map((label) => (
                        <span key={label.labelId} data-measure-label>
                            <LabelBadge
                                name={label.name}
                                color={label.color}
                                displayOnly
                                className="shrink-0"
                            />
                        </span>
                    ))}
                    <span
                        data-measure-overflow
                        className="inline-flex shrink-0"
                    >
                        <LabelOverflowBadge labels={labels} displayOnly />
                    </span>
                </div>
            ) : null}
        </div>
    );
}
