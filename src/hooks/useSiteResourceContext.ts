import SiteResourceContext from "@app/contexts/siteResourceContext";
import { useContext } from "react";

export function useSiteResourceContext() {
    const context = useContext(SiteResourceContext);
    if (!context) {
        throw new Error(
            "useSiteResourceContext must be used within SiteResourceProvider"
        );
    }
    return context;
}
