# AI Gateway Provider Selection

How the AI gateway picks which attached provider handles a request when an
inference resource has more than one AI provider.

**Code:**

- Route → capability binding: `server/routers/aiGateway/createAiGatewayRouter.ts`
- Request pipeline: `server/routers/aiGateway/pipeline.ts` (`selectProvider`)
- Model discovery: `server/routers/aiGateway/v1Models.ts` and
  `server/lib/aiModelDiscovery.ts`
- Tie-break scoring: `server/lib/aiProviderSelection.ts`
- Allow/block matching: `server/lib/aiModelKeyMatch.ts`
- Model catalog: `server/lib/aiModelCatalog.ts`
- Default capabilities per provider type: `server/lib/aiProviderDefaults.ts`

Overlapping model allows are permitted at save time. Selection happens at
request time. If the algorithm cannot confidently pick one provider, the
gateway returns `403` with an ambiguous-provider error.

## Selection Pipeline

Every gateway request runs through these steps in order. Each step narrows
the candidate set. Later steps only run when more than one provider remains.

```
1. Capability filter
2. Allow / block lists
3. Most specific allow pattern
4. Catalog ownership
5. Provider class preference
6. Ambiguous → error
```

### 1. Capability Filter

The incoming path selects a capability before any provider logic runs.

| Path | Capability |
|------|------------|
| `POST /v1/chat/completions` | `openai_chat` |
| `POST /v1/responses` | `openai_responses` |
| `POST /v1/messages` | `anthropic_messages` |
| `GET /v1/models`, `GET /v1/models/{id}` | `v1_models` |
| Gemini / Vertex / Bedrock routes | their respective capability ids |

Only attached providers that advertise that capability stay in the candidate
set. Default capabilities do not overlap for native OpenAI vs Anthropic:

| Provider type | Default capabilities |
|---------------|----------------------|
| `openai` | `openai_chat`, `openai_responses` |
| `anthropic` | `anthropic_messages`, `v1_models` |
| `openRouter` | `openai_chat` |
| `vercelAiGateway` | `openai_chat`, `openai_responses` |
| `microsoftFoundry` | `openai_chat`, `openai_responses`, `anthropic_messages`, `v1_models` |
| `custom` | whatever was configured |

### 2. Allow / Block Lists

For each remaining provider, the gateway resolves the effective allow and
block patterns:

- **`inherit`**: use the provider's own model lists
- **`select`**: use the resource-selected subset of those lists

A candidate is kept only if `isAllowedByLists(requestedModel, allows, blocks)`
passes:

1. At least one allow pattern must match
2. No block pattern may match

Patterns support `*` and `?` globs (`gpt-*`, `claude-3-5-sonnet-?`).

### 3. Most Specific Allow Pattern

Among providers that allow the model, keep those whose matching allow
pattern is most specific:

1. Exact keys beat patterns
2. Fewer wildcard characters win
3. Longer literal length wins

Example: `gpt-4o` beats `gpt-*` beats `*`.

### 4. Catalog Ownership

When specificity is tied (common with multiple `*` allows), score each
provider against the known model catalog:

| Score | Meaning |
|------:|---------|
| 2 | Typed provider whose catalog contains the model (`openai` → openai catalog, `anthropic` → anthropic, etc.) |
| 1 | Aggregator or custom (`openRouter`, `vercelAiGateway`, `custom`) and the model exists somewhere in the catalog |
| 0 | No ownership signal (typed catalog miss, or unknown model on aggregator/custom) |

Model id lookup tries the raw id, then a stripped `vendor/model` form
(e.g. `openai/gpt-4o` → also try `gpt-4o`).

Typed providers map to catalog providers as:

| Provider type | Catalog |
|---------------|---------|
| `openai` | `openai` |
| `anthropic` | `anthropic` |
| `googleGemini` | `gemini` |
| `vertexAi` | `vertex` |
| `bedrock` | `bedrock` |
| `microsoftFoundry` | `azure` |
| `openRouter` / `vercelAiGateway` / `custom` | none (aggregator/custom path) |

### 5. Provider Class Preference

If catalog ownership is still tied, prefer:

| Rank | Class |
|-----:|-------|
| 2 | Native typed provider (`openai`, `anthropic`, `googleGemini`, …) |
| 1 | Aggregator (`openRouter`, `vercelAiGateway`) |
| 0 | `custom` |

### 6. Ambiguous Error

If more than one distinct provider remains after all steps, the gateway
rejects the request:

```
Model "<id>" is ambiguous across multiple AI providers on this resource
```

Typical remaining ties: two OpenAI-type providers both with `*`, or two
customs advertising the same capability for an unknown model.

## Model Discovery Is Not Selection

`GET /v1/models` and `GET /v1/models/{id}` (`v1_models`) skip steps 3-6
entirely. There is no requested model to disambiguate on, so the gateway does
not pick one provider - it returns the **union** of what every attached
provider advertising `v1_models` would accept, deduplicated by model id
(lowest `providerId` wins a collision).

Discovery is answered from the gateway's own view of the allow/block lists,
never proxied upstream. Providers that expose no `/v1/models` endpoint of their
own still get a working listing, and a model an allow/block list forbids is
never advertised.

Each provider's candidate ids come from two places:

| Source | Contributes |
|--------|-------------|
| Exact (non-wildcard) allow entries | the model key itself |
| The model catalog for the provider's type | every catalog id matching an allow pattern |

Both sources are then filtered through the same
`isAllowedByLists(id, allows, blocks)` check step 2 applies, so a block pattern
hides a model from discovery exactly as it would reject it at request time.

The catalog source is what makes a wildcard allow such as `claude-*`
enumerable. Provider types with no catalog mapping (`openRouter`,
`vercelAiGateway`, `custom`) have nothing to expand against, so a wildcard
allow on those types lists nothing - **add exact allow entries to make their
models discoverable.**

### Where each field comes from

Token limits and capability flags can't be derived from an allow/block list.
They come from the model catalog (`server/lib/aiModelCatalog.ts`), which the
Fossorial API builds from LiteLLM:

| Field | Source |
|-------|--------|
| `max_input_tokens` | catalog `limits.input` |
| `max_tokens` | catalog `limits.output` |
| `capabilities` | catalog flags, mapped to the Models API shape by `capabilitiesFromCatalog` |
| `display_name` | the configured model row's name, else the model id |
| `created_at` | the configured model row's timestamp, else the epoch |

A model the catalog doesn't know (an exact allow entry for a fine-tune, say)
reports `null` for all three metadata fields. The Models API declares them
nullable, so that is a valid answer rather than a broken one.

The catalog's flags are coarser than the Models API describes: it carries a
single `reasoning` flag with no way to distinguish adaptive from
`budget_tokens`-style thinking, and nothing at all for batch, citations, code
execution, PDF input, or context management. Anything it reports as unknown
(`null`) is surfaced as unsupported rather than invented, so `capabilities`
understates rather than overstates what a model can do.

The gateway does **not** query the provider's own `/v1/models`. Discovery is
answered entirely from local state.

Results are ordered newest-first with the id as tie-break, and paginated with
Anthropic's `limit` / `after_id` / `before_id` semantics (default 20, max
1000).

## Examples

Assume each provider below is attached and enabled on the same inference
resource.

### Example A: OpenAI + Anthropic, Both `*`

| Provider | Allow | Capabilities |
|----------|-------|--------------|
| OpenAI | `*` | `openai_chat`, `openai_responses` |
| Anthropic | `*` | `anthropic_messages` |

**Request:** `POST /v1/chat/completions` with `model: "gpt-4o"`

1. Capability → only OpenAI remains
2. Allow → OpenAI matches `*`
3. Result → **OpenAI**

Anthropic never reaches pattern or catalog scoring. Capability alone decides.

**Request:** `POST /v1/messages` with `model: "claude-3-5-sonnet-latest"`

1. Capability → only Anthropic remains
2. Result → **Anthropic**

### Example B: OpenAI + OpenRouter, Both `*`

| Provider | Allow | Capabilities |
|----------|-------|--------------|
| OpenAI | `*` | `openai_chat`, … |
| OpenRouter | `*` | `openai_chat` |

**Request:** `POST /v1/chat/completions` with `model: "gpt-4o"`

1. Capability → both remain (`openai_chat`)
2. Allow → both match `*`
3. Specificity → tie (`*` vs `*`)
4. Catalog → OpenAI scores `2` (owns `gpt-4o`); OpenRouter scores `1`
5. Result → **OpenAI**

### Example C: OpenRouter Only Serving a Claude Model Over OpenAI Chat

| Provider | Allow | Capabilities |
|----------|-------|--------------|
| OpenRouter | `*` | `openai_chat` |

**Request:** `POST /v1/chat/completions` with `model: "anthropic/claude-3.5-sonnet"`

1. Capability → OpenRouter remains
2. Only one candidate → **OpenRouter**

No tie-breaking needed.

### Example D: OpenAI (`gpt-*`) + OpenRouter (`*`)

| Provider | Allow |
|----------|-------|
| OpenAI | `gpt-*` |
| OpenRouter | `*` |

**Request:** `model: "gpt-4o"` on `openai_chat`

1. Capability → both
2. Allow → both match
3. Specificity → OpenAI's `gpt-*` beats OpenRouter's `*`
4. Result → **OpenAI**

Catalog scoring is not needed because specificity already unique'd the set.

### Example E: OpenAI + Anthropic With Overlapping Custom Capabilities

Someone grants Anthropic `openai_chat` as well (non-default).

| Provider | Allow | Capabilities |
|----------|-------|--------------|
| OpenAI | `*` | `openai_chat`, … |
| Anthropic | `*` | `anthropic_messages`, `openai_chat` |

**Request:** `POST /v1/chat/completions` with `model: "gpt-4o"`

1. Capability → both remain
2. Allow → both match `*`
3. Specificity → tie
4. Catalog → OpenAI `2`, Anthropic `0` (`gpt-4o` is not in the anthropic catalog)
5. Result → **OpenAI**

### Example F: Two Aggregators, Known Model

| Provider | Allow |
|----------|-------|
| OpenRouter | `*` |
| Vercel AI Gateway | `*` |

**Request:** `model: "gpt-4o"` on `openai_chat`

1. Capability → both
2. Allow / specificity → tie
3. Catalog → both score `1` (known model, no typed owner in the set)
4. Class → both aggregators (rank `1`) → still tied
5. Result → **ambiguous error**

Attach a native OpenAI provider (or narrow one aggregator's allow list) to
make this determinable.

### Example G: Two OpenAI Providers, Both `*`

| Provider | Type | Allow |
|----------|------|-------|
| OpenAI Prod | `openai` | `*` |
| OpenAI Staging | `openai` | `*` |

**Request:** `model: "gpt-4o"`

1–5 all leave both candidates (same capability, same specificity, same
catalog ownership, same class).

Result → **ambiguous error**

Disambiguate with different allow patterns, disable one attachment, or
split across resources.

### Example H: Unknown Model Across Native + Aggregator

| Provider | Allow |
|----------|-------|
| OpenAI | `*` |
| OpenRouter | `*` |

**Request:** `model: "my-fine-tune-v3"` (not in catalog)

1. Capability → both
2. Allow / specificity → tie
3. Catalog → both score `0` (typed miss + unknown aggregator model)
4. Class → OpenAI (`2`) beats OpenRouter (`1`)
5. Result → **OpenAI**

## Practical Guidance

- Native OpenAI + Anthropic with `*` is safe. Different default APIs never
  collide.
- OpenAI + OpenRouter with `*` is usually fine for catalog-known OpenAI
  models. Native wins.
- Prefer specific allow patterns (`gpt-4o`, `gpt-*`) when two providers share
  a capability.
- Two providers of the same type both using `*` will stay ambiguous. Narrow
  at least one allow list.
- Custom providers only win ties when no stronger native/aggregator signal
  remains.

## Related Behavior

- **Saving providers on a resource does not reject overlapping allows.**
  Collisions are resolved (or rejected) per request.
- Budgets, auth, and upstream URL / target routing run after a single
  provider has been selected.
