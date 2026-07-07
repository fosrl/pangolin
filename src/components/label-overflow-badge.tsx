import { cn } from "@app/lib/cn";
import { useTranslations } from "next-intl";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type LabelOverflowItem = {
    color: string;
    name?: string;
};

const labelOverflowBadgeClassName =
    "inline-flex h-auto shrink-0 items-center gap-1.5 rounded-full border border-input bg-background py-0 pl-1.5 pr-2 text-sm";

export type LabelOverflowBadgeProps = {
    labels: LabelOverflowItem[];
    onClick?: () => void;
    className?: string;
    displayOnly?: boolean;
};

const MAX_OVERFLOW_COLORS = 3;

export function LabelOverflowBadge({
    labels,
    onClick,
    className,
    displayOnly = false
}: LabelOverflowBadgeProps) {
    const t = useTranslations();

    if (labels.length === 0) {
        return null;
    }

    const displayColors = labels
        .slice(0, MAX_OVERFLOW_COLORS)
        .map((label) => label.color);

    const overflowNames = labels
        .map((label) => label.name)
        .filter((name): name is string => Boolean(name));

    const tooltipContent =
        overflowNames.length > 0
            ? overflowNames.join(", ")
            : t("labelOverflowCount", { count: labels.length });

    const content = (
        <>
            <span className="inline-flex items-center">
                {displayColors.map((color, index) => (
                    <span
                        key={index}
                        className={cn(
                            "size-2 flex-none rounded-full bg-(--color) ring-1 ring-background",
                            index > 0 && "-ml-1"
                        )}
                        style={{
                            // @ts-expect-error css color
                            "--color": color
                        }}
                    />
                ))}
            </span>
            <span className="whitespace-nowrap text-muted-foreground">
                {t("labelOverflowCount", { count: labels.length })}
            </span>
        </>
    );

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {displayOnly ? (
                    <span
                        className={cn(labelOverflowBadgeClassName, className)}
                    >
                        {content}
                    </span>
                ) : (
                    <Button
                        variant="outline"
                        onClick={onClick}
                        className={cn(
                            labelOverflowBadgeClassName,
                            "cursor-pointer",
                            className
                        )}
                    >
                        {content}
                    </Button>
                )}
            </TooltipTrigger>
            <TooltipContent>{tooltipContent}</TooltipContent>
        </Tooltip>
    );
}
