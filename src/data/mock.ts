import type { RouteMeta } from "../types";

export const routes: RouteMeta[] = [
  { key: "dashboard", icon: "dashboard", label: "工作台", title: "全局运营仪表盘", variant: "dashboard" },
  { key: "projects", icon: "folder_special", label: "项目管理", title: "项目管理", subtitle: "监控并管理所有自动化测试项目的进度与覆盖率。", variant: "project" },
  { key: "plans", icon: "event_note", label: "测试计划", title: "自动化测试计划", variant: "light" },
  { key: "flow", icon: "visibility", label: "可视化编排", title: "可视化编排", subtitle: "通过拖拽测试用例与断言节点，组合可执行的自动化测试流程", variant: "dark" },
  { key: "scenarios", icon: "account_tree", label: "场景组合", title: "电商结账流程", variant: "dark" },
  { key: "api", icon: "api", label: "接口测试用例", title: "接口测试用例", subtitle: "维护接口定义、参数、断言与示例响应，为自动化测试提供接口数据源。", variant: "light" },
  { key: "executions", icon: "play_circle", label: "执行中心", title: "执行控制台", variant: "dark" },
  { key: "reports", icon: "description", label: "测试报告", title: "核心结算流程测试报告", variant: "report" },
  { key: "login", icon: "login", label: "登录", title: "登录", variant: "blank" },
  { key: "environments", icon: "settings_input_component", label: "环境配置", title: "环境配置", variant: "light" },
  { key: "profile", icon: "account_circle", label: "个人中心", title: "个人中心", subtitle: "查看账号资料与当前工作上下文。", variant: "light" },
  { key: "settings", icon: "settings", label: "系统设置", title: "系统设置", variant: "light" },
];

export const dashboardStats = [
  { label: "今日执行任务总数", value: "4,892", icon: "play_circle", delta: "↑ 8.5%", tone: "blue" },
  { label: "通过率", value: "98.2%", icon: "show_chart", delta: "↑ 0.5%", tone: "green" },
  { label: "失败聚类数", value: "7", icon: "scatter_plot", delta: "共 45 个失败用例", tone: "orange" },
  { label: "环境健康度", value: "99.9%", icon: "security", delta: "全部正常", tone: "green" },
];

export const recentRuns = [
  ["#R-8492", "用户身份验证流程 (E2E)", "通过", "14 / 14", "45s", "2 分钟前"],
  ["#R-8491", "数据同步引擎 (API)", "失败", "7 / 8", "1m 12s", "15 分钟前"],
  ["#R-8490", "夜间回归测试 (Full)", "运行中", "450 / 1200", "-", "正在执行 (45%)"],
  ["#R-8489", "支付网关集成测试", "通过", "32 / 32", "2m 30s", "1 小时前"],
];

export const projects = [
  ["Payment Gateway", "支付团队", "4", "98.5%", "99.2%", "15 分钟前", "通过"],
  ["iOS Consumer App", "移动端", "2", "82.1%", "94.5%", "2 小时前", "通过"],
  ["Data Migration Service", "基础架构", "1", "100%", "100%", "1 天前", "通过"],
  ["Checkout Redesign", "电商平台", "3", "65.4%", "88.3%", "3 天前", "警告"],
];

export const planStats = [
  { label: "总计划数", value: "124", icon: "assignment", tone: "blue" },
  { label: "运行中", value: "8", icon: "play_circle", tone: "green" },
  { label: "定时等待", value: "45", icon: "schedule", tone: "orange" },
  { label: "最近失败", value: "3", icon: "error", tone: "red" },
];

export const plans = [
  {
    name: "核心链路全量回归",
    id: "PLN-CORE-001",
    desc: "覆盖主交易、登录、支付模块",
    trigger: "Cron 定时",
    meta: "0 2 * * *",
    envs: ["UAT", "Pre-Prod"],
    steps: ["Data Prep", ["API Regression", "UI Sanity"], "Cleanup"],
    next: "今天 02:00",
    sub: "约 10 小时后",
    enabled: true,
  },
  {
    name: "提测前置拦截检查",
    id: "PLN-CI-042",
    desc: "开发提交合并请求时触发",
    trigger: "Webhook",
    meta: "GitLab MR",
    envs: ["Dev"],
    steps: ["BVT Tests", "Sonar Scan"],
    next: "事件触发",
    sub: "等待 Webhook",
    enabled: true,
  },
  {
    name: "生产环境紧急补丁验证",
    id: "PLN-HOTFIX-99",
    desc: "仅包含核心 P0 用例",
    trigger: "手动触发",
    meta: "",
    envs: ["Production"],
    steps: ["P0 Suite Check"],
    next: "-",
    sub: "",
    enabled: false,
    danger: true,
  },
];

export const apiFolders = [
  { group: "Auth Services", items: [["GET", "Fetch User Profile"], ["PUT", "Update Account Settings"], ["DEL", "Delete Session Token"]] },
  { group: "Payment Flow", items: [["POST", "Create New Transaction"], ["GET", "Payment Detail"]] },
  { group: "Order Management", items: [["POST", "Submit Order"], ["GET", "Order Timeline"]] },
];

export const executionRows = [
  ["136", "Pass", "GET /metrics - 数据聚合", "api.v1.metrics.get"],
  ["135", "Fail", "POST /user/avatar - 文件上传", "api.v1.user.upload_avatar"],
  ["134", "Pass", "DELETE /v1/post/12 - 级联删除", "api.v1.posts.delete"],
  ["133", "Pass", "AUTH /refresh - Token 续期", "api.auth.token.refresh"],
  ["137", "Running", "PUT /config/update - 配置变更", "api.v1.config.update"],
];

export const scenarioSteps = [
  { method: "POST", title: "登录用户", path: "/api/v1/auth/login", token: "auth_token" },
  { method: "GET", title: "获取购物车", path: "/api/v1/cart/{user_id}", active: true },
  { method: "POST", title: "添加商品", path: "/api/v1/cart/items" },
];
