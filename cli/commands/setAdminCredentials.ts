import { CommandModule } from "yargs";
import { hashPassword, verifyPassword } from "@server/auth/password";
import { db, resourceSessions, sessions } from "@server/db";
import { users } from "@server/db";
import { eq, inArray } from "drizzle-orm";
import moment from "moment";
import { fromError } from "zod-validation-error";
import { passwordSchema } from "@server/auth/passwordSchema";
import { UserType } from "@server/types/UserTypes";
import { generateRandomString, RandomReader } from "@oslojs/crypto/random";

type SetAdminCredentialsArgs = {
    email: string;
    password: string;
};

export const setAdminCredentials: CommandModule<{}, SetAdminCredentialsArgs> = {
    command: "set-admin-credentials",
    describe: "Set the server admin credentials",
    builder: (yargs) => {
        return yargs
            .option("email", {
                type: "string",
                demandOption: true,
                describe: "Admin email address"
            })
            .option("password", {
                type: "string",
                demandOption: true,
                describe: "Admin password"
            });
    },
    handler: async (argv: { email: string; password: string }) => {
        try {
            const { password } = argv;
            let { email } = argv;
            email = email.trim().toLowerCase();

            const parsed = passwordSchema.safeParse(password);

            if (!parsed.success) {
                throw Error(
                    `Invalid server admin password: ${fromError(parsed.error).toString()}`
                );
            }

            const passwordHash = await hashPassword(password);

            await db.transaction(async (trx) => {
                try {
                    const [existing] = await trx
                        .select()
                        .from(users)
                        .where(eq(users.serverAdmin, true));

                    if (existing) {
                        const passwordChanged = !(await verifyPassword(
                            password,
                            existing.passwordHash!
                        ));

                        if (passwordChanged) {
                            await trx
                                .update(users)
                                .set({ passwordHash })
                                .where(eq(users.userId, existing.userId));

                            await invalidateAllSessions(existing.userId);
                            console.log("Server admin password updated");
                        }

                        if (existing.email !== email) {
                            await trx
                                .update(users)
                                .set({ email, username: email })
                                .where(eq(users.userId, existing.userId));

                            console.log("Server admin email updated");
                        }
                    } else {
                        const userId = generateId(15);

                        await trx.update(users).set({ serverAdmin: false });

                        await db.insert(users).values({
                            userId: userId,
                            email: email,
                            type: UserType.Internal,
                            username: email,
                            passwordHash,
                            dateCreated: moment().toISOString(),
                            serverAdmin: true,
                            emailVerified: true,
                            lastPasswordChange: new Date().getTime()
                        });

                        console.log("Server admin created");
                    }
                } catch (e) {
                    console.error("Failed to set admin credentials", e);
                    trx.rollback();
                    throw e;
                }
            });

            console.log("Admin credentials updated successfully");
            process.exit(0);
        } catch (error) {
            console.error("Error:", error);
            process.exit(1);
        }
    }
};

export async function invalidateAllSessions(userId: string): Promise<void> {
    try {
        await db.transaction(async (trx) => {
            const userSessions = await trx
                .select()
                .from(sessions)
                .where(eq(sessions.userId, userId));
            await trx.delete(resourceSessions).where(
                inArray(
                    resourceSessions.userSessionId,
                    userSessions.map((s) => s.sessionId)
                )
            );
            await trx.delete(sessions).where(eq(sessions.userId, userId));
        });
    } catch (e) {
        console.log("Failed to all invalidate user sessions", e);
    }
}

const random: RandomReader = {
    read(bytes: Uint8Array): void {
        crypto.getRandomValues(bytes);
    }
};

export function generateId(length: number): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    return generateRandomString(random, alphabet, length);
}
