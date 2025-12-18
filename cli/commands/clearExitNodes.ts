import { CommandModule } from "yargs";
import { db, exitNodes } from "@server/db";
import { eq } from "drizzle-orm";

type ClearExitNodesArgs = { };

export const clearExitNodes: CommandModule<
    {},
    ClearExitNodesArgs
> = {
    command: "clear-exit-nodes",
    describe:
        "Clear all exit nodes from the database",
    // no args
    builder: (yargs) => {
        return yargs;
    },
    handler: async (argv: {}) => {
        try {

            console.log(`Clearing all exit nodes from the database`);

            // Delete all exit nodes
            const deletedCount = await db
                .delete(exitNodes)
                .where(eq(exitNodes.exitNodeId, exitNodes.exitNodeId)); // delete all

            console.log(`Deleted ${deletedCount.changes} exit node(s) from the database`);

            process.exit(0);
        } catch (error) {
            console.error("Error:", error);
            process.exit(1);
        }
    }
};
