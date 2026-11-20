import { CommandModule } from "yargs";
import { db, idp, idpOidcConfig, idpTestLinks, licenseKey, certificates, eventStreamingDestinations, alertWebhookActions, aiProviders, virtualApiKeys, userIdpClaims } from "@server/db";
import { encrypt, decrypt } from "@server/lib/crypto";
import { configFilePath1, configFilePath2 } from "@server/lib/consts";
import { eq } from "drizzle-orm";
import fs from "fs";
import * as yaml from "js-yaml";

type RotateServerSecretArgs = {
    "old-secret": string;
    "new-secret": string;
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
            .option("old-secret", {
                type: "string",
                demandOption: true,
                describe: "The current server secret (for verification)"
            })
            .option("new-secret", {
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
        "old-secret": string;
        "new-secret": string;
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
            const oldSecret = argv["old-secret"];
            const newSecret = argv["new-secret"];
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
            const certs = await db.select().from(certificates);
            const streamingDestinations = await db.select().from(eventStreamingDestinations);
            const webhookActions = await db.select().from(alertWebhookActions);
            const providers = await db.select().from(aiProviders);
            const virtualKeys = await db.select().from(virtualApiKeys);
            const idpApiConfigs = await db
                .select({ idpId: idp.idpId, apiConfig: idp.apiConfig })
                .from(idp);
            const loginClaims = await db.select().from(userIdpClaims);
            const testLinks = await db.select().from(idpTestLinks);

            console.log(`Found ${idpConfigs.length} OIDC IdP configuration(s)`);
            console.log(`Found ${licenseKeys.length} license key(s)`);
            console.log(`Found ${certs.length} certificate(s)`);
            console.log(`Found ${streamingDestinations.length} event streaming destination(s)`);
            console.log(`Found ${webhookActions.length} alert webhook action(s)`);
            console.log(`Found ${providers.length} AI provider(s)`);
            console.log(`Found ${virtualKeys.length} virtual API key(s)`);
            console.log(`Found ${idpApiConfigs.filter((r) => r.apiConfig).length} IdP API configuration(s)`);
            console.log(`Found ${loginClaims.length} stored login claim snapshot(s)`);
            console.log(`Found ${testLinks.filter((l) => l.result).length} IdP test link result(s)`);

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

            type CertUpdate = {
                certId: number;
                encryptedCertFile: string | null;
                encryptedKeyFile: string | null;
            };

            type StreamingDestinationUpdate = {
                destinationId: number;
                encryptedConfig: string;
            };

            type WebhookActionUpdate = {
                webhookActionId: number;
                encryptedConfig: string;
            };

            type AiProviderUpdate = {
                providerId: number;
                encryptedApiKey: string | null;
                encryptedHeaders: string | null;
            };

            type VirtualApiKeyUpdate = {
                virtualApiKeyId: string;
                encryptedToken: string;
            };

            const idpUpdates: IdpUpdate[] = [];
            const licenseKeyUpdates: LicenseKeyUpdate[] = [];
            const certUpdates: CertUpdate[] = [];
            const streamingDestinationUpdates: StreamingDestinationUpdate[] = [];
            const webhookActionUpdates: WebhookActionUpdate[] = [];
            const aiProviderUpdates: AiProviderUpdate[] = [];
            const virtualApiKeyUpdates: VirtualApiKeyUpdate[] = [];
            const idpApiConfigUpdates: { idpId: number; encrypted: string }[] = [];
            const loginClaimsUpdates: { userId: string; encrypted: string }[] = [];
            const testLinkUpdates: { linkId: string; encrypted: string }[] = [];

            // Process idp.apiConfig (IdP API integration credentials)
            for (const row of idpApiConfigs) {
                if (!row.apiConfig) continue;
                try {
                    idpApiConfigUpdates.push({
                        idpId: row.idpId,
                        encrypted: encrypt(decrypt(row.apiConfig, oldSecret), newSecret)
                    });
                } catch (error) {
                    console.error(`Error processing API config of IdP ${row.idpId}:`, error);
                    throw error;
                }
            }

            // Process userIdpClaims (claims of each user's last login)
            for (const row of loginClaims) {
                try {
                    loginClaimsUpdates.push({
                        userId: row.userId,
                        encrypted: encrypt(decrypt(row.claims, oldSecret), newSecret)
                    });
                } catch (error) {
                    console.error(`Error processing login claims of user ${row.userId}:`, error);
                    throw error;
                }
            }

            // Process idpTestLinks results
            for (const link of testLinks) {
                if (!link.result) continue;
                try {
                    testLinkUpdates.push({
                        linkId: link.linkId,
                        encrypted: encrypt(decrypt(link.result, oldSecret), newSecret)
                    });
                } catch (error) {
                    console.error(`Error processing IdP test link ${link.linkId}:`, error);
                    throw error;
                }
            }

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

            // Process certificate entries
            for (const cert of certs) {
                try {
                    const encryptedCertFile = cert.certFile
                        ? encrypt(decrypt(cert.certFile, oldSecret), newSecret)
                        : null;
                    const encryptedKeyFile = cert.keyFile
                        ? encrypt(decrypt(cert.keyFile, oldSecret), newSecret)
                        : null;

                    certUpdates.push({
                        certId: cert.certId,
                        encryptedCertFile,
                        encryptedKeyFile
                    });
                } catch (error) {
                    console.error(
                        `Error processing certificate ${cert.certId} (${cert.domain}):`,
                        error
                    );
                    throw error;
                }
            }

            // Process eventStreamingDestinations entries
            for (const dest of streamingDestinations) {
                try {
                    const decryptedConfig = decrypt(dest.config, oldSecret);
                    const encryptedConfig = encrypt(decryptedConfig, newSecret);

                    streamingDestinationUpdates.push({
                        destinationId: dest.destinationId,
                        encryptedConfig
                    });
                } catch (error) {
                    console.error(
                        `Error processing event streaming destination ${dest.destinationId}:`,
                        error
                    );
                    throw error;
                }
            }

            // Process alertWebhookActions entries
            for (const webhook of webhookActions) {
                try {
                    if (webhook.config == null) continue;

                    const decryptedConfig = decrypt(webhook.config, oldSecret);
                    const encryptedConfig = encrypt(decryptedConfig, newSecret);

                    webhookActionUpdates.push({
                        webhookActionId: webhook.webhookActionId,
                        encryptedConfig
                    });
                } catch (error) {
                    console.error(
                        `Error processing alert webhook action ${webhook.webhookActionId}:`,
                        error
                    );
                    throw error;
                }
            }

            // Process aiProviders entries (apiKey + headers)
            for (const provider of providers) {
                try {
                    if (!provider.apiKey && !provider.headers) {
                        continue;
                    }

                    const encryptedApiKey = provider.apiKey
                        ? encrypt(decrypt(provider.apiKey, oldSecret), newSecret)
                        : null;
                    const encryptedHeaders = provider.headers
                        ? encrypt(
                              decrypt(provider.headers, oldSecret),
                              newSecret
                          )
                        : null;

                    aiProviderUpdates.push({
                        providerId: provider.providerId,
                        encryptedApiKey,
                        encryptedHeaders
                    });
                } catch (error) {
                    console.error(
                        `Error processing AI provider ${provider.providerId}:`,
                        error
                    );
                    throw error;
                }
            }

            // Process virtualApiKeys entries (token)
            for (const key of virtualKeys) {
                try {
                    if (!key.token) {
                        continue;
                    }

                    virtualApiKeyUpdates.push({
                        virtualApiKeyId: key.virtualApiKeyId,
                        encryptedToken: encrypt(
                            decrypt(key.token, oldSecret),
                            newSecret
                        )
                    });
                } catch (error) {
                    console.error(
                        `Error processing virtual API key ${key.virtualApiKeyId}:`,
                        error
                    );
                    throw error;
                }
            }

            // Perform all database updates in a single transaction
            console.log("\nUpdating database in transaction...");
            await db.transaction(async (trx) => {
                for (const update of idpApiConfigUpdates) {
                    await trx
                        .update(idp)
                        .set({ apiConfig: update.encrypted })
                        .where(eq(idp.idpId, update.idpId));
                }

                for (const update of loginClaimsUpdates) {
                    await trx
                        .update(userIdpClaims)
                        .set({ claims: update.encrypted })
                        .where(eq(userIdpClaims.userId, update.userId));
                }

                for (const update of testLinkUpdates) {
                    await trx
                        .update(idpTestLinks)
                        .set({ result: update.encrypted })
                        .where(eq(idpTestLinks.linkId, update.linkId));
                }

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

                // Update certificate entries
                for (const update of certUpdates) {
                    await trx
                        .update(certificates)
                        .set({
                            certFile: update.encryptedCertFile,
                            keyFile: update.encryptedKeyFile
                        })
                        .where(eq(certificates.certId, update.certId));
                }

                // Update event streaming destination entries
                for (const update of streamingDestinationUpdates) {
                    await trx
                        .update(eventStreamingDestinations)
                        .set({ config: update.encryptedConfig })
                        .where(
                            eq(
                                eventStreamingDestinations.destinationId,
                                update.destinationId
                            )
                        );
                }

                // Update alert webhook action entries
                for (const update of webhookActionUpdates) {
                    await trx
                        .update(alertWebhookActions)
                        .set({ config: update.encryptedConfig })
                        .where(
                            eq(
                                alertWebhookActions.webhookActionId,
                                update.webhookActionId
                            )
                        );
                }

                // Update AI provider entries
                for (const update of aiProviderUpdates) {
                    await trx
                        .update(aiProviders)
                        .set({
                            apiKey: update.encryptedApiKey,
                            headers: update.encryptedHeaders
                        })
                        .where(eq(aiProviders.providerId, update.providerId));
                }

                // Update virtual API key entries
                for (const update of virtualApiKeyUpdates) {
                    await trx
                        .update(virtualApiKeys)
                        .set({
                            token: update.encryptedToken
                        })
                        .where(
                            eq(
                                virtualApiKeys.virtualApiKeyId,
                                update.virtualApiKeyId
                            )
                        );
                }
            });

            console.log(`Rotated ${idpUpdates.length} OIDC IdP configuration(s)`);
            console.log(`Rotated ${licenseKeyUpdates.length} license key(s)`);
            console.log(`Rotated ${certUpdates.length} certificate(s)`);
            console.log(`Rotated ${streamingDestinationUpdates.length} event streaming destination(s)`);
            console.log(`Rotated ${webhookActionUpdates.length} alert webhook action(s)`);
            console.log(`Rotated ${aiProviderUpdates.length} AI provider(s)`);
            console.log(`Rotated ${virtualApiKeyUpdates.length} virtual API key(s)`);
            console.log(`Rotated ${idpApiConfigUpdates.length} IdP API configuration(s)`);
            console.log(`Rotated ${loginClaimsUpdates.length} stored login claim snapshot(s)`);
            console.log(`Rotated ${testLinkUpdates.length} IdP test link result(s)`);

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
            console.log(`  - IdP API configurations: ${idpApiConfigUpdates.length}`);
            console.log(`  - Login claim snapshots: ${loginClaimsUpdates.length}`);
            console.log(`  - IdP test link results: ${testLinkUpdates.length}`);
            console.log(`  - License keys: ${licenseKeyUpdates.length}`);
            console.log(`  - Certificates: ${certUpdates.length}`);
            console.log(`  - Event streaming destinations: ${streamingDestinationUpdates.length}`);
            console.log(`  - Alert webhook actions: ${webhookActionUpdates.length}`);
            console.log(`  - AI providers: ${aiProviderUpdates.length}`);
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

