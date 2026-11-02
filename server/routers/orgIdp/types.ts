import { Idp, IdpOidcConfig } from "@server/db";
import type { RedactedDirectorySyncConfig } from "@app/lib/idpDirectorySyncConfig";

export type CreateOrgIdpResponse = {
    idpId: number;
    redirectUrl: string;
};

export type GetOrgIdpResponse = {
    idp: Omit<Idp, "directorySyncConfig"> & {
        directorySyncConfig: RedactedDirectorySyncConfig | null;
    };
    idpOidcConfig: IdpOidcConfig | null;
    redirectUrl: string;
};

export type ListOrgIdpsResponse = {
    idps: {
        idpId: number;
        orgId: string;
        name: string;
        type: string;
        variant: string;
    }[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
};

export type ListUserAdminOrgIdpsEntry = {
    idpId: number;
    orgId: string;
    orgName: string;
    name: string;
    type: string;
    variant: string;
    tags: string | null;
};

export type ListUserAdminOrgIdpsResponse = {
    idps: ListUserAdminOrgIdpsEntry[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
};
