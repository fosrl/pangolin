import { cn } from "@app/lib/cn";
import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

type CopyToClipboardProps = {
    text: string;
    displayText?: string;
    isLink?: boolean;
    className?: string;
};

const CopyToClipboard = ({
    text,
    displayText,
    isLink,
    className
}: CopyToClipboardProps) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);

        setTimeout(() => {
            setCopied(false);
        }, 2000);
    };

    const displayValue = displayText ?? text;

    const t = useTranslations();

    return (
        <div className="flex items-center space-x-2 min-w-0 max-w-full">
            <button
                type="button"
                className="h-4 w-4 p-0 flex items-center justify-center cursor-pointer flex-shrink-0"
                onClick={handleCopy}
            >
                {!copied ? (
                    <Copy className="h-4 w-4" />
                ) : (
                    <Check className="text-green-500 h-4 w-4" />
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
