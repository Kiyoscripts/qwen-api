import assert from "node:assert/strict";
import { proxyCustomChat, CustomProviderError, redactCustomCredential, type CustomModel, type CustomProviderProxyDependencies } from "../lib/customProviders.ts";
import { fakeOpenAI, json, sse } from "./helpers/fake-openai-upstream.mts";

process.env.ALLOW_PRIVATE_PROVIDER_URLS = "true";
const model: CustomModel = { id:"custom/demo",provider_id:"provider-1",upstream_model_id:"upstream-demo",provider_slug:"demo",provider_name:"Demo",supports_streaming:true,base_url:"",chat_path:"chat/completions",request_timeout_ms:2000 };

async function scenario(handler: Parameters<typeof fakeOpenAI>[0], run: (upstream: Awaited<ReturnType<typeof fakeOpenAI>>, deps: CustomProviderProxyDependencies) => Promise<void>) {
  const upstream = await fakeOpenAI(handler); const failures:any[]=[]; const successes:any[]=[];
  const credentials=[{id:"credential-1",secret_ciphertext:"encrypted",secret_prefix:"sk-t"}];
  const deps: CustomProviderProxyDependencies = {
    async claimCredential(_provider, excluded) { return credentials.find((c) => !excluded.includes(c.id)) || null; },
    fetch: async (base,path,init) => fetch(new URL(path, `${base}/`), init), decrypt: () => "sk-local-secret",
    async markFailure(...args) { failures.push(args); }, async markSuccess(...args) { successes.push(args); },
  };
  try { await run(upstream, Object.assign(deps, { failures, successes })); } finally { await upstream.close(); }
}

await scenario((_request,res) => json(res,200,{id:"chat-1",model:"upstream-demo",choices:[{message:{role:"assistant",content:"hello"}}]}), async (upstream,deps:any) => {
  const result:any = await proxyCustomChat({...model,base_url:upstream.baseUrl},{model:model.id,messages:[{role:"user",content:"hi"}],stream:false},AbortSignal.timeout(3000),deps);
  const payload=await result.response.json(); assert.equal(payload.model,"upstream-demo"); assert.equal(payload.choices[0].message.content,"hello");
  assert.equal(upstream.requests[0].authorization,"Bearer sk-local-secret"); assert.equal(upstream.requests[0].body.model,"upstream-demo");
  assert.deepEqual(deps.failures,[]); assert.equal(deps.successes.length,1);
});

await scenario((_request,res) => sse(res,[JSON.stringify({id:"chunk-1",model:"upstream-demo",choices:[{delta:{content:"hel"}}]}),JSON.stringify({id:"chunk-1",model:"upstream-demo",choices:[{delta:{content:"lo"}}]})]), async (upstream,deps) => {
  const result:any = await proxyCustomChat({...model,base_url:upstream.baseUrl},{model:model.id,messages:[],stream:true},AbortSignal.timeout(3000),deps);
  const text=await new Response(result.response.body).text();
  assert.match(text,/"model":"upstream-demo"/); assert.match(text,/"content":"hel"/); assert.match(text,/\[DONE\]/);
});

await scenario((_request,res) => json(res,401,{error:{message:"upstream secret detail"}}), async (upstream,deps:any) => {
  await assert.rejects(() => proxyCustomChat({...model,base_url:upstream.baseUrl},{model:model.id,stream:false},AbortSignal.timeout(3000),deps), (error:any) => {
    assert.ok(error instanceof CustomProviderError); assert.equal(error.status,401); assert.equal(error.category,"authentication_error");
    assert.doesNotMatch(error.message,/secret detail/); return true;
  });
  assert.deepEqual(deps.failures,[["credential-1",401,"authentication_error"]]);
});
console.log("custom provider integration tests passed");

const redacted = redactCustomCredential({id:"c1",provider_id:"p1",secret_prefix:"sk-a",secret_ciphertext:"ciphertext",credential:"plaintext"});
assert.deepEqual(redacted,{id:"c1",provider_id:"p1",secret_prefix:"sk-a"});
const adminRoute = await import("../app/api/admin/custom-providers/route.ts");
const unauthorized = await adminRoute.GET(new Request("http://localhost/api/admin/custom-providers") as any);
assert.equal(unauthorized.status,401); assert.deepEqual(await unauthorized.json(),{error:"Not signed in."});
