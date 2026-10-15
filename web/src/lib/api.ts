export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** "lite" = the serverless build (GitHub Pages): requests are answered on the device. "full" = the Python server. */
export const MODE = (process.env.NEXT_PUBLIC_KOLD_MODE ?? "full") as "lite" | "full";
export const isLite = MODE === "lite";
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

async function local<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { handle, LocalApiError } = await import("@/local/engine");
  try {
    return (await handle(method, path, body)) as T;
  } catch (e) {
    if (e instanceof LocalApiError) throw new ApiError(e.status, e.message);
    throw new ApiError(500, (e as Error).message || "Something went wrong");
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (isLite) return local<T>(method, path, body);
  const init: RequestInit = { method, credentials: "include", headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "Can't reach Kold's server. Is the API running?");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = typeof data.detail === "string" ? data.detail : msg;
    } catch {}
    throw new ApiError(res.status, msg || "Something went wrong");
  }
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T>(p: string, b: unknown) => request<T>("PUT", p, b),
  patch: <T>(p: string, b: unknown) => request<T>("PATCH", p, b),
  del: <T>(p: string) => request<T>("DELETE", p),
};

/** Open a job's tailored resume PDF (server URL in Full, a file made on the device in Lite). */
export async function openTailoredResume(userJobId: number): Promise<void> {
  if (!isLite) {
    window.open(`/api/jobs/${userJobId}/resume.pdf`, "_blank");
    return;
  }
  const { tailoredPdf } = await import("@/local/engine");
  const { name, blob } = await tailoredPdf(userJobId);
  const url = URL.createObjectURL(new File([blob], name, { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
