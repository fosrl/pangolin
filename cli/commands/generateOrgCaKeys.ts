import { CommandModule } from "yargs";
import { db, orgs } from "@server/db";
import { eq } from "drizzle-orm";
import { encrypt } from "@server/lib/crypto";
import { configFilePath1, configFilePath2 } from "@server/lib/consts";
import { generateCA } from "@server/lib/sshCA";
import fs from "fs";
import * as yaml from "js-yaml";

type GenerateOrgCaKeysArgs = {
    orgId: string;
    secret?: string;
    force?: boolean;
};

export const generateOrgCaKeys: CommandModule<{}, GenerateOrgCaKeysArgs> = {
    command: "generate-org-ca-keys",
    describe:
        "Generate SSH CA public/private key pair for an organization and store them in the database (private key encrypted with server secret)",
    builder: (yargs) => {
        return yargs
            .option("orgId", {
                type: "string",
                demandOption: true,
                describe: "The organization ID"
            })
            .option("secret", {
                type: "string",
                describe:
                    "Server secret used to encrypt the CA private key. If omitted, read from config file (config.yml or config.yaml)."
            })
            .option("force", {
                type: "boolean",
                default: false,
                describe:
                    "Overwrite existing CA keys for the org if they already exist"
            });
    },
    handler: async (argv: {
        orgId: string;
        secret?: string;
        force?: boolean;
    }) => {
        try {
            const { orgId, force } = argv;
            let secret = argv.secret;

            if (!secret) {
                const configPath = fs.existsSync(configFilePath1)
                    ? configFilePath1
                    : fs.existsSync(configFilePath2)
                      ? configFilePath2
                      : null;

                if (!configPath) {
                    console.error(
                        "Error: No server secret provided and config file not found. " +
                            "Expected config.yml or config.yaml in the config directory, or pass --secret."
                    );
                    process.exit(1);
                }

                const configContent = fs.readFileSync(configPath, "utf8");
                const config = yaml.load(configContent) as {
                    server?: { secret?: string };
                };

                if (!config?.server?.secret) {
                    console.error(
                        "Error: No server.secret in config file. Pass --secret or set server.secret in config."
                    );
                    process.exit(1);
                }
                secret = config.server.secret;
            }

            const [org] = await db
                .select({
                    orgId: orgs.orgId,
                    sshCaPrivateKey: orgs.sshCaPrivateKey,
                    sshCaPublicKey: orgs.sshCaPublicKey
                })
                .from(orgs)
                .where(eq(orgs.orgId, orgId))
                .limit(1);

            if (!org) {
                console.error(`Error: Organization with orgId "${orgId}" not found.`);
                process.exit(1);
            }

            if (org.sshCaPrivateKey != null || org.sshCaPublicKey != null) {
                if (!force) {
                    console.error(
                        "Error: This organization already has CA keys. Use --force to overwrite."
                    );
                    process.exit(1);
                }
            }

            const ca = generateCA(`pangolin-ssh-ca-${orgId}`);
            const encryptedPrivateKey = encrypt(ca.privateKeyPem, secret);

            await db
                .update(orgs)
                .set({
                    sshCaPrivateKey: encryptedPrivateKey,
                    sshCaPublicKey: ca.publicKeyOpenSSH
                })
                .where(eq(orgs.orgId, orgId));

            console.log("SSH CA keys generated and stored for org:", orgId);
            console.log("\nPublic key (OpenSSH format):");
            console.log(ca.publicKeyOpenSSH);
            process.exit(0);
        } catch (error) {
            console.error("Error generating org CA keys:", error);
            process.exit(1);
        }
    }
};
