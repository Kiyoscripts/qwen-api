// English — the source of truth. Every other locale is Partial<typeof en>, so
// adding a key here surfaces it as a missing-translation gap everywhere else
// while still rendering (in English) until each file catches up.
//
// Keys are grouped by surface and named for what the string IS, not where it
// happens to sit, so moving a label between pages does not orphan its key.
//
// NOT translated on purpose: /docs (it documents an English API — field names,
// headers and error payloads must stay verbatim or copy-paste breaks), model
// ids, and product names.

export const en = {
  // --- nav / shared ---------------------------------------------------------
  nav_models: "Models",
  nav_playground: "Playground",
  nav_chat: "Chat",
  nav_docs: "Docs",
  nav_login: "Log in",
  nav_dashboard: "Dashboard",
  nav_theme: "Colour theme",
  nav_cursor: "Custom cursor",
  nav_language: "Language",

  // --- homepage -------------------------------------------------------------
  home_badge: "OpenAI- and Anthropic-compatible",
  home_title_a: "Qwen and friends,",
  home_title_b: "one keyed API.",
  home_sub:
    "Change two lines and reach every model — GPT, Grok, Kimi, Gemma, DeepSeek and Qwen, plus vision, image, video and speech — through the SDK you already use.",
  home_cta_key: "Get an API key",
  home_cta_docs: "Read the docs",
  home_sec_models: "Models",
  home_sec_models_all: "See all models →",
  home_sec_models_h: "Everything behind one key",
  home_sec_caps: "Capabilities",
  home_sec_caps_h: "Built like a real API",
  home_sec_quick: "Quickstart",
  home_sec_quick_all: "Full reference →",
  home_sec_quick_h: "Two lines to switch",
  home_getkey_h: "Get an API key",
  home_getkey_body:
    "Link your Discord to create keys and manage them from your dashboard — usage, analytics and revocation, all in one place.",
  home_getkey_cta: "Log in with Discord",
  home_foot_tagline: "An OpenAI- and Anthropic-compatible gateway to Qwen and OneCompiler.",
  home_foot_product: "Product",
  home_foot_devs: "Developers",
  home_foot_account: "Account",
  home_foot_fine: "Unofficial. Not affiliated with Alibaba Cloud, Qwen or OneCompiler.",

  // --- stats tiles ----------------------------------------------------------
  stat_qwen_pool: "Qwen pool",
  stat_onecompiler_pool: "OneCompiler pool",
  stat_models: "Models",
  stat_api_keys: "API keys",
  stat_active_keys: "Active keys",

  // --- models page ----------------------------------------------------------
  models_eyebrow: "Models",
  models_title: "{count} models, one key",
  models_sub: "Every model is available through the same OpenAI-compatible endpoint. Pass the model id in your request.",
  models_degraded:
    "The account pool is unreachable right now, so the live Qwen chat models are missing from this list. They are unaffected on the API itself — try again shortly.",
  tag_reasoning: "reasoning",
  tag_vision: "vision",
  tag_text: "text",
  tag_image: "image",
  tag_edit: "edit",
  tag_video: "video",
  tag_persona: "persona",

  // --- keys / login ---------------------------------------------------------
  keys_title: "API keys",
  keys_new: "New key",
  keys_name_placeholder: "Key name (optional)",
  keys_create: "Create key",
  keys_revoke: "Revoke",
  keys_delete: "Delete",
  keys_copy: "Copy",
  keys_copied: "Copied",
  keys_shown_once: "Copy this key now — it will not be shown again.",
  keys_none: "No keys yet.",
  keys_requests: "Requests",
  keys_last_used: "Last used",
  keys_created: "Created",
  keys_status: "Status",
  keys_active: "active",
  keys_revoked: "revoked",
  keys_never: "never",
  login_title: "Log in",
  login_sub: "Link your Discord account to create and manage API keys.",
  login_with_discord: "Log in with Discord",
  login_key_placeholder: "Paste your login key",
  login_submit: "Continue",
  logout: "Log out",

  // --- chat -----------------------------------------------------------------
  chat_new: "New chat",
  chat_placeholder: "Ask anything…",
  chat_send: "Send",
  chat_stop: "Stop",
  chat_attach: "Attach image",
  chat_attach_unsupported: "{model} cannot read images",
  chat_regenerate: "Regenerate",
  chat_copy: "Copy",
  chat_read_aloud: "Read aloud",
  chat_settings: "Settings",
  chat_api_key: "API key",
  chat_delete_chat: "Delete chat",
  chat_empty_title: "How can I help you today?",
  chat_empty_sub: "Ask anything — explanations, code, debugging, ideas, and more.",
  chat_think: "Think",
  chat_fast: "Fast",
  chat_tools: "Tools",
  chat_reasoning: "Reasoning",
  chat_other_models: "Other models",
  chat_thought_for: "thought {seconds}s",
  chat_truncated: "The reply was cut off before the model finished.",

  // --- playground -----------------------------------------------------------
  pg_title: "Playground",
  pg_run: "Run",
  pg_stop: "Stop",
  pg_clear: "Clear",
  pg_model: "Model",
  pg_system: "System prompt",
  pg_temperature: "Temperature",
  pg_max_tokens: "Max tokens",
  pg_stream: "Stream",
  pg_response: "Response",
  pg_request: "Request",

  // --- shared states --------------------------------------------------------
  loading: "Loading…",
  error: "Something went wrong.",
  retry: "Try again",
  cancel: "Cancel",
  save: "Save",
  close: "Close",
} as const;
