export async function readNdjsonStream<T = unknown>(
  res: Response,
  onEvent: (event: T) => void
): Promise<void> {
  if (!res.body) throw new Error("응답 스트림을 읽을 수 없습니다");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) onEvent(JSON.parse(trimmed) as T);
    }
  }

  const trimmed = buffer.trim();
  if (trimmed) onEvent(JSON.parse(trimmed) as T);
}
