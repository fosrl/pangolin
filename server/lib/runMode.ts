// Which entry point is running. Standalone entry points set this before
// anything loads the config, so the config schema can skip requirements
// that only apply to the full Pangolin server.
export type RunMode = "server" | "dns";

let runMode: RunMode = "server";

export function setRunMode(mode: RunMode) {
    runMode = mode;
}

export function getRunMode(): RunMode {
    return runMode;
}
