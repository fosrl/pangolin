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
};
