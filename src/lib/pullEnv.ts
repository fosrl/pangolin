import { build } from "@server/build";
import { Env } from "./types/env";

export function pullEnv(): Env {
    return {
        server: {
            nextPort: process.env.NEXT_PORT as string,
            externalPort: process.env.SERVER_EXTERNAL_PORT as string,
            sessionCookieName: process.env.SESSION_COOKIE_NAME as string,
            resourceAccessTokenParam: process.env
                .RESOURCE_ACCESS_TOKEN_PARAM as string,
            resourceSessionRequestParam: process.env
                .RESOURCE_SESSION_REQUEST_PARAM as string,
            resourceAccessTokenHeadersId: process.env
                .RESOURCE_ACCESS_TOKEN_HEADERS_ID as string,
            resourceAccessTokenHeadersToken: process.env
                .RESOURCE_ACCESS_TOKEN_HEADERS_TOKEN as string,
            reoClientId: process.env.REO_CLIENT_ID as string,
            maxmind_db_path: process.env.MAXMIND_DB_PATH as string,
            maxmind_asn_path: process.env.MAXMIND_ASN_PATH as string
        },
        app: {
            environment: process.env.ENVIRONMENT as string,
            sandbox_mode: process.env.SANDBOX_MODE === "true" ? true : false,
            version: process.env.APP_VERSION as string,
            dashboardUrl: process.env.DASHBOARD_URL as string,
            notifications: {
                product_updates:
                    process.env.PRODUCT_UPDATES_NOTIFICATION_ENABLED === "true"
                        ? true
                        : false,
                new_releases:
                    process.env.NEW_RELEASES_NOTIFICATION_ENABLED === "true"
                        ? true
                        : false
            },
            identityProviderMode: process.env.IDENTITY_PROVIDER_MODE as
                "org" | "global" | undefined
        },
        email: {
            emailEnabled: process.env.EMAIL_ENABLED === "true" ? true : false
        },
        flags: {
            disableUserCreateOrg:
                process.env.DISABLE_USER_CREATE_ORG === "true" ? true : false,
            disableSignupWithoutInvite:
                process.env.DISABLE_SIGNUP_WITHOUT_INVITE === "true"
                    ? true
                    : false,
            emailVerificationRequired:
                process.env.FLAGS_EMAIL_VERIFICATION_REQUIRED === "true"
                    ? true
                    : false,
            allowRawResources:
                process.env.FLAGS_ALLOW_RAW_RESOURCES === "true" ? true : false,
            disableLocalSites:
                process.env.FLAGS_DISABLE_LOCAL_SITES === "true" ? true : false,
            disableBasicWireguardSites:
                process.env.FLAGS_DISABLE_BASIC_WIREGUARD_SITES === "true"
                    ? true
                    : false,
            hideSupporterKey:
                process.env.HIDE_SUPPORTER_KEY === "true" ? true : false,
            usePangolinDns:
                process.env.USE_PANGOLIN_DNS === "true" ? true : false,
            disableProductHelpBanners:
                process.env.FLAGS_DISABLE_PRODUCT_HELP_BANNERS === "true"
                    ? true
                    : false,
            disableEnterpriseFeatures:
                process.env.DISABLE_ENTERPRISE_FEATURES === "true"
                    ? true
                    : false,
            disableVirtualApiKeysUi:
                process.env.FLAGS_DISABLE_VIRTUAL_API_KEYS_UI === "true"
                    ? true
                    : false
        },

        branding: {
            appName: process.env.BRANDING_APP_NAME as string,
            background_image_path: process.env.BACKGROUND_IMAGE_PATH as string,
            hideAuthLayoutFooter:
                process.env.BRANDING_HIDE_AUTH_LAYOUT_FOOTER === "true"
                    ? true
                    : false,
            hidePoweredBy:
                process.env.BRANDING_HIDE_POWERED_BY === "true" ? true : false,
            logo: {
                lightPath: process.env.BRANDING_LOGO_LIGHT_PATH as string,
                darkPath: process.env.BRANDING_LOGO_DARK_PATH as string,
                authPage: {
                    width: parseInt(
                        process.env.BRANDING_LOGO_AUTH_WIDTH as string
                    ),
                    height: parseInt(
                        process.env.BRANDING_LOGO_AUTH_HEIGHT as string
                    )
                },
                navbar: {
                    width: parseInt(
                        process.env.BRANDING_LOGO_NAVBAR_WIDTH as string
                    ),
                    height: parseInt(
                        process.env.BRANDING_LOGO_NAVBAR_HEIGHT as string
                    )
                }
            },
            loginPage: {
                subtitleText: process.env.LOGIN_PAGE_SUBTITLE_TEXT as string
            },
            signupPage: {
                subtitleText: process.env.SIGNUP_PAGE_SUBTITLE_TEXT as string
            },
            resourceAuthPage: {
                showLogo:
                    process.env.RESOURCE_AUTH_PAGE_SHOW_LOGO === "true"
                        ? true
                        : false,
                hidePoweredBy:
                    process.env.RESOURCE_AUTH_PAGE_HIDE_POWERED_BY === "true"
                        ? true
                        : false,
                titleText: process.env.RESOURCE_AUTH_PAGE_TITLE_TEXT as string,
                subtitleText: process.env
                    .RESOURCE_AUTH_PAGE_SUBTITLE_TEXT as string
            },
            footer: process.env.BRANDING_FOOTER as string
        }
    };
}
