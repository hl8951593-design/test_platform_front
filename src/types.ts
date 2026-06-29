export type RouteKey =
  | "dashboard"
  | "agents"
  | "projects"
  | "plans"
  | "flow"
  | "scenarios"
  | "api"
  | "executions"
  | "defects"
  | "reports"
  | "login"
  | "profile"
  | "environments"
  | "settings";

export type ShellVariant = "dashboard" | "dark" | "light" | "project" | "report" | "blank";

export interface RouteMeta {
  key: RouteKey;
  icon: string;
  label: string;
  title: string;
  subtitle?: string;
  variant: ShellVariant;
}

export type ActionHandler = (label: string) => void;

export interface ActionSpec {
  icon: string;
  label: string;
  primary?: boolean;
}
