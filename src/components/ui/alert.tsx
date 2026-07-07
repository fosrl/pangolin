import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@app/lib/cn";

const alertVariants = cva(
    "relative w-full rounded-lg p-4 has-[>svg]:grid has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 gap-y-1 [&>svg]:col-start-1 [&>svg]:row-start-1 [&>svg]:row-span-full [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:self-center [&>svg]:text-foreground [&>svg~*]:col-start-2",
    {
        variants: {
            variant: {
                default: "bg-card border text-foreground",
                neutral: "bg-card bg-muted border text-foreground",
                destructive:
                    "border-destructive/50 border bg-destructive/8 dark:text-red-200 text-red-900 dark:border-destructive/50 [&>svg]:text-destructive",
                success:
                    "border-green-500/50 border bg-green-500/10 text-green-500 dark:border-success [&>svg]:text-green-500",
                info: "border-blue-500/50 border bg-blue-500/10 text-blue-800 dark:text-blue-400 dark:border-blue-400 [&>svg]:text-blue-500",
                warning:
                    "border-yellow-500 border text-yellow-800 bg-yellow-500/20 dark:bg-yellow-800/20 dark:text-yellow-100 dark:border-yellow-700 [&>svg]:text-yellow-500"
            }
        },
        defaultVariants: {
            variant: "default"
        }
    }
);

const Alert = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
    <div
        ref={ref}
        role="alert"
        className={cn(alertVariants({ variant }), className)}
        {...props}
    />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
    <h5
        ref={ref}
        className={cn(
            "mb-1 font-medium leading-none tracking-tight",
            className
        )}
        {...props}
    />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn("text-sm [&_p]:leading-relaxed", className)}
        {...props}
    />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
