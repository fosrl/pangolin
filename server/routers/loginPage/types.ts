import type { LoginPage, LoginPageBranding } from "@server/db";

export type CreateLoginPageResponse = LoginPage;

export type DeleteLoginPageResponse = LoginPage;

export type GetLoginPageResponse = LoginPage;

export type UpdateLoginPageResponse = LoginPage;

export type LoadLoginPageResponse = LoginPage & { orgId: string };

export type LoadLoginPageBrandingResponse = LoginPageBranding & {
    orgId: string;
    orgName: string;
};

export type GetLoginPageBrandingResponse = LoginPageBranding;
