// Emulated OpenAI-style function/tool calling for the Qwen backend.
//
// chat.qwen.ai has no native tool API, but Qwen3 models are trained on the
// Hermes/Qwen `<tool_call>` convention, so we:
//   1. Teach the protocol via an injected system section listing the tools.
//   2. Flatten prior assistant tool_calls + tool results back into that same
//      text convention so multi-turn tool loops work.
//   3. Parse the reply back into OpenAI `tool_calls`.
//
// Everything funnels through ONE state machine (`ToolStream`). The streaming and
// buffered paths both drive it, so they cannot disagree about what counts as a
// call — they used to, which is why `stream: true` and `stream: false` could
// give different answers for the same prompt.
//
// Two ideas do most of the work for stability:
//
//   * **Nothing is a tool call unless its name is one of the declared tools.**
//     An emulated protocol lives in the same channel as ordinary prose, so the
//     dangerous failure isn't a missed call, it's a false one — `{"name":
//     "Alice"}` in a reply about people used to become a call to a tool named
//     Alice. Validating against the registry makes the parser fail safe: an
//     unrecognised block is returned as text, exactly as the model wrote it.
//
//   * **Repair before rejecting.** Qwen emits JSON that is nearly right —
//     trailing commas, single quotes, `True`, smart quotes from a markdown
//     pass, arguments double-encoded as a string, arguments hoisted to the top
//     level, `"3"` where the schema says integer. Each is mechanically
//     recoverable, and each one recovered is a tool call that would otherwise
//     have surfaced to the caller as unusable prose.
//
// Tool-calling method credit: Discord user .thereid.

import { randomUUID } from "node:crypto";

export interface OAITool {
  type?: string;
  function?: { name?: string; description?: string; parameters?: any; strict?: boolean };
}

export interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// Tools are active unless the caller opted out with tool_choice:"none".
export function hasTools(body: any): boolean {
  return Array.isArray(body?.tools) && body.tools.length > 0 && body?.tool_choice !== "none";
}

function toolChoiceName(toolChoice: any): string | null {
  if (toolChoice && typeof toolChoice === "object" && toolChoice.function?.name) return toolChoice.function.name;
  return null;
}

function newId(): string {
  return "call_" + randomUUID().replace(/-/g, "").slice(0, 24);
}

/* ---------------------------------------------------------------------------
   Registry — the set of names that may legally become a tool call.
   --------------------------------------------------------------------------- */

export interface Registry {
  names: string[];
  /** normalised name -> canonical name */
  byNorm: Map<string, string>;
  /** canonical name -> JSON Schema for its parameters */
  schemas: Map<string, any>;
  /** accept any well-formed name (only for callers with no tool list) */
  permissive?: boolean;
}

// Models reach for the wrong casing or separator constantly (`getWeather`,
// `get-weather`, `functions.get_weather`). Normalising both sides turns those
// near-misses into hits without ever inventing a tool that wasn't declared.
function normName(s: string): string {
  return String(s)
    .trim()
    .replace(/^(?:functions?|tools?)[.:]/i, "") // strip a namespace prefix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function buildRegistry(tools: OAITool[]): Registry {
  const names: string[] = [];
  const byNorm = new Map<string, string>();
  const schemas = new Map<string, any>();
  for (const t of tools || []) {
    const n = t?.function?.name;
    if (!n || typeof n !== "string") continue;
    names.push(n);
    byNorm.set(normName(n), n);
    schemas.set(n, t.function!.parameters || { type: "object", properties: {} });
  }
  return { names, byNorm, schemas };
}

/* ---------------------------------------------------------------------------
   System prompt
   --------------------------------------------------------------------------- */

export function toolSystemPrompt(tools: OAITool[], toolChoice: any): string {
  const reg = buildRegistry(tools);
  const defs = tools
    .filter((t) => t?.function?.name)
    .map((t) =>
      JSON.stringify({
        name: t.function!.name,
        description: t.function!.description || "",
        parameters: t.function!.parameters || { type: "object", properties: {} },
      })
    );

  // Use a real tool in the example. With a placeholder like "the_function_name"
  // models reliably copy the placeholder itself.
  const example = reg.names[0] || "example_function";
  const exampleArgs = (() => {
    const props = reg.schemas.get(example)?.properties;
    const first = props && Object.keys(props)[0];
    return first ? `{${JSON.stringify(first)}: "…"}` : "{}";
  })();

  const lines = [
    "# Tool use",
    "",
    "You have access to functions. Their signatures are provided inside <tools></tools>:",
    "<tools>",
    ...defs,
    "</tools>",
    "",
    "To call one, emit a <tool_call> block containing a single JSON object with",
    '"name" and "arguments":',
    "<tool_call>",
    `{"name": ${JSON.stringify(example)}, "arguments": ${exampleArgs}}`,
    "</tool_call>",
    "",
    "Rules:",
    `- "name" must be exactly one of: ${reg.names.join(", ")}. Never invent a function.`,
    '- "arguments" must be a JSON object matching that function\'s parameters, with',
    "  real JSON types — 3 not \"3\", true not \"true\".",
    "- Emit one <tool_call> block per call; several blocks run in parallel.",
    "- Never put a tool call inside a markdown code fence, and write no prose",
    "  around it — the block itself is the whole message.",
    "- Tool results come back inside <tool_response></tool_response>; use them to answer.",
    "- Only call a function when it is actually needed. Answer directly otherwise.",
  ];

  const forced = toolChoiceName(toolChoice);
  if (toolChoice === "required") lines.push("- You MUST call a function now, not answer directly.");
  if (forced) lines.push(`- You MUST call the ${JSON.stringify(forced)} function now, not answer directly.`);

  return lines.join("\n");
}

// Render one OpenAI tool_call back into the `<tool_call>` text convention.
function renderCall(tc: any): string {
  const name = tc?.function?.name ?? tc?.name ?? "";
  let args = tc?.function?.arguments ?? tc?.arguments ?? {};
  if (typeof args !== "string") {
    args = JSON.stringify(args ?? {});
  } else {
    try {
      JSON.parse(args); // already JSON — embed as-is
    } catch {
      args = JSON.stringify(args); // not JSON — quote it
    }
  }
  return `<tool_call>\n{"name": ${JSON.stringify(name)}, "arguments": ${args}}\n</tool_call>`;
}

// Convert an OpenAI message list (which may contain assistant tool_calls and
// role:"tool" results) into plain role+text messages the prompt builder handles,
// then append the tool-protocol system section. The caller's own system prompt is
// preserved — the tool section is added, never substituted.
export function preprocessToolMessages(messages: any[], tools: OAITool[], toolChoice: any): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m?.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const calls = m.tool_calls.map(renderCall).join("\n");
      const text = typeof m.content === "string" ? m.content : "";
      out.push({ role: "assistant", content: (text ? text + "\n" : "") + calls });
    } else if (m?.role === "tool") {
      const body = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      const nameHint = m.name ? ` name="${m.name}"` : "";
      out.push({ role: "user", content: `<tool_response${nameHint}>\n${body}\n</tool_response>` });
    } else {
      out.push(m);
    }
  }
  // Tool protocol goes last in the system group (after any user system prompt).
  out.push({ role: "system", content: toolSystemPrompt(tools, toolChoice) });
  return out;
}

/* ---------------------------------------------------------------------------
   JSON: scanning and repair
   --------------------------------------------------------------------------- */

/**
 * Index just past the object starting at `start`, or -1 if it never closes.
 * String- and escape-aware, so braces inside string values don't fool it.
 * The old code took first-`{` to last-`}`, which broke on trailing prose and on
 * two objects in one block.
 */
function scanObject(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Progressively repair the near-JSON models actually emit. */
function repairJson(src: string): any | null {
  const attempts: string[] = [];
  let s = src.trim();
  attempts.push(s);

  // Smart quotes — usually picked up when the model formats as prose.
  s = s.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'");
  attempts.push(s);

  // Python-flavoured literals, only as standalone tokens.
  s = s.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null");
  attempts.push(s);

  // Trailing commas before a closer.
  s = s.replace(/,\s*([}\]])/g, "$1");
  attempts.push(s);

  // Single-quoted keys and values -> double-quoted. Done last because it is the
  // most invasive; only reached when everything above still fails to parse.
  s = s.replace(/'((?:[^'\\]|\\.)*)'/g, (_m, inner) => `"${inner.replace(/"/g, '\\"')}"`);
  attempts.push(s);

  // Literal newlines inside strings.
  s = s.replace(/"((?:[^"\\]|\\.)*)"/g, (m) => (m.includes("\n") ? m.replace(/\n/g, "\\n") : m));
  attempts.push(s);

  for (const a of attempts) {
    try {
      return JSON.parse(a);
    } catch {
      /* try the next repair */
    }
  }
  return null;
}

/** Every top-level JSON object in `s`, in order. */
function objectsIn(s: string): any[] {
  const out: any[] = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf("{", i);
    if (open === -1) break;
    const end = scanObject(s, open);
    if (end === -1) {
      // Unterminated tail — the stream was cut off. Try to repair what's there.
      const obj = repairJson(s.slice(open));
      if (obj) out.push(obj);
      break;
    }
    const obj = repairJson(s.slice(open, end));
    if (obj) out.push(obj);
    i = end;
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Arguments: coercion against the declared schema
   --------------------------------------------------------------------------- */

function coerceValue(v: any, schema: any): any {
  if (!schema || v == null) return v;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  if (type === "number" || type === "integer") {
    if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) {
      const n = Number(v);
      return type === "integer" ? Math.trunc(n) : n;
    }
    return v;
  }
  if (type === "boolean") {
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (t === "true" || t === "yes" || t === "1") return true;
      if (t === "false" || t === "no" || t === "0") return false;
    }
    return v;
  }
  if (type === "array") {
    let arr = v;
    if (typeof arr === "string") {
      const parsed = repairJson(arr);
      arr = Array.isArray(parsed) ? parsed : [arr]; // a lone scalar is a 1-element list
    } else if (!Array.isArray(arr)) {
      arr = [arr];
    }
    return schema.items ? arr.map((x: any) => coerceValue(x, schema.items)) : arr;
  }
  if (type === "object") {
    let obj = v;
    if (typeof obj === "string") {
      const parsed = repairJson(obj);
      if (parsed && typeof parsed === "object") obj = parsed;
    }
    if (obj && typeof obj === "object" && schema.properties) {
      for (const [k, sub] of Object.entries<any>(schema.properties)) {
        if (k in obj) obj[k] = coerceValue(obj[k], sub);
      }
    }
    return obj;
  }
  if (type === "string" && typeof v !== "string" && typeof v !== "object") return String(v);
  return v;
}

function coerceArgs(args: any, schema: any): Record<string, any> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  if (!schema?.properties) return args;
  for (const [k, sub] of Object.entries<any>(schema.properties)) {
    if (k in args) args[k] = coerceValue(args[k], sub);
  }
  return args;
}

/* ---------------------------------------------------------------------------
   Object -> validated tool call
   --------------------------------------------------------------------------- */

/**
 * Build a tool call from one parsed object, or null if it isn't one.
 * `null` is the safe answer: the caller renders the text verbatim instead.
 */
function callFrom(obj: any, reg: Registry): OAIToolCall | null {
  if (!obj || typeof obj !== "object") return null;

  // OpenAI's own wire shape, in case the model mirrors it back.
  const fn = obj.function && typeof obj.function === "object" ? obj.function : null;
  const rawName = fn?.name ?? obj.name ?? obj.tool_name ?? obj.tool ?? (typeof obj.function === "string" ? obj.function : null);
  if (!rawName || typeof rawName !== "string") return null;

  // The registry is the gate: unknown name -> not a tool call.
  const name = reg.byNorm.get(normName(rawName)) ?? (reg.permissive ? rawName.trim() : undefined);
  if (!name) return null;

  let args = fn?.arguments ?? obj.arguments ?? obj.parameters ?? obj.args ?? obj.input;

  // Double-encoded: "arguments": "{\"city\":\"Paris\"}"
  if (typeof args === "string") {
    const parsed = repairJson(args);
    args = parsed && typeof parsed === "object" ? parsed : {};
  }

  // Hoisted: {"name":"get_weather","city":"Paris"} — arguments sit at the top
  // level. Only trust keys the schema actually declares, so protocol keys and
  // stray prose fields can't leak into the call.
  if (!args || typeof args !== "object") {
    const props = reg.schemas.get(name)?.properties || {};
    const picked: Record<string, any> = {};
    for (const k of Object.keys(props)) if (k in obj) picked[k] = obj[k];
    args = picked;
  }

  const coerced = coerceArgs(args, reg.schemas.get(name));
  return { id: newId(), type: "function", function: { name, arguments: JSON.stringify(coerced) } };
}

/** All valid calls in a `<tool_call>` body (models sometimes pack in two). */
function callsInBlock(body: string, reg: Registry): OAIToolCall[] {
  const out: OAIToolCall[] = [];
  for (const obj of objectsIn(body)) {
    if (Array.isArray(obj?.tool_calls)) {
      for (const item of obj.tool_calls) {
        const c = callFrom(item, reg);
        if (c) out.push(c);
      }
      continue;
    }
    const c = callFrom(obj, reg);
    if (c) out.push(c);
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Tool policy — the guarantees the request asked for.
   --------------------------------------------------------------------------- */

/**
 * Apply the caller's tool options to what the model actually produced.
 *
 * Agentic clients (Codex, OpenCode, and anything built on the OpenAI SDK) treat
 * these as guarantees rather than hints, and act on the result without
 * re-checking it. Prompting for them is not enough — the prompt is a request,
 * this is the contract:
 *
 *   tool_choice: {function:{name}}   only that tool may come back
 *   parallel_tool_calls: false       at most one call per turn
 *   strict / additionalProperties    arguments carry no keys the schema
 *                                    did not declare
 *
 * Nothing is invented here. A call is only ever dropped or trimmed, never
 * synthesised, so this can make a reply more compliant but never less true.
 */
export function applyToolPolicy(
  calls: OAIToolCall[],
  body: any,
  reg: Registry
): OAIToolCall[] {
  let out = calls;

  // A named tool_choice means the caller will only accept that tool.
  const forced = toolChoiceName(body?.tool_choice);
  if (forced) {
    const canonical = reg.byNorm.get(normName(forced)) ?? forced;
    out = out.filter((c) => c.function.name === canonical);
  }

  // parallel_tool_calls:false — clients that set it often cannot execute a
  // second call and will error on the whole response.
  if (body?.parallel_tool_calls === false && out.length > 1) out = out.slice(0, 1);

  // Strict schemas promise no undeclared keys.
  out = out.map((c) => {
    const schema = reg.schemas.get(c.function.name);
    const tool = (body?.tools || []).find((t: OAITool) => t?.function?.name === c.function.name);
    const strict = tool?.function?.strict === true || schema?.additionalProperties === false;
    if (!strict || !schema?.properties) return c;

    let args: any;
    try {
      args = JSON.parse(c.function.arguments || "{}");
    } catch {
      return c;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) return c;

    const allowed = new Set(Object.keys(schema.properties));
    const pruned: Record<string, any> = {};
    for (const [k, v] of Object.entries(args)) if (allowed.has(k)) pruned[k] = v;
    if (Object.keys(pruned).length === Object.keys(args).length) return c;
    return { ...c, function: { ...c.function, arguments: JSON.stringify(pruned) } };
  });

  return out;
}

/* ---------------------------------------------------------------------------
   The state machine
   --------------------------------------------------------------------------- */

const OPEN = "<tool_call";
const CLOSE = "</tool_call>";
const FENCE = "```";
// Sentinels we must not emit half of, in case a chunk boundary splits one.
const SENTINELS = [OPEN, CLOSE, FENCE];

/** Longest suffix of `s` that is a proper prefix of any sentinel. */
function partialTail(s: string): number {
  let best = 0;
  for (const tag of SENTINELS) {
    const max = Math.min(s.length, tag.length - 1);
    for (let k = max; k > best; k--) {
      if (s.slice(s.length - k) === tag.slice(0, k)) {
        best = k;
        break;
      }
    }
  }
  return best;
}

type State = "text" | "tag" | "call" | "fence" | "json";

const HOLD_CAP = 64 * 1024; // give up holding text back past this

/**
 * Incremental extractor. `push` returns text that is safe to show the user;
 * `end` returns the trailing text plus every call found.
 *
 * A code fence whose content might be a tool call is held back until it closes,
 * then either parsed or released verbatim — that's what stops a fenced *example*
 * from being executed while still catching a model that fenced a real call.
 * Fences that can't be tool calls (```python, ```js …) stream through untouched,
 * so watching code appear still works.
 */
export class ToolStream {
  private reg: Registry;
  private state: State = "text";
  private hold = ""; // possible split sentinel
  private buf = ""; // current block/fence body
  private fenceInfo = "";
  private calls: OAIToolCall[] = [];
  private emitted = false;
  private triedBareJson = false;

  constructor(tools: OAITool[] | Registry) {
    this.reg = Array.isArray(tools) ? buildRegistry(tools) : (tools as Registry);
  }

  get toolCalls(): OAIToolCall[] {
    return this.calls;
  }

  /** Reconstruct the fence opener we swallowed, for releasing text verbatim. */
  private openFence(): string {
    return FENCE + (this.fenceInfo === "plain" ? "" : this.fenceInfo) + "\n";
  }

  push(chunk: string): string {
    let out = "";
    let s = this.hold + chunk;
    this.hold = "";

    while (s.length) {
      if (this.state === "text") {
        // A reply that opens with `{` may be a bare JSON envelope from a model
        // that ignored the XML protocol. Hold it until it closes, then decide.
        // Only ever attempted at the very start, so mid-reply JSON in prose is
        // never swallowed.
        if (!this.emitted && !this.triedBareJson) {
          const lead = s.trimStart();
          if (lead === "") { this.hold = s; s = ""; continue; }
          if (lead[0] === "{") {
            this.triedBareJson = true;
            this.state = "json";
            this.buf = "";
            s = lead;
            continue;
          }
          this.triedBareJson = true;
        }

        const iOpen = s.indexOf(OPEN);
        const iFence = s.indexOf(FENCE);
        // Whichever sentinel comes first wins.
        let i = -1;
        let which: "open" | "fence" | null = null;
        if (iOpen !== -1 && (iFence === -1 || iOpen < iFence)) { i = iOpen; which = "open"; }
        else if (iFence !== -1) { i = iFence; which = "fence"; }

        if (which === null) {
          const keep = partialTail(s);
          const text = s.slice(0, s.length - keep);
          if (text) { out += text; this.emitted = true; }
          this.hold = s.slice(s.length - keep);
          s = "";
        } else if (which === "open") {
          const text = s.slice(0, i);
          if (text) { out += text; this.emitted = true; }
          this.state = "tag";
          s = s.slice(i + OPEN.length);
        } else {
          const text = s.slice(0, i);
          if (text) { out += text; this.emitted = true; }
          this.state = "fence";
          this.buf = "";
          this.fenceInfo = "";
          s = s.slice(i + FENCE.length);
        }
      } else if (this.state === "json") {
        this.buf += s;
        s = "";
        const end = scanObject(this.buf, 0);
        if (end === -1) {
          if (this.buf.length > HOLD_CAP) {
            out += this.buf;
            this.emitted = true;
            this.buf = "";
            this.state = "text";
          }
          continue;
        }
        const found = callsInBlock(this.buf.slice(0, end), this.reg);
        if (found.length) {
          this.calls.push(...found);
        } else {
          out += this.buf.slice(0, end);
          this.emitted = true;
        }
        s = this.buf.slice(end);
        this.buf = "";
        this.state = "text";
      } else if (this.state === "tag") {
        // Consume the rest of the opening tag, tolerating attributes.
        const gt = s.indexOf(">");
        if (gt === -1) { this.hold = s; s = ""; }
        else { this.state = "call"; this.buf = ""; s = s.slice(gt + 1); }
      } else if (this.state === "call") {
        const j = s.indexOf(CLOSE);
        if (j === -1) {
          const keep = partialTail(s);
          this.buf += s.slice(0, s.length - keep);
          this.hold = s.slice(s.length - keep);
          s = "";
          // A block that never closes and grows without bound is a runaway;
          // release it as text rather than swallowing the whole reply.
          if (this.buf.length > HOLD_CAP) {
            out += OPEN + ">" + this.buf;
            this.emitted = true;
            this.buf = "";
            this.state = "text";
          }
        } else {
          this.buf += s.slice(0, j);
          const found = callsInBlock(this.buf, this.reg);
          if (found.length) this.calls.push(...found);
          // Not a real call after all (an example, a hallucinated name) — put it
          // back verbatim so the caller sees exactly what the model wrote.
          else { out += OPEN + ">" + this.buf + CLOSE; this.emitted = true; }
          this.buf = "";
          this.state = "text";
          s = s.slice(j + CLOSE.length);
        }
      } else {
        // fence — read the info string first, then decide whether to hold.
        if (this.fenceInfo === "") {
          const nl = s.indexOf("\n");
          if (nl === -1) { this.hold = s; s = ""; continue; }
          this.fenceInfo = s.slice(0, nl).trim().toLowerCase() || "plain";
          s = s.slice(nl + 1);
          // ```python, ```ts … can't be a tool call: stream it straight through.
          if (!["plain", "json", "tool_call", "tool_calls"].includes(this.fenceInfo)) {
            out += this.openFence();
            this.emitted = true;
            this.state = "text";
          }
          continue;
        }

        const k = s.indexOf(FENCE);
        const body = k === -1 ? s : s.slice(0, k);
        // As soon as we can see the first real character, a body that doesn't
        // start with `{` can't be a call — release it and stop holding, so an
        // ordinary untagged code block still streams.
        const probe = (this.buf + body).trimStart();
        if (probe && probe[0] !== "{") {
          out += this.openFence() + this.buf + body;
          this.emitted = true;
          this.buf = "";
          this.state = "text";
          s = k === -1 ? "" : s.slice(k);
          continue;
        }

        if (k === -1) {
          const keep = partialTail(s);
          this.buf += s.slice(0, s.length - keep);
          this.hold = s.slice(s.length - keep);
          s = "";
          if (this.buf.length > HOLD_CAP) {
            out += this.openFence() + this.buf;
            this.emitted = true;
            this.buf = "";
            this.state = "text";
          }
        } else {
          this.buf += body;
          // A fenced call only counts when the fence *is* the reply. Prose before
          // it means the model is explaining the format, not invoking it — the
          // protocol says a real call carries no prose around it.
          const found = this.emitted ? [] : callsInBlock(this.buf, this.reg);
          if (found.length) this.calls.push(...found);
          else {
            out += this.openFence() + this.buf + FENCE;
            this.emitted = true;
          }
          this.buf = "";
          this.state = "text";
          s = s.slice(k + FENCE.length);
        }
      }
    }
    return out;
  }

  /** Flush. Handles a reply cut off mid-block, which Qwen does at the 300s cap. */
  end(): { text: string; toolCalls: OAIToolCall[] } {
    let out = "";
    const tail = this.buf + this.hold;
    this.buf = "";
    this.hold = "";

    if (this.state === "call" || this.state === "fence" || this.state === "json") {
      // Cut off mid-block — Qwen does this at the 300s cap. Repair what's there.
      const found = callsInBlock(tail, this.reg);
      if (found.length) this.calls.push(...found);
      else if (tail) out += tail;
    } else if (tail) {
      out += tail;
    }

    // Last resort: the model ignored the protocol and replied with a bare JSON
    // envelope. Only consulted when nothing else matched and nothing has been
    // shown yet, so it can't retroactively delete text a reader already saw.
    if (this.calls.length === 0 && !this.emitted) {
      const found = callsInBlock(out, this.reg);
      if (found.length) {
        this.calls.push(...found);
        out = "";
      }
    }
    return { text: out, toolCalls: this.calls };
  }
}

/* ---------------------------------------------------------------------------
   Buffered entry point — the same machine, fed in one go.
   --------------------------------------------------------------------------- */

export function extractToolCalls(raw: string, tools: OAITool[] | Registry): { content: string | null; toolCalls: OAIToolCall[] } {
  if (!raw) return { content: "", toolCalls: [] };
  const s = new ToolStream(tools);
  const text = s.push(raw);
  const fin = s.end();
  const content = (text + fin.text).trim();
  return { content: fin.toolCalls.length ? content || null : content, toolCalls: fin.toolCalls };
}

/**
 * Back-compat wrapper. Without a tool list there is no registry to validate
 * against, so this can only accept every well-formed block — the permissive
 * behaviour this module used to have everywhere. Prefer `extractToolCalls`.
 */
export function parseToolCalls(raw: string, tools?: OAITool[]): { content: string | null; toolCalls: OAIToolCall[] } {
  if (tools?.length) return extractToolCalls(raw, tools);
  return extractToolCalls(raw, { names: [], byNorm: new Map(), schemas: new Map(), permissive: true });
}
