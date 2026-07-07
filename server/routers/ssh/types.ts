export type SignSshKeyResponse = {
    certificate?: string;
    messageIds: number[];
    messageId?: number;
    sshUsername: string;
    sshHost: string;
    resourceId: number;
    siteIds: number[];
    siteId: number;
    keyId?: string;
    validPrincipals?: string[];
    validAfter?: string;
    validBefore?: string;
    expiresIn?: number;
    authDaemonMode: "site" | "remote" | "native" | null;
};
