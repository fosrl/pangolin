import { cn } from "@app/lib/cn";
import { Check, Copy, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

type CopyToClipboardProps = {
    text: string;
    displayText?: string;
    getCopyText?: () => Promise<string>;
    isLink?: boolean;
    className?: string;
};

const CopyToClipboard = ({
    text,
    displayText,
    getCopyText,
    isLink,
    className
}: CopyToClipboardProps) => {
    const [copied, setCopied] = useState(false);
    const [copying, setCopying] = useState(false);

    const handleCopy = async () => {
        if (copying) {
            return;
        }

        setCopying(true);
        try {
            const value = getCopyText ? await getCopyText() : text;
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => {
                setCopied(false);
            }, 2000);
        } catch {
            // Fetch errors are toasted by the caller; clipboard failures stay silent.
        } finally {
            setCopying(false);
        }
    };

    const displayValue = displayText ?? text;

    const t = useTranslations();

    return (
        <div className="flex items-center space-x-2 min-w-0 max-w-full">
            <button
                type="button"
                className="h-4 w-4 p-0 flex items-center justify-center cursor-pointer flex-shrink-0"
                onClick={handleCopy}
                disabled={copying}
            >
                {copying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : copied ? (
                    <Check className="text-green-500 h-4 w-4" />
                ) : (
                    <Copy className="h-4 w-4" />
                )}
                <span className="sr-only">{t("copyText")}</span>
            </button>
            {isLink ? (
                <Link
                    href={text}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                        "truncate hover:underline text-sm min-w-0 max-w-full",
                        className
                    )}
                    title={text} // Shows full text on hover
                >
                    {displayValue}
                </Link>
            ) : (
                <span
                    className={cn(
                        "truncate text-sm min-w-0 max-w-full",
                        className
                    )}
                    style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                    }}
                    title={text} // Full text tooltip
                >
                    {displayValue}
                </span>
            )}
        </div>
    );
};

export default CopyToClipboard;
