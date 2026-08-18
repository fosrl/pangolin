export const AI_CLIENT_IDS = ["claude", "codex", "opencode", "cursor"] as const;
export type AiClientId = (typeof AI_CLIENT_IDS)[number];

export const AI_CLIENT_NAMES: Record<AiClientId, string> = {
    claude: "Claude Code",
    codex: "Codex",
    opencode: "OpenCode",
    cursor: "Cursor"
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
};

export type AiClientPresetId = "default" | "bedrock" | "vertex" | "kimi";

export type AiConfigPreset = {
    id: AiClientPresetId;
    label: string;
    blocks: AiConfigBlock[];
};

export type AiCliCommands = {
    configure: AiConfigBlock;
    configureWithKey?: AiConfigBlock;
};

export type AiClientGuide = {
    id: AiClientId;
    name: string;
    cli: AiCliCommands | null;
    presets: AiConfigPreset[];
};

function keyValue(auth: AiClientAuth): string {
    return auth.mode === "keyed" ? auth.key : "-";
}

function block(
    id: string,
    label: string,
    build: (keyValue: string) => string,
    auth: AiClientAuth,
    kind: "code" | "steps" = "code"
): AiConfigBlock {
    return { id, label, kind, displayText: build(keyValue(auth)) };
}

function buildCli(
    clientArg: "claude" | "codex" | "opencode",
    auth: AiClientAuth
): AiCliCommands {
    const configure: AiConfigBlock = {
        id: `cli-configure-${clientArg}`,
        label: "Configure",
        displayText: `pangolin configure ${clientArg}`
    };

    if (auth.mode !== "keyed") {
        return { configure };
    }

    return {
        configure,
        configureWithKey: {
            id: `cli-configure-key-${clientArg}`,
            label: "Configure with an API key",
            displayText: `pangolin configure ${clientArg} ${auth.key}`
        }
    };
}

function buildClaudeGuide(endpoint: string, auth: AiClientAuth): AiClientGuide {
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
                `export ANTHROPIC_API_KEY=${auth.mode === "keyed" ? key : "none"}`,
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
        auth
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
        auth
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
        auth
    );

    return {
        id: "claude",
        name: AI_CLIENT_NAMES.claude,
        cli: buildCli("claude", auth),
        presets: [
            {
                id: "default",
                label: "Default (Anthropic)",
                blocks: [defaultSettings, defaultShell]
            },
            {
                id: "bedrock",
                label: "Amazon Bedrock",
                blocks: [bedrockSettings]
            },
            {
                id: "vertex",
                label: "Google Vertex AI",
                blocks: [vertexSettings]
            },
            {
                id: "kimi",
                label: "Kimi K2 (Moonshot AI)",
                blocks: [kimiSettings]
            }
        ]
    };
}

function buildCodexGuide(endpoint: string, auth: AiClientAuth): AiClientGuide {
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
                ...(auth.mode === "keyed" ? ['env_key = "PANGOLIN_API_KEY"'] : [])
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
        cli: buildCli("codex", auth),
        presets: [
            {
                id: "default",
                label: "Default",
                blocks: shell ? [settings, shell] : [settings]
            }
        ]
    };
}

function buildOpencodeGuide(endpoint: string, auth: AiClientAuth): AiClientGuide {
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
            ["{", '    "anthropic": {', '        "type": "api",', `        "key": "${key}"`, "    }", "}"].join(
                "\n"
            ),
        auth
    );

    return {
        id: "opencode",
        name: AI_CLIENT_NAMES.opencode,
        cli: buildCli("opencode", auth),
        presets: [
            {
                id: "default",
                label: "Default",
                blocks: [config, authFile]
            }
        ]
    };
}

function buildCursorGuide(endpoint: string, auth: AiClientAuth): AiClientGuide {
    const steps = block(
        "cursor-steps",
        "Cursor Settings",
        (key) =>
            [
                "1. Open Cursor Settings -> Models.",
                '2. Enable "Override OpenAI Base URL".',
                `3. Set the base URL to: ${endpoint}/v1`,
                auth.mode === "keyed"
                    ? `4. Paste your API key into the OpenAI API Key field: ${key}`
                    : '4. Leave the OpenAI API Key field set to a placeholder (e.g. "-"). Pangolin authenticates the request over your Newt/Olm connection automatically.',
                "5. Add a custom model matching the model your Pangolin AI Gateway serves (e.g. claude-sonnet-4-6)."
            ].join("\n"),
        auth,
        "steps"
    );

    return {
        id: "cursor",
        name: AI_CLIENT_NAMES.cursor,
        cli: null,
        presets: [
            {
                id: "default",
                label: "Default",
                blocks: [steps]
            }
        ]
    };
}

const GUIDE_BUILDERS: Record<
    AiClientId,
    (endpoint: string, auth: AiClientAuth) => AiClientGuide
> = {
    claude: buildClaudeGuide,
    codex: buildCodexGuide,
    opencode: buildOpencodeGuide,
    cursor: buildCursorGuide
};

export function buildAiClientGuide(
    clientId: AiClientId,
    endpoint: string,
    auth: AiClientAuth
): AiClientGuide {
    return GUIDE_BUILDERS[clientId](endpoint, auth);
}
