import type { Answer, Source, SourceDetail } from "./types";
const base = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "The request could not be completed.");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const api = {
  sources: () => request<Source[]>("/sources"),
  detail: (id: string) => request<SourceDetail>(`/sources/${id}`),
  upload: (file: File) => {
    const data = new FormData();
    data.append("file", file);
    return request<Source>("/sources/upload", { method: "POST", body: data });
  },
  manual: (name: string, content: string) =>
    request<Source>("/sources/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content }),
    }),
  remove: (id: string) => request<void>(`/sources/${id}`, { method: "DELETE" }),
  ask: (question: string, source_ids: string[]) =>
    request<Answer>("/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, source_ids }),
    }),
};
