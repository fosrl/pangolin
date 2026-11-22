export type GetBrowserTargetResponse = {
    ip: string;
    port: number;
    authToken: string;
    orgId: string;
    resourceId: number;
    niceId: string;
    name: string;
    pamMode: "passthrough" | "push" | null;
    authDaemonMode: "site" | "remote" | "native" | null;
    // Entra OIDC identity providers of the org, offered for RDP sign-in
    entraIdps: { idpId: number; name: string }[];
    rdpEntraDeviceId: string | null;
    // Sign-in methods offered on the RDP page; null offers both
    rdpSignInMethods: "both" | "entra" | "password" | null;
};
