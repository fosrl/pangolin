import path from "path";
import { fileURLToPath } from "url";

// This is a placeholder value replaced by the build process
export const APP_VERSION = "1.12.1";

export const __FILENAME = fileURLToPath(import.meta.url);
export const __DIRNAME = path.dirname(__FILENAME);

export const APP_PATH = path.join("config");

export const configFilePath1 = path.join(APP_PATH, "config.yml");
export const configFilePath2 = path.join(APP_PATH, "config.yaml");

export const privateConfigFilePath1 = path.join(APP_PATH, "privateConfig.yml");
