import type { RouteMeta } from "../types";

export const routes: RouteMeta[] = [
  { key: "dashboard", icon: "dashboard", label: "工作台", title: "全局运营仪表盘", variant: "dashboard" },
  { key: "projects", icon: "folder_special", label: "项目管理", title: "项目管理", subtitle: "监控并管理所有自动化测试项目的进度与覆盖率。", variant: "project" },
  { key: "plans", icon: "event_note", label: "测试计划", title: "自动化测试计划", variant: "light" },
  { key: "flow", icon: "visibility", label: "可视化编排", title: "可视化编排", subtitle: "通过拖拽测试用例与断言节点，组合可执行的自动化测试流程", variant: "dark" },
  { key: "scenarios", icon: "account_tree", label: "场景组合", title: "场景组合", variant: "dark" },
  { key: "api", icon: "api", label: "接口测试用例", title: "接口测试用例", subtitle: "维护接口定义、参数、断言与响应，为自动化测试提供接口数据源。", variant: "light" },
  { key: "executions", icon: "play_circle", label: "执行中心", title: "执行控制台", variant: "dark" },
  { key: "defects", icon: "bug_report", label: "缺陷跟踪", title: "缺陷跟踪", subtitle: "记录、分派并推进 Bug 从创建到关闭的完整流程。", variant: "light" },
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
