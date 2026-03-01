import { AnkiResponse } from "./types";

export async function ankiFetch<T = unknown>(
  action: string,
  params?: Record<string, unknown>
): Promise<T> {
  const response = await fetch("/api/anki", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
  });

  const data: AnkiResponse<T> = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result;
}
