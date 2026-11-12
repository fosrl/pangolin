export type RoleMappingMode = "fixedRoles" | "mappingBuilder" | "rawExpression";

export type MappingBuilderRule = {
    /** Stable React list key; not used when compiling JMESPath. */
    id?: string;
    matchValue: string;
    roleNames: string[];
};

function newMappingBuilderRuleId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function createMappingBuilderRule(): MappingBuilderRule {
    return {
        id: newMappingBuilderRuleId(),
        matchValue: "",
        roleNames: []
    };
}

/** Ensures every rule has a stable id (e.g. after loading from the API). */
export function ensureMappingBuilderRuleIds(
    rules: MappingBuilderRule[]
): MappingBuilderRule[] {
    return rules.map((rule) =>
        rule.id ? rule : { ...rule, id: newMappingBuilderRuleId() }
    );
}

export type MappingBuilderConfig = {
    claimPath: string;
    rules: MappingBuilderRule[];
};

export type RoleMappingConfig = {
    mode: RoleMappingMode;
    fixedRoleNames: string[];
    mappingBuilder: MappingBuilderConfig;
    rawExpression: string;
};

const SINGLE_QUOTED_ROLE_REGEX = /^'([^']+)'$/;
const QUOTED_ROLE_ARRAY_REGEX = /^\[(.*)\]$/;

/** Stored role mappings created by the mapping builder are prefixed so the UI can restore the builder. */
export const PANGOLIN_ROLE_MAP_BUILDER_PREFIX = "__PANGOLIN_ROLE_MAP_BUILDER_V1__";

const BUILDER_METADATA_SEPARATOR = "\n---\n";

export type UnwrappedRoleMapping = {
    /** Expression passed to JMESPath (no builder wrapper). */
    evaluationExpression: string;
    /** Present when the stored value was saved from the mapping builder. */
    builderState: { claimPath: string; rules: MappingBuilderRule[] } | null;
};

/**
 * Split stored DB value into evaluation expression and optional builder metadata.
 * Legacy values (no prefix) are returned as-is for evaluation.
 */
export function unwrapRoleMapping(
    stored: string | null | undefined
): UnwrappedRoleMapping {
    const trimmed = stored?.trim() ?? "";
    if (!trimmed.startsWith(PANGOLIN_ROLE_MAP_BUILDER_PREFIX)) {
        return {
            evaluationExpression: trimmed,
            builderState: null
        };
    }

    let rest = trimmed.slice(PANGOLIN_ROLE_MAP_BUILDER_PREFIX.length);
    if (rest.startsWith("\n")) {
        rest = rest.slice(1);
    }

    const sepIdx = rest.indexOf(BUILDER_METADATA_SEPARATOR);
    if (sepIdx === -1) {
        return {
            evaluationExpression: trimmed,
            builderState: null
        };
    }

    const jsonPart = rest.slice(0, sepIdx).trim();
    const inner = rest.slice(sepIdx + BUILDER_METADATA_SEPARATOR.length).trim();

    try {
        const meta = JSON.parse(jsonPart) as {
            claimPath?: unknown;
            rules?: unknown;
        };
        if (
            typeof meta.claimPath === "string" &&
            Array.isArray(meta.rules)
        ) {
            const rules: MappingBuilderRule[] = meta.rules.map(
                (r: unknown) => {
                    const row = r as {
                        matchValue?: unknown;
                        roleNames?: unknown;
                    };
                    return {
                        matchValue:
                            typeof row.matchValue === "string"
                                ? row.matchValue
                                : "",
                        roleNames: Array.isArray(row.roleNames)
                            ? row.roleNames.filter(
                                  (n): n is string => typeof n === "string"
                              )
                            : []
                    };
                }
            );
            return {
                evaluationExpression: inner,
                builderState: {
                    claimPath: meta.claimPath,
                    rules: ensureMappingBuilderRuleIds(rules)
                }
            };
        }
    } catch {
        /* fall through */
    }

    return {
        evaluationExpression: inner.length ? inner : trimmed,
        builderState: null
    };
}

function escapeSingleQuotes(value: string): string {
    return value.replace(/'/g, "\\'");
}

export function compileRoleMappingExpression(config: RoleMappingConfig): string {
    if (config.mode === "rawExpression") {
        return config.rawExpression.trim();
    }

    if (config.mode === "fixedRoles") {
        const roleNames = dedupeNonEmpty(config.fixedRoleNames);
        if (!roleNames.length) {
            return "";
        }

        if (roleNames.length === 1) {
            return `'${escapeSingleQuotes(roleNames[0])}'`;
        }

        return `[${roleNames.map((name) => `'${escapeSingleQuotes(name)}'`).join(", ")}]`;
    }

    const claimPath = config.mappingBuilder.claimPath.trim();
    const rules = config.mappingBuilder.rules
        .map((rule) => ({
            matchValue: rule.matchValue.trim(),
            roleNames: dedupeNonEmpty(rule.roleNames)
        }))
        .filter((rule) => Boolean(rule.matchValue) && rule.roleNames.length > 0);

    if (!claimPath || !rules.length) {
        return "";
    }

    const compiledRules = rules.map((rule) => {
        const mappedRoles = `[${rule.roleNames
            .map((name) => `'${escapeSingleQuotes(name)}'`)
            .join(", ")}]`;
        return `contains(${claimPath}, '${escapeSingleQuotes(rule.matchValue)}') && ${mappedRoles} || []`;
    });

    const inner = `[${compiledRules.join(", ")}][]`;
    const metadata = {
        claimPath,
        rules: rules.map((r) => ({
            matchValue: r.matchValue,
            roleNames: r.roleNames
        }))
    };

    return `${PANGOLIN_ROLE_MAP_BUILDER_PREFIX}\n${JSON.stringify(metadata)}${BUILDER_METADATA_SEPARATOR}${inner}`;
}

export function detectRoleMappingConfig(
    expression: string | null | undefined,
    defaults: RoleMappingConfig = defaultRoleMappingConfig()
): RoleMappingConfig {
    const stored = expression?.trim() || "";

    if (!stored) {
        return defaults;
    }

    const { evaluationExpression, builderState } = unwrapRoleMapping(stored);

    if (builderState) {
        return {
            mode: "mappingBuilder",
            fixedRoleNames: [],
            mappingBuilder: {
                claimPath: builderState.claimPath,
                rules: builderState.rules
            },
            rawExpression: evaluationExpression
        };
    }

    const tail = evaluationExpression.trim();

    const singleMatch = tail.match(SINGLE_QUOTED_ROLE_REGEX);
    if (singleMatch?.[1]) {
        return {
            mode: "fixedRoles",
            fixedRoleNames: [singleMatch[1]],
            mappingBuilder: defaults.mappingBuilder,
            rawExpression: tail
        };
    }

    const arrayMatch = tail.match(QUOTED_ROLE_ARRAY_REGEX);
    if (arrayMatch?.[1]) {
        const roleNames = arrayMatch[1]
            .split(",")
            .map((entry) => entry.trim())
            .map((entry) => entry.match(SINGLE_QUOTED_ROLE_REGEX)?.[1] || "")
            .filter(Boolean);

        if (roleNames.length > 0) {
            return {
                mode: "fixedRoles",
                fixedRoleNames: roleNames,
                mappingBuilder: defaults.mappingBuilder,
                rawExpression: tail
            };
        }
    }

    return {
        mode: "rawExpression",
        fixedRoleNames: [],
        mappingBuilder: defaults.mappingBuilder,
        rawExpression: tail
    };
}

export function defaultRoleMappingConfig(): RoleMappingConfig {
    return {
        mode: "fixedRoles",
        fixedRoleNames: [],
        mappingBuilder: {
            claimPath: "groups",
            rules: [createMappingBuilderRule()]
        },
        rawExpression: ""
    };
}

/** Directory sync builder rules match on group names, `groups` holds provider group IDs. */
export function defaultSyncRoleMappingConfig(): RoleMappingConfig {
    const config = defaultRoleMappingConfig();
    return {
        ...config,
        mappingBuilder: { ...config.mappingBuilder, claimPath: "groupNames" }
    };
}

function dedupeNonEmpty(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * "Create missing roles" only applies to a raw expression, the only mode that can
 * return role names that aren't in the org. Saved as `false` otherwise, so a
 * hidden checkbox doesn't stay on after switching modes.
 */
export function effectiveCreateMissingRoles(
    config: RoleMappingConfig,
    checked: boolean | undefined
): boolean {
    return config.mode === "rawExpression" && checked === true;
}
