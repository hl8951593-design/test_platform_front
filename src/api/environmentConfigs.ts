import { requestWithAuth } from "./client";

export interface EnvironmentConfigPayload {
  name: string;
  base_url: string;
  description: string | null;
  is_default: boolean;
}

export interface EnvironmentVariablePayload {
  name: string;
  value: string;
  is_secret: boolean;
}

export interface BackendEnvironmentVariable {
  id?: number | string;
  environment_id?: number | string;
  name?: string;
  value?: string;
  is_secret?: boolean;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface BackendEnvironmentConfig {
  id?: number | string;
  environment_id?: number | string;
  project_id?: number | string;
  name?: string;
  base_url?: string;
  description?: string | null;
  is_default?: boolean;
  is_deleted?: boolean;
  created_by_id?: number | string;
  created_at?: string;
  updated_at?: string;
  created_by?: {
    id?: number | string;
    username?: string;
    account?: string;
  };
  variables?: BackendEnvironmentVariable[];
  test_case_count?: number;
  [key: string]: unknown;
}

export interface BackendBoundTestCase {
  id?: number | string;
  test_case_id?: number | string;
  name?: string;
  title?: string;
  method?: string;
  path?: string;
  last_execution_status?: string;
  last_executed_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

function buildProjectQuery(projectId: number) {
  return new URLSearchParams({ project_id: String(projectId) }).toString();
}

export function listEnvironmentConfigs(projectId: number) {
  return requestWithAuth<BackendEnvironmentConfig[]>(`/environment-configs?${buildProjectQuery(projectId)}`);
}

export function getEnvironmentConfig(projectId: number, environmentId: number | string) {
  return requestWithAuth<BackendEnvironmentConfig>(
    `/environment-configs/${environmentId}?${buildProjectQuery(projectId)}`,
  );
}

export function createEnvironmentConfig(projectId: number, payload: EnvironmentConfigPayload) {
  return requestWithAuth<BackendEnvironmentConfig>(`/environment-configs?${buildProjectQuery(projectId)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateEnvironmentConfig(
  projectId: number,
  environmentId: number | string,
  payload: EnvironmentConfigPayload,
) {
  return requestWithAuth<BackendEnvironmentConfig>(`/environment-configs/${environmentId}?${buildProjectQuery(projectId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteEnvironmentConfig(projectId: number, environmentId: number | string) {
  return requestWithAuth<unknown>(`/environment-configs/${environmentId}?${buildProjectQuery(projectId)}`, {
    method: "DELETE",
  });
}

export function listEnvironmentVariables(projectId: number, environmentId: number | string) {
  return requestWithAuth<BackendEnvironmentVariable[]>(
    `/environment-configs/${environmentId}/variables?${buildProjectQuery(projectId)}`,
  );
}

export function upsertEnvironmentVariable(
  projectId: number,
  environmentId: number | string,
  payload: EnvironmentVariablePayload,
) {
  return requestWithAuth<BackendEnvironmentVariable>(
    `/environment-configs/${environmentId}/variables?${buildProjectQuery(projectId)}`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteEnvironmentVariable(
  projectId: number,
  environmentId: number | string,
  variableId: number | string,
) {
  return requestWithAuth<unknown>(
    `/environment-configs/${environmentId}/variables/${variableId}?${buildProjectQuery(projectId)}`,
    { method: "DELETE" },
  );
}

export function listEnvironmentBoundTestCases(projectId: number, environmentId: number | string) {
  return requestWithAuth<BackendBoundTestCase[]>(
    `/environment-configs/${environmentId}/test-cases?${buildProjectQuery(projectId)}`,
  );
}

export function bindTestCaseEnvironment(projectId: number, testCaseId: number | string, environmentId: number | null) {
  return requestWithAuth<BackendBoundTestCase>(
    `/environment-configs/test-cases/${testCaseId}/environment?${buildProjectQuery(projectId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ environment_id: environmentId }),
    },
  );
}
