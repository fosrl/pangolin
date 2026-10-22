// // Usage: npx tsx server/private/lib/directorySync/run.ts <idpId>
// // Runs one directory sync for the IdP using its saved directory role mapping.
// import { AzureDirectorySyncProvider } from "./azure";
// must be imported first, before any module that calls `z.openapi()`
import "@server/extendZod";
import { runIdpDirectorySync } from "./syncWorkflow";

await runIdpDirectorySync().then((changes) => {
    console.dir(
        {
            changes
        },
        { depth: null }
    );
});
process.exit(0);

// const idpId = Number(process.argv[2]);
// if (!idpId) {
//     console.error("Usage: run.ts <idpId>");
//     process.exit(1);
// }

// const provider = new AzureDirectorySyncProvider();

// provider
//     .fetch({
//         idpId: idpId,
//         identifierPath: "email",
//         cursor: null
//     })
//     .then((report) => {
//         console.dir({ report }, { depth: null });
//         process.exit(0);
//     })
//     .catch((err) => {
//         console.error(err);
//         process.exit(1);
//     });

// runDirectorySync(idpId)
//     .then((report) => {
//         console.log(JSON.stringify(report, null, 2));
//         process.exit(0);
//     })
//     .catch((err) => {
//         console.error(err);
//         process.exit(1);
//     });
