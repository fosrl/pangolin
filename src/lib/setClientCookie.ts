export function setClientCookie(
    name: string,
    value: string,
    options: {
        days?: number;
        path?: string;
        secure?: boolean;
        sameSite?: "Strict" | "Lax" | "None";
    } = {}
): void {
    let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

    if (options.days) {
        const date = new Date();
        date.setTime(date.getTime() + options.days * 864e5);
        cookie += `; expires=${date.toUTCString()}`;
    }

    cookie += `; path=${options.path ?? "/"}`;

    if (options.secure) cookie += "; Secure";
    if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;

    document.cookie = cookie;
}
