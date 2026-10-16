export type DirectorySyncRoleMappingMode =
    "fixedRoles" | "groupMapping" | "automatic";

export type DirectoryGroupRoleRule = {
    /** Stable React list key; not persisted. */
    id?: string;
    /** Directory group name or ID to match. */
    group: string;
    roleNames: string[];
};

export type DirectorySyncRoleMappingConfig = {
    mode: DirectorySyncRoleMappingMode;
    /** `fixedRoles`: roles given to every synced user. */
    fixedRoleNames: string[];
    /** `groupMapping`: explicit directory group → roles rules. */
    groupRules: DirectoryGroupRoleRule[];
    /** `automatic`: create a role named after a group when none exists. */
    createMissingRoles: boolean;
};

const DIRECTORY_SYNC_ROLE_MAPPING_VERSION = 1;

const MODES: DirectorySyncRoleMappingMode[] = [
    "fixedRoles",
    "groupMapping",
    "automatic"
];

function newGroupRoleRuleId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `group-rule-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function createDirectoryGroupRoleRule(): DirectoryGroupRoleRule {
    return {
        id: newGroupRoleRuleId(),
        group: "",
        roleNames: []
    };
}

export function createDefaultDirectorySyncRoleMappingConfig(): DirectorySyncRoleMappingConfig {
    return {
        mode: "automatic",
        fixedRoleNames: [],
        groupRules: [createDirectoryGroupRoleRule()],
        createMissingRoles: false
    };
}

function toStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [];
}

/** Parse the stored `idpOrg.directoryRoleMapping` value. Invalid values fall back to defaults. */
export function parseDirectorySyncRoleMapping(
    stored: string | null | undefined
): DirectorySyncRoleMappingConfig {
    const defaults = createDefaultDirectorySyncRoleMappingConfig();
    if (!stored?.trim()) {
        return defaults;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(stored);
    } catch {
        return defaults;
    }
    if (!parsed || typeof parsed !== "object") {
        return defaults;
    }

    const raw = parsed as Record<string, unknown>;
    const mode = MODES.includes(raw.mode as DirectorySyncRoleMappingMode)
        ? (raw.mode as DirectorySyncRoleMappingMode)
        : defaults.mode;

    const groupRules = Array.isArray(raw.groupRules)
        ? raw.groupRules
              .filter(
                  (rule): rule is Record<string, unknown> =>
                      !!rule && typeof rule === "object"
              )
              .map((rule) => ({
                  id: newGroupRoleRuleId(),
                  group: typeof rule.group === "string" ? rule.group : "",
                  roleNames: toStringArray(rule.roleNames)
              }))
        : [];

    return {
        mode,
        fixedRoleNames: toStringArray(raw.fixedRoleNames),
        groupRules: groupRules.length ? groupRules : defaults.groupRules,
        createMissingRoles: raw.createMissingRoles === true
    };
}

/**
 * Serialize for `idpOrg.directoryRoleMapping`. Only the active mode's fields are kept.
 * Returns null when the active mode has nothing configured.
 */
export function serializeDirectorySyncRoleMapping(
    config: DirectorySyncRoleMappingConfig
): string | null {
    const base = {
        version: DIRECTORY_SYNC_ROLE_MAPPING_VERSION,
        mode: config.mode
    };

    switch (config.mode) {
        case "fixedRoles": {
            const fixedRoleNames = config.fixedRoleNames
                .map((name) => name.trim())
                .filter(Boolean);
            if (!fixedRoleNames.length) {
                return null;
            }
            return JSON.stringify({ ...base, fixedRoleNames });
        }
        case "groupMapping": {
            const groupRules = config.groupRules
                .map((rule) => ({
                    group: rule.group.trim(),
                    roleNames: rule.roleNames
                        .map((name) => name.trim())
                        .filter(Boolean)
                }))
                .filter((rule) => rule.group && rule.roleNames.length);
            if (!groupRules.length) {
                return null;
            }
            return JSON.stringify({ ...base, groupRules });
        }
        case "automatic":
            return JSON.stringify({
                ...base,
                createMissingRoles: config.createMissingRoles
            });
    }
}
