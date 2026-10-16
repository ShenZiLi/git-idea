import type { ApiRequest } from "../shared/types";
export async function request<T>(
  method: string,
  repo?: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const payload: ApiRequest = { method, repo, params };
  if (window.gitIdea) return window.gitIdea.request<T>(payload);
  const response = await fetch("/api/git", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || result.error)
    throw new Error(result.error || "无法连接 Git 服务");
  return result.data;
}
