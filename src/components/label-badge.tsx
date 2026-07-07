import { cn } from "@app/lib/cn";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const labelBadgeClassName =
    "inline-flex h-auto items-center gap-1 rounded-full border border-input bg-background py-0 pl-1.5 pr-2 text-sm";

export type LabelBadgeProps = {
    name: string;
    color: string;
    onClick?: () => void;
    className?: string;
    displayOnly?: boolean;
};

export function LabelBadge({
    onClick,
    name,
    color,
    className,
    displayOnly = false
}: LabelBadgeProps) {
    const content = (
        <>
            <div
                className="size-2 flex-none rounded-full bg-(--color)"
                style={{
                    // @ts-expect-error css color
                    "--color": color
                }}
            />
            <span className="relative max-w-24 overflow-hidden text-ellipsis whitespace-nowrap">
                {name}
            </span>
        </>
    );

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {displayOnly ? (
                    <span className={cn(labelBadgeClassName, className)}>
                        {content}
                    </span>
                ) : (
                    <Button
                        variant="outline"
                        onClick={onClick}
                        className={cn(
                            labelBadgeClassName,
                            "cursor-pointer",
                            className
                        )}
                    >
                        {content}
                    </Button>
                )}
            </TooltipTrigger>
            <TooltipContent>{name}</TooltipContent>
        </Tooltip>
    );
}
