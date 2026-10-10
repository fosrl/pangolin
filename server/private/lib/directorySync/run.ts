// Usage: npx tsx server/private/lib/directorySync/run.ts <idpId> <mappings.json>
// mappings.json: [{ "groupId": "<entra group oid>", "orgId": "acme", "roleName": "Member" }]
import { readFileSync } from "fs";
import { GroupMapping, syncAzureDirectory } from "./azure";

const idpId = Number(process.argv[2]);
const mappingsPath = process.argv[3];
if (!idpId || !mappingsPath) {
    console.error("Usage: run.ts <idpId> <mappings.json>");
    process.exit(1);
}

const mappings: GroupMapping[] = JSON.parse(readFileSync(mappingsPath, "utf8"));

syncAzureDirectory(idpId, mappings)
    .then((report) => {
        console.log(JSON.stringify(report, null, 2));
        process.exit(0);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
