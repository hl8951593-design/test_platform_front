import { requestPublic, saveTokenSession } from "./client";

export interface AuthUser {
  id: number;
  username: string;
  avatar: string | null;
  account: string;
  phone: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

export interface LoginResult {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
}

export interface RegisterPayload {
  username: string;
  avatar?: string | null;
  account: string;
  password: string;
  phone: string;
  email: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, body: unknown): Promise<T> {
  try {
    return await requestPublic<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : "请求失败，请稍后重试", 0);
  }
}

export function login(account: string, password: string) {
  return request<LoginResult>("/auth/login", { account, password });
}

export function register(payload: RegisterPayload) {
  return request<AuthUser>("/auth/register", payload);
}

export function saveSession(result: LoginResult) {
  saveTokenSession(result);
}
