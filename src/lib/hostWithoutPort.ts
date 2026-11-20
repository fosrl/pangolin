// A Host header can carry a port (e.g. "login.example.com:443"), while
// dashboard and login page domains are compared and stored without one.
export function hostWithoutPort(host: string | null | undefined): string {
    return (host ?? "").replace(/:\d{1,5}$/, "");
}
