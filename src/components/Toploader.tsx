"use client";
import * as React from "react";
import * as NProgress from "nprogress";
import NextTopLoader from "nextjs-toploader";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function TopLoader() {
    return (
        <>
            <NextTopLoader showSpinner={false} color="var(--color-primary)" />
            <FinishingLoader />
        </>
    );
}

function FinishingLoader() {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    React.useEffect(() => {
        NProgress.done();
    }, [pathname, router, searchParams]);
    React.useEffect(() => {
        const linkClickListener = (ev: MouseEvent) => {
            const element = ev.target as HTMLElement;
            const closestlink = element.closest("a");
            const isOpenToNewTabClick =
                ev.ctrlKey ||
                ev.shiftKey ||
                ev.metaKey || // apple
                (ev.button && ev.button == 1); // middle click, >IE9 + everyone else

            if (closestlink && isOpenToNewTabClick) {
                NProgress.done();
            }
        };
        window.addEventListener("click", linkClickListener);
        return () => window.removeEventListener("click", linkClickListener);
    }, []);
    return null;
}
