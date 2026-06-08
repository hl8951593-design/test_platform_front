import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AUTH_EXPIRED_EVENT } from "./api/client";
import type { AuthUser } from "./api/auth";
import { listProjectEnvironments, listProjects, type EnvironmentOption, type ProjectOption } from "./api/projects";
import { ActionButton, IconButton } from "./components/Buttons";
import { Icon } from "./components/Icon";
import { routes } from "./data/mock";
import { ApiPage } from "./pages/ApiPage";
import { DashboardPage } from "./pages/DashboardPage";
import { EnvironmentConfigsPage } from "./pages/EnvironmentConfigsPage";
import { ExecutionsPage } from "./pages/ExecutionsPage";
import { FlowPage } from "./pages/FlowPage";
import { LoginPage } from "./pages/LoginPage";
import { PlansPage } from "./pages/PlansPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ScenariosPage } from "./pages/ScenariosPage";
import type { ActionHandler, RouteKey, RouteMeta } from "./types";

const mainRoutes = routes.filter((route) => !["login", "profile", "environments", "settings"].includes(route.key));

function readAuthUser(): AuthUser | null {
  const rawUser = localStorage.getItem("auth_user");
  if (!rawUser) return null;
  try {
    return JSON.parse(rawUser) as AuthUser;
  } catch {
    return null;
  }
}

function getRouteFromUrl(): RouteKey {
  const path = window.location.pathname.replace("/", "").toLowerCase();
  const match = routes.find((route) => route.key === path);
  return match?.key ?? "dashboard";
}

function routeContent({
  activeProjectId,
  activeEnvironmentId,
  onAction,
  onEnvironmentChanged,
  onProjectCreated,
  environmentError,
  environmentLoading,
  environments,
  projectError,
  projectLoading,
  projects,
  route,
  user,
}: {
  activeProjectId?: number;
  activeEnvironmentId?: number;
  onAction: ActionHandler;
  onEnvironmentChanged: (environmentId?: number) => void;
  onProjectCreated: (project: ProjectOption) => void;
  environmentError: string;
  environmentLoading: boolean;
  environments: EnvironmentOption[];
  projectError: string;
  projectLoading: boolean;
  projects: ProjectOption[];
  route: RouteKey;
  user: AuthUser | null;
}) {
  switch (route) {
    case "dashboard":
      return <DashboardPage onAction={onAction} />;
    case "projects":
      return (
        <ProjectsPage
          isLoading={projectLoading}
          loadError={projectError}
          onAction={onAction}
          onCreated={onProjectCreated}
          projects={projects}
        />
      );
    case "plans":
      return <PlansPage onAction={onAction} />;
    case "flow":
      return <FlowPage environmentId={activeEnvironmentId} onAction={onAction} projectId={activeProjectId} />;
    case "scenarios":
      return <ScenariosPage onAction={onAction} />;
    case "api":
      return (
        <ApiPage
          environmentError={environmentError}
          environmentId={activeEnvironmentId}
          environmentLoading={environmentLoading}
          environments={environments}
          onAction={onAction}
          projectId={activeProjectId}
        />
      );
    case "executions":
      return <ExecutionsPage onAction={onAction} />;
    case "reports":
      return <ReportsPage onAction={onAction} />;
    case "environments":
      return (
        <EnvironmentConfigsPage
          onAction={onAction}
          onEnvironmentChanged={onEnvironmentChanged}
          projectId={activeProjectId}
        />
      );
    case "profile":
      return (
        <ProfilePage
          activeEnvironment={environments.find((environment) => environment.id === activeEnvironmentId)}
          activeProject={projects.find((project) => project.id === activeProjectId)}
          user={user}
        />
      );
    case "login":
      return <LoginPage onAction={onAction} />;
    default:
      return <PlansPage onAction={onAction} />;
  }
}

export default function App() {
  const [activeRoute, setActiveRoute] = useState<RouteKey>(() => getRouteFromUrl());
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => readAuthUser());
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<number | undefined>(() => {
    const saved = localStorage.getItem("active_project_id");
    const value = saved ? Number(saved) : undefined;
    return value && Number.isFinite(value) ? value : undefined;
  });
  const [projectLoading, setProjectLoading] = useState(true);
  const [projectError, setProjectError] = useState("");
  const [environments, setEnvironments] = useState<EnvironmentOption[]>([]);
  const [activeEnvironmentId, setActiveEnvironmentId] = useState<number | undefined>(() => {
    const saved = localStorage.getItem("active_environment_id");
    const value = saved ? Number(saved) : undefined;
    return value && Number.isFinite(value) ? value : undefined;
  });
  const [environmentLoading, setEnvironmentLoading] = useState(false);
  const [environmentError, setEnvironmentError] = useState("");
  const isLoginRoute = activeRoute === "login";
  const meta = useMemo(() => routes.find((route) => route.key === activeRoute) ?? routes[0], [activeRoute]);

  useEffect(() => {
    const syncRoute = () => setActiveRoute(getRouteFromUrl());
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (isLoginRoute) {
      setProjectLoading(false);
      return;
    }

    let ignore = false;

    const loadProjectList = async () => {
      setProjectLoading(true);
      setProjectError("");
      try {
        const nextProjects = await listProjects();
        if (ignore) return;
        setProjects(nextProjects);
        setActiveProjectId((current) => {
          if (current && nextProjects.some((project) => project.id === current)) return current;
          return nextProjects[0]?.id;
        });
      } catch (error) {
        if (ignore) return;
        setProjectError(error instanceof Error ? error.message : "项目列表加载失败");
      } finally {
        if (!ignore) setProjectLoading(false);
      }
    };

    void loadProjectList();
    return () => {
      ignore = true;
    };
  }, [isLoginRoute]);

  useEffect(() => {
    if (activeProjectId) localStorage.setItem("active_project_id", String(activeProjectId));
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setEnvironments([]);
      setActiveEnvironmentId(undefined);
      setEnvironmentError("");
      setEnvironmentLoading(false);
      return;
    }

    let ignore = false;

    const loadEnvironmentList = async () => {
      setEnvironmentLoading(true);
      setEnvironmentError("");
      try {
        const nextEnvironments = await listProjectEnvironments(activeProjectId);
        if (ignore) return;
        setEnvironments(nextEnvironments);
        setActiveEnvironmentId((current) => {
          if (current && nextEnvironments.some((environment) => environment.id === current)) return current;
          return nextEnvironments.find((environment) => environment.isDefault)?.id ?? nextEnvironments[0]?.id;
        });
      } catch (error) {
        if (ignore) return;
        setEnvironments([]);
        setActiveEnvironmentId(undefined);
        setEnvironmentError(error instanceof Error ? error.message : "环境列表加载失败");
      } finally {
        if (!ignore) setEnvironmentLoading(false);
      }
    };

    void loadEnvironmentList();
    return () => {
      ignore = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (activeEnvironmentId) localStorage.setItem("active_environment_id", String(activeEnvironmentId));
  }, [activeEnvironmentId]);

  const navigate = useCallback((key: RouteKey) => {
    setActiveRoute(key);
    window.history.pushState(null, "", `/${key}#/`);
  }, []);

  useEffect(() => {
    const handleAuthExpired = (event: Event) => {
      const message =
        event instanceof CustomEvent && typeof event.detail?.message === "string"
          ? event.detail.message
          : "登录凭证已过期，请重新登录";
      setToast(message);
      setProjects([]);
      setEnvironments([]);
      setActiveProjectId(undefined);
      setActiveEnvironmentId(undefined);
      setAuthUser(null);
      navigate("login");
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [navigate]);

  const onAction: ActionHandler = useCallback((label) => setToast(`${label} 已触发`), []);

  const handleProjectCreated = useCallback((project: ProjectOption) => {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    setActiveProjectId(project.id);
  }, []);

  const toggleCollapsed = useCallback(() => setCollapsed((value) => !value), []);

  const reloadEnvironments = useCallback((preferredEnvironmentId?: number) => {
    if (!activeProjectId) return;
    setEnvironmentLoading(true);
    setEnvironmentError("");
    void listProjectEnvironments(activeProjectId)
      .then((nextEnvironments) => {
        setEnvironments(nextEnvironments);
        setActiveEnvironmentId((current) => {
          if (preferredEnvironmentId && nextEnvironments.some((environment) => environment.id === preferredEnvironmentId)) {
            return preferredEnvironmentId;
          }
          if (current && nextEnvironments.some((environment) => environment.id === current)) return current;
          return nextEnvironments.find((environment) => environment.isDefault)?.id ?? nextEnvironments[0]?.id;
        });
      })
      .catch((error) => {
        setEnvironments([]);
        setActiveEnvironmentId(undefined);
        setEnvironmentError(error instanceof Error ? error.message : "环境列表加载失败");
      })
      .finally(() => setEnvironmentLoading(false));
  }, [activeProjectId]);

  if (isLoginRoute) {
    return (
      <>
        <LoginPage
          onAction={onAction}
          onAuthenticated={() => {
            setAuthUser(readAuthUser());
            navigate("dashboard");
          }}
        />
        <Toast message={toast} />
      </>
    );
  }

  return (
    <div className={collapsed ? "app-shell nav-collapsed" : "app-shell"}>
      <Navigation
        activeRoute={activeRoute}
        collapsed={collapsed}
        navigate={navigate}
        onAction={onAction}
        toggleCollapsed={toggleCollapsed}
      />
      <main className="workspace">
        <TopBar
          activeEnvironmentId={activeEnvironmentId}
          activeProjectId={activeProjectId}
          environmentLoading={environmentLoading}
          environments={environments}
          meta={meta}
          navigate={navigate}
          onEnvironmentChange={setActiveEnvironmentId}
          onAction={onAction}
          onProjectChange={setActiveProjectId}
          projectLoading={projectLoading}
          projects={projects}
          user={authUser}
        />
        {routeContent({
          activeEnvironmentId,
          activeProjectId,
          environmentError,
          environmentLoading,
          environments,
          onAction,
          onEnvironmentChanged: reloadEnvironments,
          onProjectCreated: handleProjectCreated,
          projectError,
          projectLoading,
          projects,
          route: activeRoute,
          user: authUser,
        })}
      </main>
      <Toast message={toast} />
    </div>
  );
}

const Navigation = memo(function Navigation({
  activeRoute,
  collapsed,
  navigate,
  onAction,
  toggleCollapsed,
}: {
  activeRoute: RouteKey;
  collapsed: boolean;
  navigate: (key: RouteKey) => void;
  onAction: ActionHandler;
  toggleCollapsed: () => void;
}) {
  return (
    <aside className="nav">
      <div className="nav-head">
        <button className="brand" onClick={() => navigate("dashboard")} title="TestAuto" type="button">
          <span className="brand-mark">AI</span>
          {!collapsed && <span>TestAuto</span>}
        </button>
        <button
          aria-label={collapsed ? "展开菜单" : "收起菜单"}
          className="nav-collapse"
          onClick={toggleCollapsed}
          title={collapsed ? "展开菜单" : "收起菜单"}
          type="button"
        >
          <Icon name={collapsed ? "keyboard_double_arrow_right" : "keyboard_double_arrow_left"} />
        </button>
      </div>

      <div className="nav-list">
        {mainRoutes.map((route) => (
          <button
            className={route.key === activeRoute ? "nav-item active" : "nav-item"}
            key={route.key}
            onClick={() => navigate(route.key)}
            title={route.label}
            type="button"
          >
            <Icon name={route.icon} />
            {!collapsed && <span>{route.label}</span>}
          </button>
        ))}
      </div>

      <div className="nav-bottom">
        <button
          className={activeRoute === "environments" ? "nav-item active" : "nav-item"}
          onClick={() => navigate("environments")}
          title="环境配置"
          type="button"
        >
          <Icon name="settings_input_component" />
          {!collapsed && <span>环境配置</span>}
        </button>
        <button className="nav-item" onClick={() => navigate("login")} title="退出登录" type="button">
          <Icon name="logout" />
          {!collapsed && <span>退出登录</span>}
        </button>
      </div>
    </aside>
  );
});

const TopBar = memo(function TopBar({
  activeEnvironmentId,
  activeProjectId,
  environmentLoading,
  environments,
  meta,
  navigate,
  onEnvironmentChange,
  onAction,
  onProjectChange,
  projectLoading,
  projects,
  user,
}: {
  activeEnvironmentId?: number;
  activeProjectId?: number;
  environmentLoading: boolean;
  environments: EnvironmentOption[];
  meta: RouteMeta;
  navigate: (key: RouteKey) => void;
  onEnvironmentChange: (environmentId: number) => void;
  onAction: ActionHandler;
  onProjectChange: (projectId: number) => void;
  projectLoading: boolean;
  projects: ProjectOption[];
  user: AuthUser | null;
}) {
  const userName = user?.username || user?.account || "当前用户";
  const userInitials = userName.slice(0, 2).toUpperCase();

  return (
    <header className="topbar">
      <div className="topbar-heading">
        <span className="topbar-heading-icon"><Icon name={meta.icon} /></span>
        <div>
          <span className="topbar-eyebrow">TestAuto Workspace</span>
          <h1>{meta.title}</h1>
          {meta.subtitle && <p>{meta.subtitle}</p>}
        </div>
      </div>
      <div className="topbar-actions">
        <div className="topbar-context">
          <label className="context-select">
            <Icon name="folder_special" />
            <span>项目</span>
            <select
              aria-label="项目"
              disabled={projectLoading || projects.length === 0}
              onChange={(event) => onProjectChange(Number(event.target.value))}
              value={activeProjectId ?? ""}
            >
              {projectLoading && <option value="">加载项目中...</option>}
              {!projectLoading && projects.length === 0 && <option value="">暂无项目</option>}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          <label className="context-select">
            <Icon name="cloud" />
            <span>环境</span>
            <select
              aria-label="环境"
              disabled={!activeProjectId || environmentLoading || environments.length === 0}
              onChange={(event) => onEnvironmentChange(Number(event.target.value))}
              value={activeEnvironmentId ?? ""}
            >
              {!activeProjectId && <option value="">请先选择项目</option>}
              {activeProjectId && environmentLoading && <option value="">加载环境中...</option>}
              {activeProjectId && !environmentLoading && environments.length === 0 && <option value="">暂无环境</option>}
              {environments.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name}{environment.isDefault ? " 默认" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="search-box">
          <Icon name="search" />
          <input placeholder="搜索用例、接口、报告" />
          <kbd>⌘ K</kbd>
        </label>
        <ActionButton action={{ icon: "add", label: "新建任务", primary: true }} onAction={onAction} />
        <IconButton icon="notifications" label="通知" onAction={onAction} />
        <button aria-label="进入个人中心" className="user-entry" onClick={() => navigate("profile")} type="button">
          <span className="avatar">
            {user?.avatar ? <img alt="" src={user.avatar} /> : userInitials}
          </span>
          <span className="user-entry-copy">
            <strong>{userName}</strong>
            <small>{user?.account || "个人中心"}</small>
          </span>
          <Icon name="chevron_right" />
        </button>
      </div>
    </header>
  );
});

const Toast = memo(function Toast({ message }: { message: string }) {
  return message ? <div className="toast">{message}</div> : null;
});
