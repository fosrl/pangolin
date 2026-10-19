import fs from "fs";

// Resolves an environment variable, also honoring a `<envVar>_FILE` variant
// that points to a file whose (trimmed) contents should be used as the
// value. This is the common convention for consuming Docker/Swarm secrets
// (e.g. mounted at /run/secrets/...) without putting the raw value in the
// container's environment.
export const readEnvOrFile = (envVar: string): string | undefined => {
    const fileEnvVar = `${envVar}_FILE`;
    const filePath = process.env[fileEnvVar];

    if (filePath) {
        if (process.env[envVar]) {
            throw new Error(
                `Both ${envVar} and ${fileEnvVar} are set. Please set only one.`
            );
        }

        try {
            return fs.readFileSync(filePath, "utf8").trim();
        } catch (error) {
            throw new Error(
                `Failed to read ${fileEnvVar} (${filePath}): ${
                    error instanceof Error ? error.message : error
                }`
            );
        }
    }

    return process.env[envVar];
};

export const getEnvOrYaml =
    (envVar: string) =>
    (valFromYaml: string | undefined): string | undefined => {
        return readEnvOrFile(envVar) ?? valFromYaml;
    };
