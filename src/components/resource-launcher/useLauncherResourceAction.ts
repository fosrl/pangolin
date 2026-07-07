"use client";

import { useToast } from "@app/hooks/useToast";
import { isSafeUrlForLink } from "@app/lib/launcherResourceAccess";
import { useTranslations } from "next-intl";
import { useCallback, type KeyboardEvent, type MouseEvent } from "react";

type LauncherResourceActionInput = {
    accessUrl?: string | null;
    accessCopyValue: string;
};

export function useLauncherResourceAction({
    accessUrl,
    accessCopyValue
}: LauncherResourceActionInput) {
    const { toast } = useToast();
    const t = useTranslations();

    const href = accessUrl ?? undefined;
    const canLink = Boolean(href && isSafeUrlForLink(href));
    const isClickable = canLink || Boolean(accessCopyValue);

    const handleAction = useCallback(() => {
        if (canLink && href) {
            window.open(href, "_blank", "noopener,noreferrer");
            return;
        }

        if (!accessCopyValue) {
            return;
        }

        void navigator.clipboard.writeText(accessCopyValue).then(() => {
            toast({
                title: t("resourceLauncherCopiedToClipboard"),
                description: t("resourceLauncherCopiedAccessDescription"),
                duration: 2000
            });
        });
    }, [accessCopyValue, canLink, href, t, toast]);

    return { handleAction, isClickable };
}

export function isLauncherResourceInteractiveTarget(
    target: EventTarget | null,
    container?: EventTarget | null
): boolean {
    if (!(target instanceof Element)) {
        return false;
    }

    const interactive = target.closest(
        "a, button, [role='button'], input, textarea, select"
    );

    if (!interactive) {
        return false;
    }

    if (container instanceof Element && interactive === container) {
        return false;
    }

    return true;
}

function handleLauncherResourceClick(
    event: MouseEvent,
    handleAction: () => void
) {
    if (
        isLauncherResourceInteractiveTarget(event.target, event.currentTarget)
    ) {
        return;
    }

    handleAction();
}

export function getLauncherResourceSelectProps(onSelect: () => void) {
    return {
        onClick: (event: MouseEvent) => {
            if (
                isLauncherResourceInteractiveTarget(
                    event.target,
                    event.currentTarget
                )
            ) {
                return;
            }

            onSelect();
        },
        className: "cursor-pointer",
        role: "button" as const,
        tabIndex: 0,
        onKeyDown: (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect();
            }
        }
    };
}

export function getLauncherResourceClickProps(
    handleAction: () => void,
    isClickable: boolean
) {
    return {
        onClick: (event: MouseEvent) =>
            handleLauncherResourceClick(event, handleAction),
        className: isClickable ? "cursor-pointer" : undefined,
        role: isClickable ? ("button" as const) : undefined,
        tabIndex: isClickable ? 0 : undefined,
        onKeyDown: isClickable
            ? (event: KeyboardEvent) => {
                  if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleAction();
                  }
              }
            : undefined
    };
}
