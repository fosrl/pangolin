import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";

export function useNavigationContext() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const path = usePathname();
    const [isNavigating, startTransition] = useTransition();

    const navigate = useCallback(
        function ({
            searchParams: params,
            pathname = path,
            replace = false
        }: {
            pathname?: string;
            searchParams?: URLSearchParams;
            replace?: boolean;
        }) {
            startTransition(() => {
                const fullPath =
                    pathname + (params ? `?${params.toString()}` : "");

                if (replace) {
                    router.replace(fullPath);
                } else {
                    router.push(fullPath);
                }
            });
        },
        [router]
    );

    const writableSearchParams = useMemo(
        () => new URLSearchParams(searchParams),
        [searchParams]
    );

    return {
        pathname: path,
        searchParams: writableSearchParams,
        navigate,
        isNavigating
    };
}
