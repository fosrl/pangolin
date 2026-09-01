import { ensureActions } from "./ensureActions";
import { copyInConfig } from "./copyInConfig";
import { clearStaleData } from "./clearStaleData";
import { ensureSetupToken } from "./ensureSetupToken";
import { ensureRootApiKey } from "./ensureRootApiKey";
import { ensureSigningKey } from "@server/lib/oauth/keys";

export async function runSetupFunctions() {
    await copyInConfig(); // copy in the config to the db as needed
    await ensureActions(); // make sure all of the actions are in the db and the roles
    await clearStaleData();
    await ensureSetupToken(); // ensure setup token exists for initial setup
    await ensureRootApiKey();
    await ensureSigningKey();
}
