export const API_BASE_URL =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ??
  "http://127.0.0.1:8000/api/v1";

const AUTH_REFRESH_PATH =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_AUTH_REFRESH_PATH ??
  "/auth/refresh";
const REFRESH_AHEAD_MS = 5 * 60 * 1000;

export const AUTH_EXPIRED_EVENT = "auth:expired";

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface TokenRefreshResult {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  user?: unknown;
}

export class EventStreamRequestError extends Error {
  code?: string;
  detailUrl?: string;
  status: number;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "EventStreamRequestError";
    this.status = status;
    const source = payload as { code?: unknown; detail_url?: unknown; data?: unknown } | null;
    const nested = source?.data && typeof source.data === "object"
      ? source.data as { code?: unknown; detail_url?: unknown }
      : undefined;
    const code = nested?.code ?? source?.code;
    const detailUrl = nested?.detail_url ?? source?.detail_url;
    this.code = code === undefined ? undefined : String(code);
    this.detailUrl = detailUrl === undefined ? undefined : String(detailUrl);
  }
}

let refreshPromise: Promise<string> | null = null;
const inFlightJsonRequests = new Map<string, Promise<unknown>>();

export function clearSession() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("token_type");
  localStorage.removeItem("auth_user");
}

export function saveTokenSession(result: TokenRefreshResult) {
  localStorage.setItem("access_token", result.access_token);
  if (result.refresh_token) localStorage.setItem("refresh_token", result.refresh_token);
  if (result.token_type) localStorage.setItem("token_type", result.token_type);
  if (result.user) localStorage.setItem("auth_user", JSON.stringify(result.user));
}

function getResponseMessage(payload: unknown, fallbackMessage: string) {
  const result = payload as { detail?: unknown; message?: unknown } | null;
  return typeof result?.detail === "string"
    ? result.detail
    : typeof result?.message === "string"
      ? result.message
      : fallbackMessage;
}

function notifyAuthExpired(message: string) {
  clearSession();
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { message } }));
}

function getAccessTokenExpiresAt(token: string) {
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "=",
    );
    const parsed = JSON.parse(window.atob(paddedPayload)) as { exp?: unknown };
    return typeof parsed.exp === "number" ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}

function shouldRefreshAccessToken() {
  const accessToken = localStorage.getItem("access_token");
  const refreshToken = localStorage.getItem("refresh_token");
  if (!accessToken || !refreshToken) return false;

  const expiresAt = getAccessTokenExpiresAt(accessToken);
  return expiresAt !== null && Date.now() >= expiresAt - REFRESH_AHEAD_MS;
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) {
    const message = "登录凭证已过期，请重新登录";
    notifyAuthExpired(message);
    throw new Error(message);
  }

  refreshPromise = fetch(`${API_BASE_URL}${AUTH_REFRESH_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = getResponseMessage(payload, "登录凭证已过期，请重新登录");
        notifyAuthExpired(message);
        throw new Error(message);
      }

      const result = (payload && typeof payload === "object" && "data" in payload ? payload.data : payload) as
        | TokenRefreshResult
        | null;
      if (!result?.access_token) throw new Error("刷新 token 响应缺少 access_token");

      saveTokenSession(result);
      return result.access_token;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

function buildJsonHeaders(headers?: HeadersInit, withAuth = false, body?: BodyInit | null) {
  const nextHeaders = new Headers(headers);
  if (!(body instanceof FormData)) nextHeaders.set("Content-Type", "application/json");

  if (withAuth) {
    const token = localStorage.getItem("access_token");
    if (token) nextHeaders.set("Authorization", `Bearer ${token}`);
  }

  return nextHeaders;
}

function getRequestMethod(init: RequestInit) {
  return (init.method ?? "GET").toUpperCase();
}

function canCoalesceJsonUrl(url: string) {
  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url.split("?")[0];
    }
  })();
  return [
    "/agents/dashboard",
    "/agents/metrics",
    "/agents/alerts",
    "/agents/release-gates",
    "/agents/release-gates/promotion",
    "/projects",
    "/environment-configs",
  ].some((path) => pathname.endsWith(path));
}

function canCoalesceJsonRequest(url: string, init: RequestInit) {
  return getRequestMethod(init) === "GET" && !init.body && !init.signal && canCoalesceJsonUrl(url);
}

function headersKey(headers: Headers) {
  return Array.from(headers.entries())
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join("\n");
}

function jsonRequestKey(url: string, init: RequestInit, headers: Headers) {
  return JSON.stringify({
    method: getRequestMethod(init),
    url,
    headers: headersKey(headers),
    cache: init.cache,
    credentials: init.credentials,
    mode: init.mode,
    redirect: init.redirect,
  });
}

function coalesceJsonRequest<T>(key: string, producer: () => Promise<T>) {
  const existing = inFlightJsonRequests.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  let requestPromise!: Promise<T>;
  requestPromise = producer().finally(() => {
    if (inFlightJsonRequests.get(key) === requestPromise) inFlightJsonRequests.delete(key);
  });
  inFlightJsonRequests.set(key, requestPromise);
  return requestPromise;
}

function resolveApiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/api/")) {
    const base = new URL(API_BASE_URL);
    return `${base.origin}${path}`;
  }
  return `${API_BASE_URL}${path}`;
}

export async function requestPublic<T>(path: string, init: RequestInit = {}) {
  const coalescedUrl = `${API_BASE_URL}${path}`;
  const coalescedHeaders = buildJsonHeaders(init.headers, false, init.body);
  if (canCoalesceJsonRequest(coalescedUrl, init)) {
    return coalesceJsonRequest(jsonRequestKey(coalescedUrl, init, coalescedHeaders), async () => {
      const response = await fetch(coalescedUrl, { ...init, headers: coalescedHeaders });
      return parseJsonResponse<T>(response, "Request failed, please try again later");
    });
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: buildJsonHeaders(init.headers, false, init.body),
  });

  return parseJsonResponse<T>(response, "请求失败，请稍后重试");
}

export async function requestWithAuth<T>(path: string, init: RequestInit = {}) {
  if (shouldRefreshAccessToken()) await refreshAccessToken();

  const coalescedUrl = `${API_BASE_URL}${path}`;
  const coalescedHeaders = buildJsonHeaders(init.headers, true, init.body);
  if (canCoalesceJsonRequest(coalescedUrl, init)) {
    return coalesceJsonRequest(jsonRequestKey(coalescedUrl, init, coalescedHeaders), async () => {
      const response = await fetch(coalescedUrl, { ...init, headers: coalescedHeaders });
      if (response.status === 401) {
        const payload = await response.json().catch(() => null);
        const message = getResponseMessage(payload, "Login expired, please sign in again");
        notifyAuthExpired(message);
        throw new Error(message);
      }
      return parseJsonResponse<T>(response, "API request failed, please try again later");
    });
  }

  const send = () =>
    fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: buildJsonHeaders(init.headers, true, init.body),
    });

  let response = await send();
  if (response.status === 401) {
    const payload = await response.json().catch(() => null);
    const message = getResponseMessage(payload, "登录凭证已过期，请重新登录");
    notifyAuthExpired(message);
    throw new Error(message);
  }

  return parseJsonResponse<T>(response, "接口请求失败，请稍后重试");
}

export async function requestEventStreamWithAuth(path: string, init: RequestInit = {}) {
  if (shouldRefreshAccessToken()) await refreshAccessToken();

  const headers = new Headers(init.headers);
  headers.set("Accept", "text/event-stream");
  const token = localStorage.getItem("access_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(resolveApiUrl(path), { ...init, headers });
  if (response.status === 401) {
    const payload = await response.json().catch(() => null);
    const message = getResponseMessage(payload, "登录凭证已过期，请重新登录");
    notifyAuthExpired(message);
    throw new Error(message);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new EventStreamRequestError(
      getResponseMessage(payload, "场景实时事件连接失败"),
      response.status,
      payload,
    );
  }
  if (!response.body) throw new Error("场景实时事件响应缺少流数据");
  return response;
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string) {
  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getResponseMessage(result, fallbackMessage));
  }

  if (result && typeof result === "object" && "data" in result) {
    return (result as ApiResponse<T>).data;
  }

  return result as T;
}
