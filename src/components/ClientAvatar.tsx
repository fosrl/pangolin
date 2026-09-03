import { useState } from "react";
import { cn } from "@app/lib/cn";

const sizes = {
    sm: { box: "size-6", text: "text-xs font-medium" },
    md: { box: "size-8", text: "text-sm font-medium" },
    lg: { box: "size-10", text: "text-lg font-semibold" }
};

type ClientAvatarProps = {
    name: string;
    logoUri?: string | null;
    size?: keyof typeof sizes;
    className?: string;
};

export default function ClientAvatar({
    name,
    logoUri,
    size = "md",
    className
}: ClientAvatarProps) {
    const [logoLoadFailed, setLogoLoadFailed] = useState(false);
    const { box, text } = sizes[size];

    if (logoUri && /^https?:\/\//.test(logoUri) && !logoLoadFailed) {
        return (
            <img
                src={logoUri}
                alt={name}
                className={cn(box, "rounded object-contain", className)}
                onError={() => setLogoLoadFailed(true)}
            />
        );
    }

    return (
        <div
            className={cn(
                box,
                "rounded bg-muted flex items-center justify-center text-muted-foreground",
                text,
                className
            )}
        >
            {(name.charAt(0) || "?").toUpperCase()}
        </div>
    );
}
