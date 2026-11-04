import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@app/lib/cn";

const badgeVariants = cva(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
    {
        variants: {
            variant: {
                default:
                    "border-transparent bg-primary text-primary-foreground",
                outlinePrimary:
                    "border-transparent bg-transparent border-primary text-primary",
                secondary: "bg-muted border text-secondary-foreground",
                destructive:
                    "border-transparent bg-destructive text-destructive-foreground",
                outline: "text-foreground",
                green: "border-green-600 bg-green-500/20 text-green-700 dark:text-green-300",
                yellow: "border-yellow-600 bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
                red: "border-red-400 bg-red-300/20 text-red-600 dark:text-red-300"
            }
        },
        defaultVariants: {
            variant: "default"
        }
    }
);

export interface BadgeProps
    extends
        React.HTMLAttributes<HTMLDivElement>,
        VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant }), className)} {...props} />
    );
}

export { Badge, badgeVariants };
