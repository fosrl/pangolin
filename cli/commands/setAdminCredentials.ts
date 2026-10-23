import { CommandModule } from "yargs";
import { hashPassword, verifyPassword } from "@server/auth/password";
import { db, resourceSessions, sessions } from "@server/db";
import { Transaction, users } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import moment from "moment";
import { fromError } from "zod-validation-error";
import { passwordSchema } from "@server/auth/passwordSchema";
import { UserType } from "@server/types/UserTypes";
import { generateRandomString, RandomReader } from "@oslojs/crypto/random";

type SetAdminCredentialsArgs = {
    email: string;
    password: string;
};

export type SetServerAdminCredentialsResult = {
    userId: string;
    created: boolean;
    passwordChanged: boolean;
    emailChanged: boolean;
    demotedAdminIds: string[];
};

/**
 * Gives the server admin credentials to a single account.
 *
 * The account that already uses the email address is used so that no second
 * account with the same email address is created. If no account uses the email
 * address yet the current server admin is updated, that way the admin is
 * never duplicated. Every other server admin is demoted because there is only
 * one server admin.
 */
export async function setServerAdminCredentials(
    email: string,
    password: string,
    trx: Transaction | typeof db = db
): Promise<SetServerAdminCredentialsResult> {
    email = email.trim().toLowerCase();

    const passwordHash = await hashPassword(password);

    const existingAdmins = await trx
        .select()
        .from(users)
        .where(eq(users.serverAdmin, true));

    // Reuse the account that already uses the email address. Creating a
    // second account with the same email address leaves two accounts that can
    // not be told apart and the duplicate can not be removed.
    const [existingWithEmail] = await trx
        .select()
        .from(users)
        .where(
            and(eq(users.email, email), eq(users.type, UserType.Internal))
        )
        .limit(1);

    // The account that gets the new credentials. If no account uses the email
    // address yet the current server admin is updated so that the admin is
    // not duplicated.
    const admin = existingWithEmail ?? existingAdmins[0];

    if (!admin) {
        const userId = generateId(15);

        await trx.insert(users).values({
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

        return {
            userId,
            created: true,
            passwordChanged: true,
            emailChanged: true,
            demotedAdminIds: []
        };
    }

    const passwordChanged = admin.passwordHash
        ? !(await verifyPassword(password, admin.passwordHash))
        : true;

    if (passwordChanged) {
        await trx
            .update(users)
            .set({
                passwordHash,
                lastPasswordChange: new Date().getTime()
            })
            .where(eq(users.userId, admin.userId));
    }

    const emailChanged = admin.email !== email || admin.username !== email;

    if (emailChanged) {
        await trx
            .update(users)
            .set({ email, username: email })
            .where(eq(users.userId, admin.userId));
    }

    // the account that gets the credentials is the server admin
    if (!admin.serverAdmin) {
        await trx
            .update(users)
            .set({ serverAdmin: true })
            .where(eq(users.userId, admin.userId));
    }

    // there is only one server admin, demote the others
    const demotedAdminIds = existingAdmins
        .filter((existingAdmin) => existingAdmin.userId !== admin.userId)
        .map((existingAdmin) => existingAdmin.userId);

    if (demotedAdminIds.length > 0) {
        await trx
            .update(users)
            .set({ serverAdmin: false })
            .where(inArray(users.userId, demotedAdminIds));
    }

    return {
        userId: admin.userId,
        created: false,
        passwordChanged,
        emailChanged,
        demotedAdminIds
    };
}

export const setAdminCredentials: CommandModule<{}, SetAdminCredentialsArgs> = {
    command: "set-admin-credentials",
    describe:
        "Set the credentials of the server admin, any other server admin is demoted",
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

            const result = await db.transaction(async (trx) => {
                return await setServerAdminCredentials(email, password, trx);
            });

            if (result.created) {
                console.log("Server admin created");
            }

            if (result.passwordChanged && !result.created) {
                console.log("Server admin password updated");
            }

            if (result.emailChanged && !result.created) {
                console.log("Server admin email updated");
            }

            if (result.demotedAdminIds.length > 0) {
                console.log(
                    "Removed the server admin status from the other admins"
                );
            }

            if (result.passwordChanged) {
                await invalidateAllSessions(result.userId);
            }

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
