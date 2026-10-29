import { assertEquals } from "jsr:@std/assert@1";
import {
  createSseParser,
  encodeSseEvent,
  openAIDeltaText,
  readOpenAIDeltas,
  streamCompletion,
} from "./sse.ts";

Deno.test("parser handles events split across chunks", () => {
  const parse = createSseParser();
  assertEquals(parse("event: del"), []);
  assertEquals(parse('ta\ndata: {"text":"Hel'), []);
  assertEquals(parse('lo"}\n'), []);
  assertEquals(parse("\n"), [{ event: "delta", data: '{"text":"Hello"}' }]);
});

Deno.test("parser handles CRLF, comments and several events per chunk", () => {
  const parse = createSseParser();
  assertEquals(parse(": keep-alive\r\n\r\ndata: a\r\n\r\nevent: done\r\ndata: b\r\ndata: c\r\n\r\n"), [
    { event: "message", data: "a" },
    { event: "done", data: "b\nc" },
  ]);
});

Deno.test("encoded events round-trip through the parser", () => {
  const parse = createSseParser();
  const text = new TextDecoder().decode(encodeSseEvent("delta", { text: "line\nbreak" }));
  const events = parse(text);
  assertEquals(events.length, 1);
  assertEquals(events[0].event, "delta");
  assertEquals(JSON.parse(events[0].data), { text: "line\nbreak" });
});

Deno.test("openAIDeltaText ignores role-only and malformed chunks", () => {
  assertEquals(openAIDeltaText('{"choices":[{"delta":{"role":"assistant"}}]}'), "");
  assertEquals(openAIDeltaText('{"choices":[{"delta":{"content":"Hi"}}]}'), "Hi");
  assertEquals(openAIDeltaText("not json"), "");
});

Deno.test("readOpenAIDeltas yields content in order and stops at [DONE]", async () => {
  const raw = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Way "}}]}\n\ndata: {"choi',
    'ces":[{"delta":{"content":"too long"}}]}\n\n',
    "data: [DONE]\n\n",
    'data: {"choices":[{"delta":{"content":"ignored"}}]}\n\n',
  ];
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of raw) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  const out: string[] = [];
  for await (const delta of readOpenAIDeltas(body)) out.push(delta);
  assertEquals(out, ["Way ", "too long"]);
});

Deno.test("readOpenAIDeltas flushes a final event without a trailing blank line", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"end"}}]}'));
      controller.close();
    },
  });
  const out: string[] = [];
  for await (const delta of readOpenAIDeltas(body)) out.push(delta);
  assertEquals(out, ["end"]);
});

function openAIBody(pieces: string[], failAfter = false): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const piece of pieces) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`));
      }
      // Erroring drops queued chunks, so let the reader drain them first.
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (failAfter) controller.error(new Error("connection reset"));
      else {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Array<{ event: string; data: unknown }>> {
  const parse = createSseParser();
  const decoder = new TextDecoder();
  const out: Array<{ event: string; data: unknown }> = [];
  for await (const chunk of stream) {
    for (const e of parse(decoder.decode(chunk, { stream: true }))) {
      out.push({ event: e.event, data: JSON.parse(e.data) });
    }
  }
  return out;
}

Deno.test("streamCompletion sends meta, deltas and done, then saves the reply", async () => {
  const saved: string[] = [];
  let firstText = 0;
  let ended = 0;
  const events = await collect(streamCompletion(openAIBody([" Way", " too long "]), { stage: "meeting" }, {
    maxLength: 2000,
    errorMessage: "unavailable",
    onFirstText: () => firstText++,
    onComplete: (reply) => saved.push(reply),
    onEnd: () => ended++,
  }));
  assertEquals(events, [
    { event: "meta", data: { stage: "meeting" } },
    { event: "delta", data: { text: " Way" } },
    { event: "delta", data: { text: " too long " } },
    { event: "done", data: { reply: "Way too long" } },
  ]);
  assertEquals(saved, ["Way too long"]);
  assertEquals([firstText, ended], [1, 1]);
});

Deno.test("streamCompletion reports a broken stream and saves nothing", async () => {
  const saved: string[] = [];
  const errors: string[] = [];
  const events = await collect(streamCompletion(openAIBody(["Half a"], true), {}, {
    maxLength: 2000,
    errorMessage: "unavailable",
    onComplete: (reply) => saved.push(reply),
    onError: (code) => errors.push(code),
  }));
  assertEquals(events.map((e) => e.event), ["meta", "delta", "error"]);
  assertEquals(events[2].data, { error: "unavailable", code: "stream" });
  assertEquals([saved, errors], [[], ["stream"]]);
});

Deno.test("streamCompletion treats a blank completion as an error", async () => {
  const events = await collect(streamCompletion(openAIBody(["  "]), {}, {
    maxLength: 2000,
    errorMessage: "unavailable",
    onComplete: () => {
      throw new Error("must not save");
    },
  }));
  assertEquals(events.at(-1), { event: "error", data: { error: "unavailable", code: "empty_reply" } });
});

Deno.test("streamCompletion still saves the reply when the app disconnects", async () => {
  const saved: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const encoder = new TextEncoder();
  const upstream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Stay"}}]}\n\n'));
      await gate;
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" here"}}]}\n\ndata: [DONE]\n\n'));
      controller.close();
    },
  });
  let done!: () => void;
  const finished = new Promise<void>((resolve) => (done = resolve));
  const out = streamCompletion(upstream, {}, {
    maxLength: 2000,
    errorMessage: "unavailable",
    onComplete: (reply) => saved.push(reply),
    onEnd: () => done(),
  });
  const reader = out.getReader();
  await reader.read(); // meta
  await reader.cancel();
  release();
  await finished;
  assertEquals(saved, ["Stay here"]);
});
