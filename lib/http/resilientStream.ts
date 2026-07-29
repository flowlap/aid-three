const encoder = new TextEncoder();

/**
 * Wraps a chunked HTTP response body so a client disconnecting mid-stream
 * (e.g. a backgrounded tab getting throttled) doesn't cancel `run` early —
 * `run` always finishes so its side effects (saving results, etc.) complete,
 * it just stops trying to push bytes to a consumer that's gone.
 */
export function createResilientStream(
  run: (emit: (chunk: string) => void) => Promise<void>
): ReadableStream<Uint8Array> {
  let disconnected = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (chunk: string) => {
        if (disconnected) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          disconnected = true;
        }
      };

      try {
        await run(emit);
        if (!disconnected) {
          try {
            controller.close();
          } catch {
            // client disconnected between the last emit and this close
          }
        }
      } catch (err) {
        if (!disconnected) {
          console.error("스트리밍 중 오류:", err);
          try {
            controller.error(err);
          } catch {
            // already closed/errored
          }
        }
      }
    },
    cancel() {
      disconnected = true;
    },
  });
}
