// Built-in demo tools for the /chat and /playground testers. These execute in the
// browser, so a user can toggle "Tools" on and watch a full call loop run end to
// end without writing any schemas or result payloads by hand.
//
// They're deliberately deterministic (get_weather is fake) so it's obvious the
// model's answer is coming from the tool result, not its own knowledge.

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export const DEMO_TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "Get the current date and time in a given IANA timezone.",
      parameters: {
        type: "object",
        properties: { timezone: { type: "string", description: 'IANA timezone, e.g. "America/New_York" or "Asia/Tokyo".' } },
        required: ["timezone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Evaluate a basic arithmetic expression (+, -, *, /, parentheses).",
      parameters: {
        type: "object",
        properties: { expression: { type: "string", description: 'e.g. "(12 + 5) * 3".' } },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a city. (Demo: returns simulated data.)",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name." },
          unit: { type: "string", enum: ["celsius", "fahrenheit"], description: "Temperature unit." },
        },
        required: ["city"],
      },
    },
  },
];

export const DEMO_TOOL_NAMES = new Set(DEMO_TOOLS.map((t) => t.function.name));

// Evaluate arithmetic safely — no eval(), only digits and + - * / ( ) . operators.
function safeCalc(expr: string): number {
  const cleaned = String(expr).replace(/\s+/g, "");
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) throw new Error("Only numbers and + - * / ( ) are allowed.");
  // Shunting-yard to RPN, then evaluate. Keeps us away from eval entirely.
  const out: (number | string)[] = [];
  const ops: string[] = [];
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const tokens = cleaned.match(/(\d+\.?\d*|[+\-*/()])/g) || [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d/.test(t)) out.push(parseFloat(t));
    else if (t === "(") ops.push(t);
    else if (t === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()!);
      if (!ops.length) throw new Error("Mismatched parentheses.");
      ops.pop();
    } else {
      // unary minus/plus
      const prevTok = tokens[i - 1];
      if ((t === "-" || t === "+") && (i === 0 || prevTok === "(" || "+-*/".includes(prevTok))) out.push(0);
      while (ops.length && ops[ops.length - 1] !== "(" && prec[ops[ops.length - 1]] >= prec[t]) out.push(ops.pop()!);
      ops.push(t);
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") throw new Error("Mismatched parentheses.");
    out.push(op);
  }
  const st: number[] = [];
  for (const tok of out) {
    if (typeof tok === "number") st.push(tok);
    else {
      const b = st.pop()!, a = st.pop()!;
      st.push(tok === "+" ? a + b : tok === "-" ? a - b : tok === "*" ? a * b : a / b);
    }
  }
  if (st.length !== 1 || !Number.isFinite(st[0])) throw new Error("Could not evaluate expression.");
  return st[0];
}

// Deterministic fake weather so the tool result is clearly the source of the answer.
function fakeWeather(city: string, unit?: string) {
  let h = 0;
  for (const ch of String(city)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const conditions = ["sunny", "cloudy", "rainy", "snowy", "windy", "foggy"];
  const condition = conditions[h % conditions.length];
  const tempC = (h % 35) - 5; // -5..29 °C
  const fahrenheit = unit === "fahrenheit";
  return {
    city,
    condition,
    temperature: fahrenheit ? Math.round((tempC * 9) / 5 + 32) : tempC,
    unit: fahrenheit ? "fahrenheit" : "celsius",
    humidity: `${40 + (h % 55)}%`,
    note: "simulated demo data",
  };
}

// Run a demo tool by name. Returns a JSON-serializable result (or an { error }).
export function runDemoTool(name: string, args: any): unknown {
  try {
    if (name === "get_current_time") {
      const tz = args?.timezone || "UTC";
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        dateStyle: "full",
        timeStyle: "long",
      }).format(now);
      return { timezone: tz, datetime: formatted, iso: now.toISOString() };
    }
    if (name === "calculator") {
      return { expression: args?.expression, result: safeCalc(args?.expression ?? "") };
    }
    if (name === "get_weather") {
      return fakeWeather(args?.city ?? "", args?.unit);
    }
    return { error: `Unknown demo tool: ${name}` };
  } catch (e: any) {
    return { error: e?.message || "tool execution failed" };
  }
}
