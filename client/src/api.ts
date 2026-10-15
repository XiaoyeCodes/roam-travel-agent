const API = import.meta.env?.VITE_API_BASE || "";
export function headers(json = false): HeadersInit {
  const token = sessionStorage.getItem("roam-token");
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API}/api${path}`, {
    ...init,
    headers: { ...headers(!!init.body), ...init.headers },
  });
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ error: `请求失败 (${response.status})` }));
    if (response.status === 401) window.dispatchEvent(new Event("roam-auth"));
    throw new Error(data.error || "请求失败");
  }
  return response.json();
}
export async function watchEvents(
  id: string,
  after: number,
  signal: AbortSignal,
  onEvent: (event: any) => void,
) {
  const response = await fetch(`${API}/api/trips/${id}/events?after=${after}`, {
    headers: headers(),
    signal,
  });
  if (!response.ok || !response.body) throw new Error("协作消息连接中断");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data: "));
      if (data && !frame.includes("event: closed"))
        onEvent(JSON.parse(data.slice(6)));
    }
  }
}
export async function downloadPdf(id: string, filename: string) {
  const response = await fetch(`${API}/api/trips/${id}/pdf`, {
    headers: headers(),
  });
  if (!response.ok) throw new Error((await response.json()).error);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
