import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
export type UpstreamRequest = { authorization?: string; body: any };
export async function fakeOpenAI(handler: (request: UpstreamRequest, response: ServerResponse) => void) {
  const requests: UpstreamRequest[] = [];
  const server = createServer(async (request: IncomingMessage, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const seen = { authorization: request.headers.authorization, body: raw ? JSON.parse(raw) : null };
    requests.push(seen);
    handler(seen, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake upstream did not bind");
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
export function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body));
}
export function sse(response: ServerResponse, frames: string[]) {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const frame of frames) response.write(`data: ${frame}\n\n`);
  response.end("data: [DONE]\n\n");
}
