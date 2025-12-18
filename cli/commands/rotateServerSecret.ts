import { CommandModule } from "yargs";
import { db, idpOidcConfig, licenseKey } from "@server/db";
import { encrypt, decrypt } from "@server/lib/crypto";
import { configFilePath1, configFilePath2 } from "@server/lib/consts";
import { eq } from "drizzle-orm";
import fs from "fs";
import yaml from "js-yaml";

type RotateServerSecretArgs = {
    oldSecret: string;
    newSecret: string;
    force?: boolean;
};

export const rotateServerSecret: CommandModule<
    {},
    RotateServerSecretArgs
> = {
    command: "rotate-server-secret",
    describe:
        "Rotate the server secret by decrypting all encrypted values with the old secret and re-encrypting with a new secret",
    builder: (yargs) => {
        return yargs
            .option("oldSecret", {
                type: "string",
                demandOption: true,
                describe: "The current server secret (for verification)"
            })
            .option("newSecret", {
                type: "string",
                demandOption: true,
                describe: "The new server secret to use"
            })
            .option("force", {
                type: "boolean",
                default: false,
                describe:
                    "Force rotation even if the old secret doesn't match the config file. " +
                    "Use this if you know the old secret is correct but the config file is out of sync. " +
                    "WARNING: This will attempt to decrypt all values with the provided old secret. " +
                    "If the old secret is incorrect, the rotation will fail or corrupt data."
            });
    },
    handler: async (argv: {
        oldSecret: string;
        newSecret: string;
        force?: boolean;
    }) => {
        try {
            // Determine which config file exists
            const configPath = fs.existsSync(configFilePath1)
                ? configFilePath1
                : fs.existsSync(configFilePath2)
                  ? configFilePath2
                  : null;

            if (!configPath) {
                console.error(
                    "Error: Config file not found. Expected config.yml or config.yaml in the config directory."
                );
                process.exit(1);
            }

            // Read current config
            const configContent = fs.readFileSync(configPath, "utf8");
            const config = yaml.load(configContent) as any;

            if (!config?.server?.secret) {
                console.error(
                    "Error: No server secret found in config file. Cannot rotate."
                );
                process.exit(1);
            }

            const configSecret = config.server.secret;
            const oldSecret = argv.oldSecret;
            const newSecret = argv.newSecret;
            const force = argv.force || false;

            // Verify that the provided old secret matches the one in config
            if (configSecret !== oldSecret) {
                if (!force) {
                    console.error(
                        "Error: The provided old secret does not match the secret in the config file."
                    );
                    console.error(
                        "\nIf you are certain the old secret is correct and the config file is out of sync,"
                    );
                    console.error(
                        "you can use the --force flag to bypass this check."
                    );
                    console.error(
                        "\nWARNING: Using --force with an incorrect old secret will cause the rotation to fail"
                    );
                    console.error(
                        "or corrupt encrypted data. Only use --force if you are absolutely certain."
                    );
                    process.exit(1);
                } else {
                    console.warn(
                        "\nWARNING: Using --force flag. Bypassing old secret verification."
                    );
                    console.warn(
                        "The provided old secret does not match the config file, but proceeding anyway."
                    );
                    console.warn(
                        "If the old secret is incorrect, this operation will fail or corrupt data.\n"
                    );
                }
            }

            // Validate new secret
            if (newSecret.length < 8) {
                console.error(
                    "Error: New secret must be at least 8 characters long"
                );
                process.exit(1);
            }

            if (oldSecret === newSecret) {
                console.error("Error: New secret must be different from old secret");
                process.exit(1);
            }

            console.log("Starting server secret rotation...");
            console.log("This will decrypt and re-encrypt all encrypted values in the database.");

            // Read all data first
            console.log("\nReading encrypted data from database...");
            const idpConfigs = await db.select().from(idpOidcConfig);
            const licenseKeys = await db.select().from(licenseKey);

            console.log(`Found ${idpConfigs.length} OIDC IdP configuration(s)`);
            console.log(`Found ${licenseKeys.length} license key(s)`);

            // Prepare all decrypted and re-encrypted values
            console.log("\nDecrypting and re-encrypting values...");

            type IdpUpdate = {
                idpOauthConfigId: number;
                encryptedClientId: string;
                encryptedClientSecret: string;
            };

            type LicenseKeyUpdate = {
                oldLicenseKeyId: string;
                newLicenseKeyId: string;
                encryptedToken: string;
                encryptedInstanceId: string;
            };

            const idpUpdates: IdpUpdate[] = [];
            const licenseKeyUpdates: LicenseKeyUpdate[] = [];

            // Process idpOidcConfig entries
            for (const idpConfig of idpConfigs) {
                try {
                    // Decrypt with old secret
                    const decryptedClientId = decrypt(idpConfig.clientId, oldSecret);
                    const decryptedClientSecret = decrypt(
                        idpConfig.clientSecret,
                        oldSecret
                    );

                    // Re-encrypt with new secret
                    const encryptedClientId = encrypt(decryptedClientId, newSecret);
                    const encryptedClientSecret = encrypt(
                        decryptedClientSecret,
                        newSecret
                    );

                    idpUpdates.push({
                        idpOauthConfigId: idpConfig.idpOauthConfigId,
                        encryptedClientId,
                        encryptedClientSecret
                    });
                } catch (error) {
                    console.error(
                        `Error processing IdP config ${idpConfig.idpOauthConfigId}:`,
                        error
                    );
                    throw error;
                }
            }

            // Process licenseKey entries
            for (const key of licenseKeys) {
                try {
                    // Decrypt with old secret
                    const decryptedLicenseKeyId = decrypt(key.licenseKeyId, oldSecret);
                    const decryptedToken = decrypt(key.token, oldSecret);
                    const decryptedInstanceId = decrypt(key.instanceId, oldSecret);

                    // Re-encrypt with new secret
                    const encryptedLicenseKeyId = encrypt(
                        decryptedLicenseKeyId,
                        newSecret
                    );
                    const encryptedToken = encrypt(decryptedToken, newSecret);
                    const encryptedInstanceId = encrypt(
                        decryptedInstanceId,
                        newSecret
                    );

                    licenseKeyUpdates.push({
                        oldLicenseKeyId: key.licenseKeyId,
                        newLicenseKeyId: encryptedLicenseKeyId,
                        encryptedToken,
                        encryptedInstanceId
                    });
                } catch (error) {
                    console.error(
                        `Error processing license key ${key.licenseKeyId}:`,
                        error
                    );
                    throw error;
                }
            }

            // Perform all database updates in a single transaction
            console.log("\nUpdating database in transaction...");
            await db.transaction(async (trx) => {
                // Update idpOidcConfig entries
                for (const update of idpUpdates) {
                    await trx
                        .update(idpOidcConfig)
                        .set({
                            clientId: update.encryptedClientId,
                            clientSecret: update.encryptedClientSecret
                        })
                        .where(
                            eq(
                                idpOidcConfig.idpOauthConfigId,
                                update.idpOauthConfigId
                            )
                        );
                }

                // Update licenseKey entries (delete old, insert new)
                for (const update of licenseKeyUpdates) {
                    // Delete old entry
                    await trx
                        .delete(licenseKey)
                        .where(eq(licenseKey.licenseKeyId, update.oldLicenseKeyId));

                    // Insert new entry with re-encrypted values
                    await trx.insert(licenseKey).values({
                        licenseKeyId: update.newLicenseKeyId,
                        token: update.encryptedToken,
                        instanceId: update.encryptedInstanceId
                    });
                }
            });

            console.log(`Rotated ${idpUpdates.length} OIDC IdP configuration(s)`);
            console.log(`Rotated ${licenseKeyUpdates.length} license key(s)`);

            // Update config file with new secret
            console.log("\nUpdating config file...");
            config.server.secret = newSecret;
            const newConfigContent = yaml.dump(config, {
                indent: 2,
                lineWidth: -1
            });
            fs.writeFileSync(configPath, newConfigContent, "utf8");

            console.log(`Updated config file: ${configPath}`);

            console.log("\nServer secret rotation completed successfully!");
            console.log(`\nSummary:`);
            console.log(`  - OIDC IdP configurations: ${idpUpdates.length}`);
            console.log(`  - License keys: ${licenseKeyUpdates.length}`);
            console.log(
                `\n  IMPORTANT: Restart the server for the new secret to take effect.`
            );

            process.exit(0);
        } catch (error) {
            console.error("Error rotating server secret:", error);
            process.exit(1);
        }
    }
};

