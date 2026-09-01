export const AI_CLIENT_IDS = [
    "claude",
    "codex",
    "opencode",
    "gemini"
] as const;
export type AiClientId = (typeof AI_CLIENT_IDS)[number];

export const AI_CLIENT_NAMES: Record<AiClientId, string> = {
    claude: "Claude Code",
    codex: "Codex",
    opencode: "OpenCode",
    gemini: "Gemini CLI"
};

/** Auth as supplied by callers: the real key isn't fetched yet. */
export type AiClientAuthInput =
    | { mode: "keyed"; getKeyText: () => Promise<string> }
    | { mode: "keyless" };

/** Auth once the real key (if any) has been resolved. */
export type AiClientAuth = { mode: "keyed"; key: string } | { mode: "keyless" };

export type AiConfigBlock = {
    id: string;
    label: string;
    kind?: "code" | "steps";
    displayText: string;
    /** True when the snippet includes example values the user must replace. */
    hasPlaceholders?: boolean;
};

export type AiClientPresetId = "default" | "bedrock" | "vertex" | "kimi";

export type AiConfigRelation = "options" | "steps";

export type AiConfigPreset = {
    id: AiClientPresetId;
    label: string;
    relation: AiConfigRelation;
    blocks: AiConfigBlock[];
};

export type AiClientGuide = {
    id: AiClientId;
    name: string;
    /** Alternative CLI commands. Empty/null means this client has no CLI setup. */
    cli: AiConfigBlock[] | null;
    presets: AiConfigPreset[];
};

/**
 * Placeholder key for keyless (private/site) resources. Those resources need
 * no credential, but most clients refuse to start without *some* key set, so
 * they get an obviously-inert one rather than an omitted field.
 */
const KEYLESS_PLACEHOLDER_KEY = "none";

function keyValue(auth: AiClientAuth): string {
    return auth.mode === "keyed" ? auth.key : KEYLESS_PLACEHOLDER_KEY;
}

function block(
    id: string,
    label: string,
    build: (keyValue: string) => string,
    auth: AiClientAuth,
    kind: "code" | "steps" = "code",
    hasPlaceholders = false
): AiConfigBlock {
    return {
        id,
        label,
        kind,
        displayText: build(keyValue(auth)),
        hasPlaceholders
    };
}

const EXAMPLE_RESOURCE_HOST = "example.resource.url.com";

export function aiConfigBlockHasPlaceholders(block: AiConfigBlock): boolean {
    return (
        block.hasPlaceholders === true ||
        block.displayText.includes(EXAMPLE_RESOURCE_HOST)
    );
}

function buildCli(
    clientArg: "claude" | "codex" | "opencode" | "gemini",
    auth: AiClientAuth,
    resourceNiceId?: string
): AiConfigBlock[] {
    const resourceFlag = resourceNiceId ? ` --resource ${resourceNiceId}` : "";

    const configure: AiConfigBlock = {
        id: `cli-configure-${clientArg}`,
        label: "Configure",
        displayText: `pangolin configure ${clientArg}${resourceFlag}`
    };

    if (auth.mode !== "keyed") {
        return [configure];
    }

    return [
        configure,
        {
            id: `cli-configure-key-${clientArg}`,
            label: "Configure with an API key",
            displayText: `pangolin configure ${clientArg} ${auth.key}${resourceFlag}`
        }
    ];
}

function buildClaudeGuide(
    endpoint: string,
    auth: AiClientAuth,
    resourceNiceId?: string
): AiClientGuide {
    const defaultSettings = block(
        "claude-default-settings",
        "~/.claude/settings.json",
        (key) =>
            [
                "{",
                `    "apiKeyHelper": "echo '${key}'",`,
                '    "env": {',
                `        "ANTHROPIC_BASE_URL": "${endpoint}"`,
                "    }",
                "}"
            ].join("\n"),
        auth
    );

    const defaultShell = block(
        "claude-default-shell",
        "Shell",
        (key) =>
            [
                `export ANTHROPIC_BASE_URL=${endpoint}`,
                `export ANTHROPIC_API_KEY=${key}`,
                "claude"
            ].join("\n"),
        auth
    );

    const bedrockSettings = block(
        "claude-bedrock-settings",
        "~/.claude/settings.json",
        () =>
            [
                "{",
                '    "env": {',
                '        "ANTHROPIC_MODEL": "claude-sonnet-4-6",',
                `        "ANTHROPIC_BEDROCK_BASE_URL": "${endpoint}/bedrock",`,
                '        "CLAUDE_CODE_USE_BEDROCK": "1",',
                '        "CLAUDE_CODE_SKIP_BEDROCK_AUTH": "1"',
                "    }",
                "}"
            ].join("\n"),
        auth,
        "code",
        true
    );

    const vertexSettings = block(
        "claude-vertex-settings",
        "~/.claude/settings.json",
        () =>
            [
                "{",
                '    "env": {',
                '        "CLOUD_ML_REGION": "global",',
                '        "ANTHROPIC_VERTEX_PROJECT_ID": "<your-gcp-project-id>",',
                '        "CLAUDE_CODE_USE_VERTEX": "1",',
                '        "CLAUDE_CODE_SKIP_VERTEX_AUTH": "1",',
                `        "ANTHROPIC_VERTEX_BASE_URL": "${endpoint}/v1"`,
                "    }",
                "}"
            ].join("\n"),
        auth,
        "code",
        true
    );

    const kimiSettings = block(
        "claude-kimi-settings",
        "~/.claude/settings.json",
        (key) =>
            [
                "{",
                `    "apiKeyHelper": "echo '${key}'",`,
                '    "env": {',
                `        "ANTHROPIC_BASE_URL": "${endpoint}/anthropic",`,
                '        "ANTHROPIC_MODEL": "kimi-k2",',
                '        "ANTHROPIC_DEFAULT_OPUS_MODEL": "kimi-k2",',
                '        "ANTHROPIC_DEFAULT_SONNET_MODEL": "kimi-k2",',
                '        "ANTHROPIC_DEFAULT_HAIKU_MODEL": "kimi-k2",',
                '        "CLAUDE_CODE_SUBAGENT_MODEL": "kimi-k2",',
                '        "ENABLE_TOOL_SEARCH": "false"',
                "    }",
                "}"
            ].join("\n"),
        auth,
        "code",
        true
    );

    return {
        id: "claude",
        name: AI_CLIENT_NAMES.claude,
        cli: buildCli("claude", auth, resourceNiceId),
        presets: [
            {
                id: "default",
                label: "Default (Anthropic)",
                relation: "options",
                blocks: [defaultSettings, defaultShell]
            },
            {
                id: "bedrock",
                label: "Amazon Bedrock",
                relation: "options",
                blocks: [bedrockSettings]
            },
            {
                id: "vertex",
                label: "Google Vertex AI",
                relation: "options",
                blocks: [vertexSettings]
            },
            {
                id: "kimi",
                label: "Kimi K2 (Moonshot AI)",
                relation: "options",
                blocks: [kimiSettings]
            }
        ]
    };
}

function buildCodexGuide(
    endpoint: string,
    auth: AiClientAuth,
    resourceNiceId?: string
): AiClientGuide {
    const settings = block(
        "codex-settings",
        "~/.codex/config.toml",
        () =>
            [
                'model_provider = "pangolin"',
                "",
                "[model_providers.pangolin]",
                'name = "Pangolin AI Gateway"',
                `base_url = "${endpoint}/v1"`,
                'wire_api = "responses"',
                ...(auth.mode === "keyed"
                    ? ['env_key = "PANGOLIN_API_KEY"']
                    : [])
            ].join("\n"),
        auth
    );

    const shell =
        auth.mode === "keyed"
            ? block(
                  "codex-shell",
                  "Shell",
                  (key) => `export PANGOLIN_API_KEY=${key}`,
                  auth
              )
            : null;

    return {
        id: "codex",
        name: AI_CLIENT_NAMES.codex,
        cli: buildCli("codex", auth, resourceNiceId),
        presets: [
            {
                id: "default",
                label: "Default",
                relation: "steps",
                blocks: shell ? [settings, shell] : [settings]
            }
        ]
    };
}

function buildOpencodeGuide(
    endpoint: string,
    auth: AiClientAuth,
    resourceNiceId?: string
): AiClientGuide {
    const config = block(
        "opencode-config",
        "opencode.json",
        () =>
            [
                "{",
                '    "$schema": "https://opencode.ai/config.json",',
                '    "provider": {',
                '        "anthropic": {',
                '            "options": {',
                `                "baseURL": "${endpoint}/v1"`,
                "            }",
                "        },",
                '        "openai": {',
                '            "options": {',
                `                "baseURL": "${endpoint}/v1"`,
                "            }",
                "        }",
                "    }",
                "}"
            ].join("\n"),
        auth
    );

    const authFile = block(
        "opencode-auth",
        "auth.json",
        (key) =>
            [
                "{",
                '    "anthropic": {',
                '        "type": "api",',
                `        "key": "${key}"`,
                "    },",
                '    "openai": {',
                '        "type": "api",',
                `        "key": "${key}"`,
                "    }",
                "}"
            ].join("\n"),
        auth
    );

    const moreProviders = block(
        "opencode-more-providers",
        "More providers",
        () =>
            "OpenCode configures providers individually, so Anthropic and OpenAI are just the ones set up above. " +
            'You can point any other OpenCode-supported provider (e.g. "openrouter", "google", "groq") at this gateway the same way: add a matching entry under "provider" in opencode.json, and a matching key in auth.json.',
        auth,
        "steps"
    );

    return {
        id: "opencode",
        name: AI_CLIENT_NAMES.opencode,
        cli: buildCli("opencode", auth, resourceNiceId),
        presets: [
            {
                id: "default",
                label: "Default",
                relation: "steps",
                // auth.json is written even for keyless resources: OpenCode
                // refuses to start a provider with no key at all ("OpenAI API
                // key is missing"), so it gets the inert placeholder instead.
                blocks: [config, authFile, moreProviders]
            }
        ]
    };
}

function buildGeminiGuide(
    endpoint: string,
    auth: AiClientAuth,
    resourceNiceId?: string
): AiClientGuide {
    const defaultEnv = block(
        "gemini-default-env",
        "~/.gemini/.env",
        (key) =>
            [
                `GOOGLE_GEMINI_BASE_URL=${endpoint}`,
                `GEMINI_API_KEY=${key}`
            ].join("\n"),
        auth
    );

    const defaultShell = block(
        "gemini-default-shell",
        "Shell",
        (key) =>
            [
                `export GOOGLE_GEMINI_BASE_URL=${endpoint}`,
                `export GEMINI_API_KEY=${key}`,
                "gemini"
            ].join("\n"),
        auth
    );

    return {
        id: "gemini",
        name: AI_CLIENT_NAMES.gemini,
        cli: buildCli("gemini", auth, resourceNiceId),
        presets: [
            {
                id: "default",
                label: "Default",
                relation: "options",
                blocks: [defaultEnv, defaultShell]
            }
        ]
    };
}

const GUIDE_BUILDERS: Record<
    AiClientId,
    (
        endpoint: string,
        auth: AiClientAuth,
        resourceNiceId?: string
    ) => AiClientGuide
> = {
    claude: buildClaudeGuide,
    codex: buildCodexGuide,
    opencode: buildOpencodeGuide,
    gemini: buildGeminiGuide
};

export function buildAiClientGuide(
    clientId: AiClientId,
    endpoint: string,
    auth: AiClientAuth,
    resourceNiceId?: string
): AiClientGuide {
    return GUIDE_BUILDERS[clientId](endpoint, auth, resourceNiceId);
}
