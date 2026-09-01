"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useTranslations } from "next-intl";

type CopyTextBoxProps = {
    text?: string;
    displayText?: string;
    getCopyText?: () => Promise<string>;
    wrapText?: boolean;
    outline?: boolean;
    centered?: boolean;
};

export default function CopyTextBox({
    text = "",
    displayText,
    getCopyText,
    wrapText = false,
    outline = true,
    centered = false
}: CopyTextBoxProps) {
    const [isCopied, setIsCopied] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const textRef = useRef<HTMLPreElement>(null);
    const t = useTranslations();

    const copyToClipboard = async () => {
        if (!textRef.current || isCopying) {
            return;
        }

        setIsCopying(true);
        try {
            const value = getCopyText ? await getCopyText() : text;
            await navigator.clipboard.writeText(value);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error(t("copyTextFailed"), err);
        } finally {
            setIsCopying(false);
        }
    };

    return (
        <div
            className={`relative w-full border rounded-md ${!outline ? "bg-muted" : "bg-card"}`}
        >
            <pre
                ref={textRef}
                className={`py-4 text-sm w-full ${
                    centered ? "px-16 text-center" : "pl-4 pr-16"
                } ${
                    wrapText
                        ? "whitespace-pre-wrap break-words"
                        : "overflow-x-auto"
                }`}
            >
                <code className="block w-full">{displayText || text}</code>
            </pre>
            <Button
                variant="ghost"
                size="sm"
                type="button"
                className="absolute top-0.5 right-0 z-10 bg-card"
                onClick={copyToClipboard}
                loading={isCopying}
                aria-label={t("copyTextClipboard")}
            >
                {isCopied ? (
                    <Check className="h-4 w-4 text-green-500" />
                ) : (
                    <Copy className="h-4 w-4" />
                )}
            </Button>
        </div>
    );
}
