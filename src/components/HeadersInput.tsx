"use client";

import { useEffect, useState, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";

interface HeadersInputProps {
    value?: { name: string; value: string }[] | null;
    onChange: (value: { name: string; value: string }[] | null) => void;
    onValidityChange?: (isValid: boolean) => void;
    placeholder?: string;
    rows?: number;
    className?: string;
}

// Mirrors the server side validation in updateResource.ts so that invalid
// input is caught (and shown to the user) before it is ever submitted,
// instead of being silently dropped in favor of the last known good value.
const validHeaderNamePattern = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/;
const validHeaderValuePattern = /^[\t\x20-\x7E]*$/;
const templatePattern = /\{\{[^}]+\}\}/;

export function HeadersInput({
    value = [],
    onChange,
    onValidityChange,
    placeholder = `X-Example-Header: example-value
X-Another-Header: another-value`,
    rows = 4,
    className
}: HeadersInputProps) {
    const t = useTranslations();
    const [internalValue, setInternalValue] = useState("");
    const [error, setError] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const isUserEditingRef = useRef(false);

    // Convert header objects array to newline-separated string for display
    const convertToNewlineSeparated = (
        headers: { name: string; value: string }[] | null
    ): string => {
        if (!headers || headers.length === 0) return "";

        return headers
            .map((header) => `${header.name}: ${header.value}`)
            .join("\n");
    };

    // Parse newline-separated text into header objects, validating each line
    // against the same rules enforced by the server. Returns either the
    // parsed headers or an error message describing the first invalid line.
    const parseHeaders = (
        newlineSeparated: string
    ):
        | { headers: { name: string; value: string }[]; error: null }
        | { headers: null; error: string } => {
        if (!newlineSeparated || newlineSeparated.trim() === "") {
            return { headers: [], error: null };
        }

        const lines = newlineSeparated
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        const headers: { name: string; value: string }[] = [];

        for (const line of lines) {
            const colonIndex = line.indexOf(":");
            if (colonIndex === -1) {
                return { headers: null, error: t("headersValidationError") };
            }

            const name = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();

            if (
                !validHeaderNamePattern.test(name) ||
                !validHeaderValuePattern.test(value) ||
                templatePattern.test(name) ||
                templatePattern.test(value)
            ) {
                return { headers: null, error: t("headersValidationError") };
            }

            headers.push({ name, value });
        }

        return { headers, error: null };
    };

    // Update internal value when external value changes
    // But only if the user is not currently editing (textarea not focused)
    useEffect(() => {
        if (!isUserEditingRef.current) {
            setInternalValue(convertToNewlineSeparated(value ?? []));
            setError(null);
            onValidityChange?.(true);
        }
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        setInternalValue(newValue);

        // Mark that user is actively editing
        isUserEditingRef.current = true;

        const result = parseHeaders(newValue);

        if (result.error) {
            // Surface the error and do not touch the last known good value.
            // Silently dropping the update here (without telling the user)
            // is what previously let stale data get saved without warning.
            setError(result.error);
            onValidityChange?.(false);
            return;
        }

        setError(null);
        onValidityChange?.(true);
        onChange(result.headers);
    };

    const handleFocus = () => {
        isUserEditingRef.current = true;
    };

    const handleBlur = () => {
        // Small delay to allow any final change events to process
        setTimeout(() => {
            isUserEditingRef.current = false;
        }, 100);
    };

    return (
        <div>
            <Textarea
                ref={textareaRef}
                value={internalValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder={placeholder}
                rows={rows}
                className={className}
            />
            {error && (
                <p className="text-sm text-destructive mt-1.5">{error}</p>
            )}
        </div>
    );
}
