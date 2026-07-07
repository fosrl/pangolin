import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@app/lib/cn";

const buttonVariants = cva(
    "cursor-pointer inline-flex items-center justify-center whitespace-nowrap text-sm font-normal ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default:
                    "bg-primary text-primary-foreground hover:bg-primary/90",
                destructive:
                    "bg-destructive text-white dark:text-destructive-foreground hover:bg-destructive/90 ",
                outline:
                    "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground ",
                outlinePrimary:
                    "border border-primary bg-card hover:bg-primary/10 text-primary ",
                secondary:
                    "bg-muted border border-input border text-secondary-foreground hover:bg-muted/80 ",
                ghost: "hover:bg-accent hover:text-accent-foreground",
                squareOutlinePrimary:
                    "border border-primary bg-card hover:bg-primary/10 text-primary rounded-md ",
                squareOutline:
                    "border border-input bg-card hover:bg-accent hover:text-accent-foreground rounded-md ",
                squareDefault:
                    "bg-primary text-primary-foreground hover:bg-primary/90 rounded-md ",
                text: "",
                link: "text-primary underline-offset-4 hover:underline"
            },
            size: {
                default: "h-9 rounded-md px-3",
                sm: "h-8 rounded-md px-3",
                lg: "h-10 rounded-md px-8",
                icon: "h-9 w-9 rounded-md"
            }
        },
        defaultVariants: {
            variant: "default",
            size: "default"
        }
    }
);

export interface ButtonProps
    extends
        React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean;
    loading?: boolean; // Add loading prop
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            className,
            variant,
            size,
            asChild = false,
            loading = false,
            ...props
        },
        ref
    ) => {
        const Comp = asChild ? Slot : "button";
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                disabled={loading || props.disabled} // Disable button when loading
                {...props}
            >
                {asChild ? (
                    props.children
                ) : loading ? (
                    <span className="relative inline-flex items-center justify-center">
                        <span className="inline-flex items-center justify-center opacity-0">
                            {props.children}
                        </span>
                        <span className="absolute inset-0 flex items-center justify-center">
                            <span className="flex items-center gap-1.5">
                                <span
                                    className="h-1 w-1 bg-current animate-dot-pulse"
                                    style={{ animationDelay: "0ms" }}
                                />
                                <span
                                    className="h-1 w-1 bg-current animate-dot-pulse"
                                    style={{ animationDelay: "200ms" }}
                                />
                                <span
                                    className="h-1 w-1 bg-current animate-dot-pulse"
                                    style={{ animationDelay: "400ms" }}
                                />
                            </span>
                        </span>
                    </span>
                ) : (
                    props.children
                )}
            </Comp>
        );
    }
);
Button.displayName = "Button";

export { Button, buttonVariants };
