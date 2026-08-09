// Recognising a continuation of a conversation Qwen already holds.
//
// Qwen keeps the thread server-side, so a follow-up only needs the new turn —
// verified against the live endpoint, where turn two carried one message instead
// of four and still answered from turn one's context. An OpenAI-shaped API is
// stateless though: the client re-sends everything and never says which
// conversation it is. This module has to recognise it from the transcript alone.
//
// A miss is always safe (send the transcript in full). A false HIT is not: it
// would answer against someone else's thread. So the tests below lean on the
// cases where a key must NOT match.

import { findSession, saveSession, forgetSession, conversationKey, _clearSessions, _sessionCount } from "../lib/qwenSessions.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const S = { chatId: "chat-1", responseId: "resp-1", entryId: "acct-1" };
const sys = { role: "system", content: "You are helpful." } as any;
const u1 = { role: "user", content: "My secret word is banana." } as any;
const a1 = { role: "assistant", content: "Acknowledged." } as any;
const u2 = { role: "user", content: "What is my secret word?" } as any;

// 1. The round trip: what we saved after turn one is found on turn two.
{
  _clearSessions();
  saveSession([sys, u1], "Acknowledged.", "qwen3.8-max", S);
  const hit = findSession([sys, u1, a1, u2], "qwen3.8-max");
  check("continuation is found", hit !== null);
  check("carries the chat", hit?.chatId === "chat-1", String(hit?.chatId));
  check("carries the parent for the next turn", hit?.responseId === "resp-1");
  check("carries the owning account", hit?.entryId === "acct-1");
}

// 2. A first turn has no prior thread, and must never match one.
{
  _clearSessions();
  saveSession([sys, u1], "Acknowledged.", "qwen3.8-max", S);
  check("single message never resumes", findSession([u1], "qwen3.8-max") === null);
  check("empty never resumes", findSession([], "qwen3.8-max") === null);
}

// 3. A different model is a different thread — Qwen chats are per model, and
//    resuming across them would answer with the wrong one.
{
  _clearSessions();
  saveSession([sys, u1], "Acknowledged.", "qwen3.8-max", S);
  check("model is part of identity", findSession([sys, u1, a1, u2], "qwen3.7-plus") === null);
}

// 4. An edited transcript must miss. Clients rewrite history — compaction,
//    a resent turn, a system prompt tweak — and resuming then would answer
//    against a thread that no longer reflects what the client believes.
{
  _clearSessions();
  saveSession([sys, u1], "Acknowledged.", "qwen3.8-max", S);
  const editedSystem = [{ role: "system", content: "You are terse." }, u1, a1, u2] as any;
  check("edited system prompt misses", findSession(editedSystem, "qwen3.8-max") === null);
  const editedReply = [sys, u1, { role: "assistant", content: "Sure thing." }, u2] as any;
  check("edited assistant reply misses", findSession(editedReply, "qwen3.8-max") === null);
}

// 5. Role matters: the same text from a user and an assistant are different
//    conversations, and hashing content alone would conflate them.
{
  const asUser = conversationKey([{ role: "user", content: "hello" }] as any, "m");
  const asAssistant = conversationKey([{ role: "assistant", content: "hello" }] as any, "m");
  check("role is part of the key", asUser !== asAssistant);
}

// 6. Boundaries cannot be smeared: two messages must not hash the same as one
//    message holding their concatenation.
{
  const split = conversationKey([{ role: "user", content: "foo" }, { role: "user", content: "bar" }] as any, "m");
  const joined = conversationKey([{ role: "user", content: "foobar" }] as any, "m");
  check("message boundaries are preserved", split !== joined);
}

// 7. Multi-part content is flattened the same way on both sides, so a vision
//    turn still matches itself.
{
  _clearSessions();
  const multi = { role: "user", content: [{ type: "text", text: "describe this" }] } as any;
  saveSession([sys, multi], "A cat.", "qwen3.8-max", S);
  const hit = findSession([sys, multi, { role: "assistant", content: "A cat." }, u2] as any, "qwen3.8-max");
  check("multi-part content matches", hit !== null);
}

// 8. Forgetting drops every key pointing at that chat, so a dead thread cannot
//    be resumed from an older turn either.
{
  _clearSessions();
  saveSession([sys, u1], "Acknowledged.", "qwen3.8-max", S);
  const hit = findSession([sys, u1, a1, u2], "qwen3.8-max")!;
  forgetSession(hit);
  check("forgotten thread is gone", findSession([sys, u1, a1, u2], "qwen3.8-max") === null);
  check("store is empty after forget", _sessionCount() === 0, String(_sessionCount()));
}

// 9. Incomplete sessions are not stored — without a response id there is no
//    parent to quote, so a "hit" would be unusable.
{
  _clearSessions();
  saveSession([sys, u1], "x", "qwen3.8-max", { chatId: "c", responseId: "", entryId: "a" });
  check("no response id is not stored", _sessionCount() === 0);
  saveSession([sys, u1], "x", "qwen3.8-max", { chatId: "", responseId: "r", entryId: "a" });
  check("no chat id is not stored", _sessionCount() === 0);
}

_clearSessions();
console.log(`qwensessions: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
