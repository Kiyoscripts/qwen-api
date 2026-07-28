// OneCompiler streams RAW TEXT, not SSE — despite a `text/event-stream` content
// type there are no `data:` prefixes, no JSON envelope and no terminator. So the
// two things worth pinning down are the opposite of a parser's usual risks:
//
//  1. Bytes must survive chunking exactly, including multi-byte characters split
//     across a read boundary. Decoding each chunk independently mangles them.
//  2. Upstream reports failure as HTTP 200 with a plain sentence as the whole
//     body, so the sentinel check is the only thing standing between the caller
//     and an "answer" that reads "Please login to use this feature." — while a
//     real answer that happens to start with those words must still get through.

import {
  oneCompilerDeltas,
  openCompletion,
  OneCompilerError,
  isOneCompilerModel,
  splitConversation,
  ONECOMPILER_MODELS,
} from "../lib/onecompiler.ts";
import { isOneCompilerTokenFailure } from "../lib/onecompilerTokens.ts";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Feed raw bytes through the reader, optionally split into fixed-size chunks. */
async function collect(raw: string, chunkSize = 0) {
  const bytes = new TextEncoder().encode(raw);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (chunkSize <= 0) {
        controller.enqueue(bytes);
      } else {
        for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
  const out: string[] = [];
  for await (const d of oneCompilerDeltas(new Response(stream) as any)) out.push(d.text);
  return out.join("");
}

const ANSWER = "## Counting\n\n1. one\n2. two\n";

// 1. The body passes through verbatim.
{
  check("raw text is forwarded unchanged", (await collect(ANSWER)) === ANSWER);
}

// 2. Chunking must not alter a single byte. Size 1 splits every multi-byte
//    character, which is exactly where a naive decode loses data.
{
  const UNICODE = "café ☕ — 日本語 🎉 done";
  for (const size of [1, 2, 3, 5, 17]) {
    check(`unicode survives ${size}-byte chunking`, (await collect(UNICODE, size)) === UNICODE, JSON.stringify(await collect(UNICODE, size)));
  }
  check("markdown survives 1-byte chunking", (await collect(ANSWER, 1)) === ANSWER);
}

// 3. Plain-text error bodies returned as HTTP 200 must raise, not be handed back
//    to the caller as if the model had said them.
{
  for (const [body, status] of [
    // Verbatim from upstream — both of these were observed in real responses.
    ["Please login to use this feature.", 401],
    [
      "You have reached the daily limit for AI interactions.\nPlease upgrade to a paid plan to continue using this feature.",
      429,
    ],
    // Defensive.
    ["Unauthorized", 401],
    ["Please upgrade to continue.", 402],
    ["You have reached your daily limit.", 429],
  ] as const) {
    let threw: any = null;
    try {
      await collect(body);
    } catch (e) {
      threw = e;
    }
    check(`"${body.slice(0, 24)}…" raises`, threw instanceof OneCompilerError, String(threw));
    check(`…with status ${status}`, threw?.status === status, String(threw?.status));
  }
}

// 4. The guard must not eat real output. A genuine answer can open with the same
//    words — length is what separates a sentinel body from a real reply.
{
  const long = "Please login to your account first, then follow these steps: " + "step. ".repeat(60);
  const got = await collect(long);
  check("a long answer beginning with a sentinel phrase is NOT swallowed", got === long);
}

// 5. Only the first chunk is tested, so a sentinel phrase appearing later in a
//    normal answer is just text.
{
  const body = "Here is the fix.\n\nUnauthorized access is handled in auth.ts.";
  check("sentinel phrase mid-answer is passed through", (await collect(body, 4)) === body);
}

// --- conversation split -----------------------------------------------------
{
  const { conversation, currentMessage } = splitConversation([
    { role: "system", content: "Be terse." },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "and now?" },
  ]);
  check("prior turns become conversation", conversation.length === 2, String(conversation.length));
  check("roles are preserved", conversation[0].role === "user" && conversation[1].role === "assistant");
  check("last user turn becomes currentMessage", currentMessage.endsWith("and now?"), currentMessage);
  // An ignored system prompt is worse than a visible one: the caller's
  // instructions would simply not apply.
  check("system prompt is folded into currentMessage", currentMessage.includes("Be terse."), currentMessage);
  check("system prompt is not left in conversation", !conversation.some((m) => m.content.includes("Be terse.")));

  const empty = splitConversation([{ role: "user", content: "solo" }]);
  check("single turn leaves conversation empty", empty.conversation.length === 0);
  check("single turn is the currentMessage", empty.currentMessage === "solo");
}

// --- registry ---------------------------------------------------------------
// The routing guarantee: exact match only. A prefix test would let
// "deepseek/deepseek-v4-pro" be claimed by the DeepSeek provider's
// startsWith("deepseek") check before this one ever sees it.
{
  check("known free model is claimed", isOneCompilerModel("deepseek/deepseek-v4-pro"));
  check("bare deepseek id is NOT claimed", !isOneCompilerModel("deepseek-v4-pro"));
  check("unknown id is not claimed", !isOneCompilerModel("openai/gpt-5.4-mini-turbo"));

  // Premium models must never appear in the registry: presence here is what makes
  // them reachable, so this is the check that keeps the paid tier out.
  const PREMIUM = [
    "openai/gpt-5.3-codex",
    "openai/gpt-5.5",
    "openai/gpt-5.6-sol",
    "anthropic/claude-opus-4.8",
    "anthropic/claude-sonnet-5",
    "anthropic/claude-haiku-4.5",
  ];
  const leaked = PREMIUM.filter((id) => isOneCompilerModel(id));
  check("no premium model is exposed", leaked.length === 0, leaked.join(", "));
  check("every id carries a maker prefix", ONECOMPILER_MODELS.every((m) => m.id.includes("/")));
  check("registry has no duplicate ids", new Set(ONECOMPILER_MODELS.map((m) => m.id)).size === ONECOMPILER_MODELS.length);
  check("registry has the 10 free models", ONECOMPILER_MODELS.length === 10, String(ONECOMPILER_MODELS.length));
}

// --- open-time sentinel detection (what makes token failover possible) ------
// A spent account answers HTTP 200 and only gives itself away in the body, so
// openCompletion must find it BEFORE returning — otherwise the pool can never
// rotate away from a capped account. And having peeked, it must hand back a
// stream that still contains the peeked bytes exactly once.
{
  const realFetch = globalThis.fetch;
  const serve = (body: string, chunkSize = 0) => {
    globalThis.fetch = (async () => {
      const bytes = new TextEncoder().encode(body);
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          if (chunkSize <= 0) c.enqueue(bytes);
          else for (let i = 0; i < bytes.length; i += chunkSize) c.enqueue(bytes.slice(i, i + chunkSize));
          c.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as any;
  };

  try {
    // Capped account: must throw at OPEN, with a status the pool recognises.
    serve("You have reached the daily limit for AI interactions.\nPlease upgrade to a paid plan to continue using this feature.");
    let threw: any = null;
    try {
      await openCompletion({ model: "openai/gpt-5.4-mini", messages: [{ role: "user", content: "hi" }], token: "t" });
    } catch (e) {
      threw = e;
    }
    check("capped account throws at stream open", threw instanceof OneCompilerError, String(threw));
    check("…with 429 so the pool fails over", threw?.status === 429, String(threw?.status));
    check("…and the pool's matcher agrees", isOneCompilerTokenFailure(threw?.message ?? "", threw?.status));

    // Healthy account: the peeked first chunk must be replayed, not lost or doubled.
    for (const size of [0, 1, 4, 64]) {
      serve(ANSWER, size);
      const res = await openCompletion({ model: "openai/gpt-5.4-mini", messages: [{ role: "user", content: "hi" }], token: "t" });
      let got = "";
      for await (const d of oneCompilerDeltas(res)) got += d.text;
      check(`peeked chunk is replayed intact (chunk=${size || "whole"})`, got === ANSWER, JSON.stringify(got));
    }

    // A missing token must fail before any network call is attempted.
    let noTok: any = null;
    try {
      await openCompletion({ model: "openai/gpt-5.4-mini", messages: [{ role: "user", content: "hi" }], token: "" });
    } catch (e) {
      noTok = e;
    }
    check("missing token fails fast with 402", noTok?.status === 402, String(noTok?.status));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// --- pool failure matcher ---------------------------------------------------
// Over-broad matching is the expensive mistake: it would burn every account in
// the pool retrying an error that was never about the account.
{
  check("daily cap is a token failure", isOneCompilerTokenFailure("You have reached the daily limit for AI interactions."));
  check("login sentinel is a token failure", isOneCompilerTokenFailure("Please login to use this feature."));
  check("429 status is a token failure", isOneCompilerTokenFailure("whatever", 429));
  check("a 400 bad-request is NOT", !isOneCompilerTokenFailure("Invalid model id", 400));
  check("a network error is NOT", !isOneCompilerTokenFailure("Could not reach https://onecompiler.com: ECONNRESET"));
}

console.log(`onecompiler.stream: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
