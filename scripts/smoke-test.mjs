const dashboard = process.env.DASHBOARD_URL ?? "http://localhost:3002";
const api = process.env.API_URL ?? "http://localhost:3000/api/v1";

async function check(name, url, expected) {
    const res = await fetch(url, { redirect: "manual" });
    const ok = res.status === expected;
    console.log(
        `${ok ? "PASS" : "FAIL"}: ${name} (got ${res.status}, want ${expected})`
    );
    return ok;
}

const results = [
    await check("login page loads", `${dashboard}/auth/login`, 200),
    await check("orgs list needs a login", `${api}/orgs`, 401)
];

if (results.includes(false)) process.exit(1);
console.log("Smoke test passed");
