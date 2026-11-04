"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@app/lib/cn";
import { cva, type VariantProps } from "class-variance-authority";

const progressVariants = cva(
    "border relative h-2 w-full overflow-hidden rounded-full",
    {
        variants: {
            variant: {
                default: "bg-muted",
                success: "bg-muted",
                warning: "bg-muted",
                danger: "bg-muted"
            }
        },
        defaultVariants: {
            variant: "default"
        }
    }
);

const indicatorVariants = cva("h-full w-full flex-1 transition-all", {
    variants: {
        variant: {
            default: "bg-primary",
            success: "bg-green-500",
            warning: "bg-yellow-500",
            danger: "bg-red-500"
        }
    },
    defaultVariants: {
        variant: "default"
    }
});

type ProgressProps = React.ComponentProps<typeof ProgressPrimitive.Root> &
    VariantProps<typeof progressVariants>;

function ProgressBackwards({
    className,
    value,
    variant,
    ...props
}: ProgressProps) {
    return (
        <ProgressPrimitive.Root
            data-slot="progress"
            className={cn(progressVariants({ variant }), className)}
            {...props}
        >
            <ProgressPrimitive.Indicator
                data-slot="progress-indicator"
                className={cn(indicatorVariants({ variant }))}
                style={{ transform: `translateX(${100 - (value || 0)}%)` }}
            />
        </ProgressPrimitive.Root>
    );
}

export { ProgressBackwards };
