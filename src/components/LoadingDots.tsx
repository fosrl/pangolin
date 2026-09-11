import { cn } from "@app/lib/cn";

type LoadingDotsProps = {
    className?: string;
    size?: "sm" | "md";
};

const sizeClasses = {
    sm: {
        gap: "gap-1.5",
        dot: "h-1.5 w-1.5"
    },
    md: {
        gap: "gap-2.5",
        dot: "h-2.5 w-2.5"
    }
} as const;

export default function LoadingDots({
    className,
    size = "md"
}: LoadingDotsProps) {
    const classes = sizeClasses[size];

    return (
        <span
            className={cn(
                "flex items-center text-muted-foreground",
                classes.gap,
                className
            )}
        >
            <span
                className={cn(
                    "rounded-full bg-current animate-dot-pulse",
                    classes.dot
                )}
                style={{ animationDelay: "0ms" }}
            />
            <span
                className={cn(
                    "rounded-full bg-current animate-dot-pulse",
                    classes.dot
                )}
                style={{ animationDelay: "200ms" }}
            />
            <span
                className={cn(
                    "rounded-full bg-current animate-dot-pulse",
                    classes.dot
                )}
                style={{ animationDelay: "400ms" }}
            />
        </span>
    );
}
