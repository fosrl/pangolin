import type {
    DirectoryFetchContext,
    DirectoryFetchResult,
    DirectorySyncProvider,
    DirectoryUser
} from "./types";
import { ensureValidIdp } from "./ensureValidIdp";

export class AzureDirectorySyncProvider implements DirectorySyncProvider {
    async fetch(ctx: DirectoryFetchContext): Promise<DirectoryFetchResult> {
        const directoryUsers: Record<string, DirectoryUser> = {};
        // 0. fetch idp and check that it is valid
        const idpRes = await ensureValidIdp(ctx.idpId, "google");
        throw new Error("Method not implemented.");
    }
}
