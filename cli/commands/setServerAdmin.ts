import { CommandModule } from "yargs";
import { db, users } from "@server/db";
import { eq } from "drizzle-orm";

type SetServerAdminArgs = {
    email: string;
    remove: boolean;
};

export const setServerAdmin: CommandModule<{}, SetServerAdminArgs> = {
    command: "set-server-admin",
    describe: "Add or remove server admin by email address",
    builder: (yargs) => {
        return yargs
            .option("email", {
                type: "string",
                demandOption: true,
                describe: "User email address"
            })
            .option("remove", {
                type: "boolean",
                default: false,
                describe: "Remove server admin status from the user"
            });
    },
    handler: async (argv: SetServerAdminArgs) => {
        try {
            const email = argv.email.trim().toLowerCase();

            const [user] = await db
                .select()
                .from(users)
                .where(eq(users.email, email))
                .limit(1);

            if (!user) {
                console.error(`User with email '${email}' not found`);
                process.exit(1);
            }

            if (argv.remove) {
                if (!user.serverAdmin) {
                    console.log(`User '${email}' is not a server admin`);
                    process.exit(0);
                }

                const serverAdmins = await db
                    .select()
                    .from(users)
                    .where(eq(users.serverAdmin, true));

                if (serverAdmins.length <= 1) {
                    console.error(
                        "Cannot remove server admin: at least one server admin must exist"
                    );
                    process.exit(1);
                }

                await db
                    .update(users)
                    .set({ serverAdmin: false })
                    .where(eq(users.userId, user.userId));

                console.log(`Server admin status removed from user '${email}'`);
                process.exit(0);
            }

            if (user.serverAdmin) {
                console.log(`User '${email}' is already a server admin`);
                process.exit(0);
            }

            await db
                .update(users)
                .set({ serverAdmin: true })
                .where(eq(users.userId, user.userId));

            console.log(`User '${email}' has been marked as a server admin`);
            process.exit(0);
        } catch (error) {
            console.error("Error:", error);
            process.exit(1);
        }
    }
};
