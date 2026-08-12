// chatglm.cn: request signing, the thinking-mode mapping, message conversion,
// and the cumulative-snapshot stream parser.
//
// The signature test is the important one. It pins the algorithm against a
// timestamp/nonce/sign triple captured from a real request the site made, so if
// chatglm.cn rotates the salt or changes the hash, this fails loudly here
// rather than as a mystery 40001 in production.

import {
  chatglmStamp,
  chatglmSign,
  chatglmDeltas,
  emptyChatGLMSummary,
  toChatGLMMessages,
  resolveChatMode,
  isChatGLMModel,
  chatglmModels,
  resolveChatGLMModel,
  chatglmImageModel,
  ChatGLMError,
  CHATGLM_MODELS,
  CHATGLM_FAST,
  CHATGLM_THINKING,
  CHATGLM_DEEP,
} from "../lib/chatglm.ts";

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

// --- signing ----------------------------------------------------------------

// 1. Captured from a live request by the site itself.
{
  const ts = "1786536479004";
  const nonce = "1b26c427f597461e908e60cc983f5326";
  check(
    "sign matches a real captured request",
    chatglmSign(ts, nonce) === "114de21bd7acb4def173c0f4b339e908",
    chatglmSign(ts, nonce)
  );
}

// 2. That same timestamp is a fixed point of the mangling rule, which is what
//    makes it a valid sample to pin against.
{
  check("captured timestamp is self-consistent", chatglmStamp(1786536479004) === "1786536479004");
}

// 3. The rule: digit 11 becomes (sum of all digits − that digit) % 10.
{
  const out = chatglmStamp(1234567890123);
  const d = "1234567890123".split("").map(Number);
  const want = (d.reduce((a, b) => a + b, 0) - d[11]) % 10;
  check("length is preserved", out.length === 13, out);
  check("first 11 digits untouched", out.slice(0, 11) === "12345678901", out);
  check("last digit untouched", out.slice(12) === "3", out);
  check("checksum digit is correct", out[11] === String(want), `${out} want ${want}`);
}

// --- thinking modes ---------------------------------------------------------

// 4. The site's three composer modes. Fast is the empty string, deliberately.
{
  check("default is Fast", resolveChatMode({}) === CHATGLM_FAST);
  check("Fast is the empty string", CHATGLM_FAST === "");
  check("none -> Fast", resolveChatMode({ reasoningEffort: "none" }) === CHATGLM_FAST);
  check("medium -> thinking", resolveChatMode({ reasoningEffort: "medium" }) === CHATGLM_THINKING);
  check("high -> deep_thinking", resolveChatMode({ reasoningEffort: "high" }) === CHATGLM_DEEP);
  check("effort is case/space tolerant", resolveChatMode({ reasoningEffort: " HIGH " }) === CHATGLM_DEEP);
  check("enable_thinking true -> Standard", resolveChatMode({ enableThinking: true }) === CHATGLM_THINKING);
  check("enable_thinking false -> Fast", resolveChatMode({ enableThinking: false }) === CHATGLM_FAST);
  check(
    "explicit effort beats enable_thinking",
    resolveChatMode({ reasoningEffort: "high", enableThinking: true }) === CHATGLM_DEEP
  );
  check("mode values are the upstream vocabulary", CHATGLM_THINKING === "thinking" && CHATGLM_DEEP === "deep_thinking");
}

// --- registry ---------------------------------------------------------------

// 5. GLM-5.2 keeps the id it had on NIM, so callers are unaffected by the move.
{
  check("glm-5.2 is routable", isChatGLMModel("z-ai/glm-5.2"));
  const m = resolveChatGLMModel("z-ai/glm-5.2");
  check("glm-5.2 is a text model", m?.kind === "text");
  check("glm-5.2 has vision", m?.vision === true);
  check("glm-5.2 exposes all three modes", m?.reasoningEffort?.length === 3, JSON.stringify(m?.reasoningEffort));
  check("unknown ids are not claimed", !isChatGLMModel("z-ai/glm-9.9"));
}

// 6. The image models, and the capability split between them. glm-image returns
//    prose claiming success and no image when handed a reference, so it must
//    not advertise vision — see lib/chatglm.ts.
{
  check("glm-image is an image model", chatglmImageModel("z-ai/glm-image")?.cogviewModel === "glm_image");
  check("glm-image-fast is an image model", chatglmImageModel("z-ai/glm-image-fast")?.cogviewModel === "standard");
  check("the text model is not an image model", chatglmImageModel("z-ai/glm-5.2") === null);
  check("glm-image does NOT advertise vision", resolveChatGLMModel("z-ai/glm-image")?.vision === false);
  check("glm-image-fast DOES advertise vision", resolveChatGLMModel("z-ai/glm-image-fast")?.vision === true);
  check("no public id says free", !CHATGLM_MODELS.some((x) => /free/i.test(x.id) || /free/i.test(x.name)));
}

// 6b. The image models can be withdrawn on their own. Datacenter hosts get an
//     empty run from every draw while chat keeps working, so a deploy has to be
//     able to drop the image models without losing GLM-5.2 with them.
{
  const served = chatglmModels();
  const imagesOff = process.env.CHATGLM_IMAGES_DISABLED === "1";
  check(
    "image models follow CHATGLM_IMAGES_DISABLED",
    served.some((m) => m.kind === "image") === !imagesOff,
    `disabled=${imagesOff} served=${served.map((m) => m.id).join(",")}`
  );
  check("the text model is always served", served.some((m) => m.id === "z-ai/glm-5.2"));
  check("routing follows the served list", isChatGLMModel("z-ai/glm-image") === !imagesOff);
}

// --- message conversion -----------------------------------------------------

// 7. System has no role upstream, so it folds into the first user turn.
{
  const out = toChatGLMMessages([
    { role: "system", content: "Be terse." },
    { role: "user", content: "Hi" },
  ]);
  check("system folds away", out.length === 1 && out[0].role === "user", JSON.stringify(out));
  check("system text survives", out[0].content[0].text === "Be terse.\n\nHi", JSON.stringify(out[0].content));
}

// 8. Content parts become the upstream's typed parts, with uploads swapped in.
{
  const uploads = new Map([["https://example.com/a.png", { image_url: "https://up/1.png", file_id: "f1" }]]);
  const out = toChatGLMMessages(
    [{ role: "user", content: [{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "https://example.com/a.png" } }] as any }],
    uploads
  );
  const parts = out[0].content;
  check("text part first", parts[0].type === "text" && parts[0].text === "what is this", JSON.stringify(parts));
  check("image part carries the upload handle", parts[1]?.type === "image" && parts[1].image?.[0]?.file_id === "f1", JSON.stringify(parts));
}

// 9. An image with no upload is dropped rather than sent as a dead link.
{
  const out = toChatGLMMessages([
    { role: "user", content: [{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "https://nope/x.png" } }] as any },
  ]);
  check("un-uploaded image dropped", out[0].content.length === 1, JSON.stringify(out[0].content));
}

// 10. Empty conversations are refused, not sent.
{
  let status = 0;
  try {
    toChatGLMMessages([{ role: "user", content: "   " }]);
  } catch (e: any) {
    status = e instanceof ChatGLMError ? e.status : -1;
  }
  check("empty content is a 400", status === 400, String(status));
}

// --- stream parsing ---------------------------------------------------------

function sse(frames: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(encoder.encode(`data: ${JSON.stringify(f)}\n\n`));
        c.close();
      },
    })
  );
}
const textFrame = (text: string) => ({ parts: [{ content: [{ type: "text", text }] }] });
const thinkFrame = (think: string) => ({ parts: [{ content: [{ type: "think", think }] }] });

async function collect(res: Response, summary = emptyChatGLMSummary()) {
  let text = "", reasoning = "", images: string[] = [];
  for await (const d of chatglmDeltas(res, summary)) {
    if (d.kind === "reasoning") reasoning += d.text;
    else if (d.kind === "image") images.push(d.text);
    else text += d.text;
  }
  return { text, reasoning, images, summary };
}

// 11. THE snapshot rule: frames are cumulative, so only the new tail is emitted.
//     Appending instead of diffing would yield "HHeHelHell…".
{
  const out = await collect(sse([textFrame("H"), textFrame("He"), textFrame("Hell"), textFrame("Hello")]));
  check("cumulative text is diffed, not appended", out.text === "Hello", JSON.stringify(out.text));
}

// 12. Same for reasoning.
{
  const out = await collect(sse([thinkFrame("1"), thinkFrame("1."), thinkFrame("1. ok")]));
  check("cumulative reasoning is diffed", out.reasoning === "1. ok", JSON.stringify(out.reasoning));
}

// 13. A snapshot that goes backwards (an upstream retry) resets the baseline
//     rather than emitting a negative slice.
{
  const out = await collect(sse([textFrame("abcdef"), textFrame("xy"), textFrame("xyz")]));
  check("backwards snapshot resets cleanly", out.text === "abcdefxyz", JSON.stringify(out.text));
}

// 14. Images are surfaced once each and recorded on the summary.
{
  const frame = (urls: string[]) => ({ parts: [{ content: [{ type: "image", code: "a cat", image: urls.map((u) => ({ image_url: u })) }] }] });
  const out = await collect(sse([frame(["https://img/1.jpg"]), frame(["https://img/1.jpg"])]));
  check("image yielded once", out.images.length === 1 && out.images[0] === "https://img/1.jpg", JSON.stringify(out.images));
  check("summary records the image", out.summary.images.length === 1);
  check("summary records the drawn prompt", out.summary.imagePrompt === "a cat", String(out.summary.imagePrompt));
}

// 15. Text and reasoning interleave without contaminating each other.
{
  const out = await collect(sse([thinkFrame("why"), textFrame("be"), thinkFrame("why not"), textFrame("because")]));
  check("streams stay separate", out.reasoning === "why not" && out.text === "because", JSON.stringify(out));
}

// 16. Junk frames are skipped rather than throwing.
{
  const encoder = new TextEncoder();
  const res = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(`data: {not json\n\n`));
        c.enqueue(encoder.encode(`: keepalive\n\n`));
        c.enqueue(encoder.encode(`data: ${JSON.stringify(textFrame("fine"))}\n\n`));
        c.close();
      },
    })
  );
  const out = await collect(res);
  check("malformed frames skipped", out.text === "fine", JSON.stringify(out.text));
}

// 17. An upstream error frame interrupts instead of truncating silently.
{
  let threw = false;
  try {
    await collect(sse([textFrame("partial"), { status: "error", last_error: { detail: "boom" } }]));
  } catch (e: any) {
    threw = e instanceof ChatGLMError && e.message.includes("boom");
  }
  check("error frame throws ChatGLMError", threw);
}

// --- the language rule ------------------------------------------------------
//
// The model drifts to Chinese unprompted: "whats your llm" answered in Chinese
// every time until it was told otherwise, and in English every time after.

// 17b. Chat gets the rule, ahead of everything else in the turn.
{
  const out = toChatGLMMessages([{ role: "user", content: "hi" }], new Map(), { languageRule: true });
  const text = out[0].content[0].text || "";
  check("rule is present", /same language/i.test(text), text.slice(0, 80));
  check("rule leads the turn", text.trim().startsWith("Language rule"), text.slice(0, 40));
  check("the user's own words survive", text.trim().endsWith("hi"), text.slice(-30));
}

// 17c. The caller's system prompt layers on top, so anyone who actually wants
//      another language can say so and win.
{
  const out = toChatGLMMessages(
    [{ role: "system", content: "Always reply in French." }, { role: "user", content: "hi" }],
    new Map(),
    { languageRule: true }
  );
  const text = out[0].content[0].text || "";
  check("rule comes first", text.indexOf("Language rule") < text.indexOf("French"), text.slice(0, 60));
  check("caller's instruction is kept", text.includes("Always reply in French."));
}

// 17d. Image generation must NOT get it — there the prompt describes a picture,
//      and a rule about what language to answer in has no place in it.
{
  const out = toChatGLMMessages([{ role: "user", content: "a red circle" }], new Map());
  const text = out[0].content[0].text || "";
  check("image prompt is untouched", text === "a red circle", JSON.stringify(text));
}

// --- empty runs -------------------------------------------------------------
//
// About one run in four from a host chatglm.cn serves poorly completes with no
// text, no reasoning and no error. Forwarded as-is that is a 200 with a blank
// message, which is the worst answer available: the caller sees nothing and has
// nothing to act on. chatglmRun retries such a run and errors if it stays empty.

// 18. An empty stream yields nothing at all — which is what makes it safe to
//     retry, and what the route must not pass through as success.
{
  const out = await collect(sse([]));
  check("empty stream yields no deltas", out.text === "" && out.reasoning === "" && out.images.length === 0, JSON.stringify(out));
}

// 19. A run carrying only frames with no content is equally empty: parts with
//     empty strings must not count as output.
{
  const out = await collect(sse([textFrame(""), thinkFrame(""), { parts: [{ content: [] }] }]));
  check("contentless frames yield nothing", out.text === "" && out.reasoning === "", JSON.stringify(out));
}

// 20. Reasoning alone still counts as output — a Deep run that thinks and then
//     says nothing is a real answer shape, not an empty run to retry.
{
  const out = await collect(sse([thinkFrame("pondering")]));
  check("reasoning-only run is not empty", out.reasoning === "pondering", JSON.stringify(out));
}

console.log(`chatglm: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
