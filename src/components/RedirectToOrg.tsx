"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getInternalRedirectTarget } from "@app/lib/internalRedirect";

type RedirectToOrgProps = {
    targetOrgId: string;
    isAdminOrOwner?: boolean;
};

export default function RedirectToOrg({
    targetOrgId,
    isAdminOrOwner = false
}: RedirectToOrgProps) {
    const router = useRouter();

    useEffect(() => {
        try {
            const target =
                getInternalRedirectTarget(targetOrgId) ??
                (isAdminOrOwner
                    ? `/${targetOrgId}/settings`
                    : `/${targetOrgId}`);
            router.replace(target);
        } catch {
            router.replace(
                isAdminOrOwner ? `/${targetOrgId}/settings` : `/${targetOrgId}`
            );
        }
    }, [targetOrgId, isAdminOrOwner, router]);

    return null;
}
