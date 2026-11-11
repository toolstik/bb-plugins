---
name: litellm-agents
description: Configure or diagnose this plugin's corporate LiteLLM Claude Code and Codex providers in BB.
---

# LiteLLM Agents

The plugin registers `litellm-claude-code` and `litellm-codex`. Personal `claude-code` and `codex` providers remain independent. Users select the engine and gateway model with BB's normal picker.

Read settings with `bb plugin config litellm`. Inspect catalogs with `bb provider models litellm-claude-code` and `bb provider models litellm-codex`, using the intended environment/host selector. Reload with `bb plugin reload litellm` after source changes or to request fresh discovery.

Settings: `baseUrl`, `keyFile`, `claudeExecutable`, `codexExecutable`, `claudeDefaultModel`, `codexDefaultModel`, `modelAliases` (JSON object), `claudeModels` and `codexModels` (JSON arrays, empty means all chat models). Model aliases must come from authoritative gateway configuration; never infer canonical IDs from display labels.

The credential file lives on the execution host, outside repositories, contains one `LITELLM_API_KEY` assignment and must be mode 600 on Unix. Users can create or replace the key in Settings -> Installed plugins -> LiteLLM Agents -> Ключ LiteLLM: select the execution machine, enter the key in the password field, and click Сохранить ключ. The form writes the configured keyFile with mode 600 and never returns the stored key. For agent-assisted setup, use BB's secrets skill and `bb secret request`. Never read, print, copy to argv, or ask for this key in chat. The host bridge reads it and injects authorization through a loopback proxy; provider environment events must never receive the corporate key.

Missing credentials, 401 and connectivity failures must not fall back to a personal account. Do not modify global Claude/Codex configs or sign users out to diagnose this plugin. Check URL, keyFile, installed executables, catalog and selected model first. Use `/v1/models`, never `/health`.

Catalog membership does not guarantee tool calling or agent compatibility. Reasoning overrides and premium service tiers are not provided. Corporate key/user dollar budgets are exposed through provider-usage.v1 using /key/info and /user/info on the execution host; StatusLine displays the API-provided limit and spending, not a guessed default. Subscription windows do not apply. For initial diagnosis use an Anthropic model with Claude Code and an OpenAI model with Codex.

The source README documents building, conformance tests and an explicit live smoke script. Live smoke tests consume the corporate model budget. Do not run them merely to inspect status.

The user budget limit must come exclusively from user_info.metadata.paid_model_budget, with spending from user_info.spend. Do not substitute user_info.max_budget. Missing/invalid paid_model_budget means no user budget window. Key budgets still use info.max_budget.

Behavior settings are inherited from provider-claude-code / provider-codex through bb.sdk.plugins.getSettings on load and before each corporate message dispatch. Configure memory and subagents in those original plugins, not in LiteLLM. Claude also inherits workflowsDisabled, disable1MContext, chromeEnabled, artifactsEnabled, sandboxEnabled, fullAccessApprovalsEnabled, commandDescriptionsEnabled. Missing/malformed source settings reject dispatch rather than keeping stale flags. Personal credentials, routing and model catalogs are never inherited. Changes apply on the next message. Reasoning/Fast support remains gateway-specific.
