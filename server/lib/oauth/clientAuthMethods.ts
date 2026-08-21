export const CLIENT_AUTH_METHODS = [
    "client_secret_jwt",
    "client_secret_basic",
    "client_secret_post"
] as const;

export type ClientAuthenticationMethod = (typeof CLIENT_AUTH_METHODS)[number];
