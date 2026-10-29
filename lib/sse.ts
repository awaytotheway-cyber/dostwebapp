/**
 * Incremental server-sent events (SSE) parser for the streamed chat reply.
 * Keep in sync with supabase/functions/_shared/sse.ts.
 */

export type SseEvent = { event: string; data: string };

/**
 * Incremental SSE parser: feed it decoded text chunks as they arrive and it
 * returns every event completed so far. Chunks may split lines anywhere.
 */
export function createSseParser(): (chunk: string) => SseEvent[] {
  let buffer = '';
  let event = '';
  let data: string[] = [];

  return (chunk: string) => {
    buffer += chunk;
    const out: SseEvent[] = [];
    const lines = buffer.split(/\r\n|\r|\n/);
    // The last piece may be a partial line; keep it for the next chunk.
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line === '') {
        if (data.length > 0) {
          out.push({ event: event || 'message', data: data.join('\n') });
        }
        event = '';
        data = [];
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    return out;
  };
}
