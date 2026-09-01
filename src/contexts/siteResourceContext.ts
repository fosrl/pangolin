import type { SiteResourceData } from "@app/lib/privateResourceForm";
import { createContext } from "react";

export type SiteResourceAccessState = {
    roleIds: number[];
    userIds: string[];
    clientIds: number[];
};

export type SiteResourceContextValue = {
    siteResource: SiteResourceData;
    updateSiteResource: (updated: Partial<SiteResourceData>) => void;
    access: SiteResourceAccessState;
    setAccess: (access: SiteResourceAccessState) => void;
};

const SiteResourceContext = createContext<SiteResourceContextValue | null>(
    null
);

export default SiteResourceContext;
