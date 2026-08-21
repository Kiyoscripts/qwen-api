export type PromptInjectionSetting = {
  enabled: boolean;
  global_prompt: string;
  placement: "before_client" | "after_client";
  allow_client_system_prompts: boolean;
  max_prompt_chars: number;
};

export type ScopedPrompt = { scope: "global" | "provider" | "model" | "persona"; content: string };

const CLIENT_SYSTEM_ROLES = new Set(["system", "developer"]);

export function sanitizeInjectedPrompt(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.includes("\0")) throw new Error("System prompts cannot contain null bytes.");
  return value.trim();
}

export function injectSystemPrompts(messages: any[], sources: ScopedPrompt[], setting: PromptInjectionSetting): any[] {
  const client = setting.allow_client_system_prompts ? messages : messages.filter((m) => !CLIENT_SYSTEM_ROLES.has(m?.role));
  const injected = sources.map((source) => sanitizeInjectedPrompt(source.content)).filter(Boolean);
  const total = injected.reduce((sum, prompt) => sum + prompt.length, 0);
  if (total > setting.max_prompt_chars) throw new Error(`Injected system prompts exceed the ${setting.max_prompt_chars} character limit.`);
  if (!injected.length) return client;
  const rows = injected.map((content) => ({ role: "system", content }));
  if (setting.placement === "before_client") return [...rows, ...client];
  const lastSystem = client.reduce((last, message, index) => CLIENT_SYSTEM_ROLES.has(message?.role) ? index : last, -1);
  return [...client.slice(0, lastSystem + 1), ...rows, ...client.slice(lastSystem + 1)];
}

export function promptAuditMetadata(setting: PromptInjectionSetting) {
  return { enabled: setting.enabled, placement: setting.placement, allow_client_system_prompts: setting.allow_client_system_prompts, character_count: setting.global_prompt.length, max_prompt_chars: setting.max_prompt_chars };
}
