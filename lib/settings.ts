import { admin } from "./supabase";

export type AppSettings = {
  registration: { invite_only: boolean };
  defaults: { quota: number };
  models: { enabled: string[] };
  maintenance: { enabled: boolean; message: string; chat: boolean; images: boolean; video: boolean; audio: boolean };
  documentation: { base_url: string };
  custom_providers: { health_interval_minutes: number; discovery_interval_minutes: number; stale_grace_hours: number };
  tool_routing: { enabled: boolean; model: string };
  prompt_injection: { enabled: boolean; global_prompt: string; placement: "before_client" | "after_client"; allow_client_system_prompts: boolean; max_prompt_chars: number };
};

export const DEFAULT_SETTINGS: AppSettings = {
  registration: { invite_only: true },
  defaults: { quota: 0 },
  models: { enabled: [] },
  maintenance: { enabled: false, message: "Service maintenance is in progress.", chat: true, images: true, video: true, audio: true },
  documentation: { base_url: "" },
  custom_providers: { health_interval_minutes: 15, discovery_interval_minutes: 360, stale_grace_hours: 168 },
  tool_routing: { enabled: false, model: "" },
  prompt_injection: { enabled: false, global_prompt: "", placement: "before_client", allow_client_system_prompts: true, max_prompt_chars: 16000 },
};

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const { data } = await admin().from("app_settings").select("value").eq("key", key).maybeSingle();
  return { ...DEFAULT_SETTINGS[key], ...(data?.value || {}) } as AppSettings[K];
}

export async function modelEnabled(model: string): Promise<boolean> {
  const { enabled } = await getSetting("models");
  return enabled.length === 0 || enabled.includes(model);
}

export async function capabilityEnabled(capability: "chat" | "images" | "video" | "audio"): Promise<{ enabled: boolean; message: string }> {
  const setting = await getSetting("maintenance");
  return { enabled: !setting.enabled && setting[capability], message: setting.message };
}

export function validateSetting(key: string, value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Setting value must be an object.";
  const row = value as Record<string, unknown>;
  if (key === "registration") return typeof row.invite_only === "boolean" ? null : "invite_only must be a boolean.";
  if (key === "defaults") return Number.isInteger(row.quota) && Number(row.quota) >= 0 ? null : "quota must be a non-negative integer.";
  if (key === "models") return Array.isArray(row.enabled) && row.enabled.every((item) => typeof item === "string") ? null : "enabled must be an array of model IDs.";
  if (key === "maintenance") return typeof row.enabled === "boolean" && typeof row.message === "string" && ["chat", "images", "video", "audio"].every((name) => typeof row[name] === "boolean") ? null : "maintenance requires enabled, message, chat, images, video, and audio.";
  if (key === "tool_routing") return typeof row.enabled === "boolean" && typeof row.model === "string" && row.model.length <= 200 ? null : "tool routing requires an enabled boolean and model ID.";
  if (key === "prompt_injection") return typeof row.enabled === "boolean" && typeof row.global_prompt === "string" && row.global_prompt.length <= 16000 && (row.placement === "before_client" || row.placement === "after_client") && typeof row.allow_client_system_prompts === "boolean" && Number.isInteger(row.max_prompt_chars) && Number(row.max_prompt_chars) >= 1 && Number(row.max_prompt_chars) <= 16000 ? null : "Invalid prompt injection configuration.";
  if (key === "custom_providers") {
    const valid = (name: string, min: number, max: number) => Number.isInteger(row[name]) && Number(row[name]) >= min && Number(row[name]) <= max;
    return valid("health_interval_minutes", 1, 10080) && valid("discovery_interval_minutes", 1, 43200) && valid("stale_grace_hours", 1, 8760) ? null : "custom provider intervals and stale grace must be integers within supported ranges.";
  }
  if (key === "documentation") {
    if (typeof row.base_url !== "string") return "base_url must be a string.";
    const value = row.base_url.trim();
    if (!value) return null;
    try { const url = new URL(value); return url.protocol === "https:" && url.username === "" && url.password === "" && url.pathname.replace(/\/$/, "") === "" && !url.search && !url.hash ? null : "base_url must be an HTTPS origin without a path, query, credentials, or fragment."; }
    catch { return "base_url must be a valid HTTPS origin."; }
  }
  return "Unknown setting key.";
}
