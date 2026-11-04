/**
 * Minimal server-sent events (SSE) helpers for the streaming chat reply.
 * The parser reads OpenAI's streamed completion; the encoder writes the
 * events the app reads. Keep the parser in sync with lib/sse.ts.
 */

export type SseEvent = { event: string; data: string };

/**
 * Incremental SSE parser: feed it decoded text chunks as they arrive and it
 * returns every event completed so far. Chunks may split lines anywhere.
 */
export function createSseParser(): (chunk: string) => SseEvent[] {
  let buffer = "";
  let event = "";
  let data: string[] = [];

  return (chunk: string) => {
    buffer += chunk;
    const out: SseEvent[] = [];
    const lines = buffer.split(/\r\n|\r|\n/);
    // The last piece may be a partial line; keep it for the next chunk.
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line === "") {
        if (data.length > 0) {
          out.push({ event: event || "message", data: data.join("\n") });
        }
        event = "";
        data = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    return out;
  };
}

const encoder = new TextEncoder();

export function encodeSseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** The text pieces of an OpenAI chat-completions stream, in order. */
export async function* readOpenAIDeltas(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parse = createSseParser();
  try {
    while (true) {
      const { value, done } = await reader.read();
      const events = parse(done ? decoder.decode() + "\n\n" : decoder.decode(value, { stream: true }));
      for (const { data } of events) {
        if (data === "[DONE]") return;
        const delta = openAIDeltaText(data);
        if (delta) yield delta;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

export function openAIDeltaText(data: string): string {
  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    const content = parsed?.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

/**
 * A streamed completion re-sent to the app as server-sent events: `meta`
 * first, then a `delta` per piece of text, then `done` with the full reply
 * — or `error` if it breaks off or comes back empty. onComplete gets the
 * reply only when it finished; it still runs if the app disconnects.
 */
export function streamCompletion(
  upstream: ReadableStream<Uint8Array>,
  meta: unknown,
  hooks: {
    maxLength: number;
    errorMessage: string;
    onFirstText?: () => void;
    onComplete: (reply: string) => void;
    onError?: (code: string) => void;
    onEnd?: () => void;
  },
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encodeSseEvent(event, data));
        } catch {
          open = false; // The app went away; keep reading so the reply is saved.
        }
      };
      const fail = (code: string) => {
        hooks.onError?.(code);
        send("error", { error: hooks.errorMessage, code });
      };

      send("meta", meta);
      let text = "";
      try {
        for await (const delta of readOpenAIDeltas(upstream)) {
          if (!text) hooks.onFirstText?.();
          text += delta;
          send("delta", { text: delta });
        }
        const reply = text.trim().slice(0, hooks.maxLength);
        if (reply) {
          send("done", { reply });
          hooks.onComplete(reply);
        } else {
          fail("empty_reply");
        }
      } catch {
        fail("stream");
      } finally {
        hooks.onEnd?.();
        if (open) {
          try {
            controller.close();
          } catch { /* already cancelled */ }
        }
      }
    },
  });
}
