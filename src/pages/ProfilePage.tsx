import type { AuthUser } from "../api/auth";
import type { EnvironmentOption, ProjectOption } from "../api/projects";
import { Icon } from "../components/Icon";

function formatDate(value?: string) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function userInitials(user?: AuthUser | null) {
  const source = user?.username || user?.account || "AD";
  return source.slice(0, 2).toUpperCase();
}

export function ProfilePage({
  activeEnvironment,
  activeProject,
  user,
}: {
  activeEnvironment?: EnvironmentOption;
  activeProject?: ProjectOption;
  user?: AuthUser | null;
}) {
  return (
    <section className="page profile-page">
      <article className="profile-hero">
        <div className="profile-avatar-large">
          {user?.avatar ? <img alt={user.username} src={user.avatar} /> : userInitials(user)}
        </div>
        <div className="profile-identity">
          <span className="eyebrow">ACCOUNT PROFILE</span>
          <h2>{user?.username || "当前用户"}</h2>
          <p>{user?.account ? `账号：${user.account}` : "登录后可查看完整账号资料"}</p>
          <div className="profile-badges">
            <span className={user?.is_active === false ? "inactive" : "active"}>
              <Icon name={user?.is_active === false ? "block" : "verified_user"} />
              {user?.is_active === false ? "账号已停用" : "账号正常"}
            </span>
            <span><Icon name="schedule" />加入于 {formatDate(user?.created_at)}</span>
          </div>
        </div>
      </article>

      <div className="profile-grid">
        <article className="panel profile-info-panel">
          <div className="panel-title"><h3>个人资料</h3></div>
          <div className="profile-info-list">
            <div><Icon name="badge" /><span>用户名</span><strong>{user?.username || "未设置"}</strong></div>
            <div><Icon name="alternate_email" /><span>登录账号</span><strong>{user?.account || "未设置"}</strong></div>
            <div><Icon name="mail" /><span>邮箱</span><strong>{user?.email || "未设置"}</strong></div>
            <div><Icon name="phone" /><span>手机号</span><strong>{user?.phone || "未设置"}</strong></div>
          </div>
        </article>

        <article className="panel profile-context-panel">
          <div className="panel-title"><h3>当前工作上下文</h3></div>
          <div className="profile-context-card">
            <span className="profile-context-icon"><Icon name="folder_special" /></span>
            <div><small>当前项目</small><strong>{activeProject?.name || "暂未选择项目"}</strong></div>
          </div>
          <div className="profile-context-card">
            <span className="profile-context-icon environment"><Icon name="cloud" /></span>
            <div><small>当前环境</small><strong>{activeEnvironment?.name || "暂未选择环境"}</strong></div>
          </div>
        </article>
      </div>
    </section>
  );
}
