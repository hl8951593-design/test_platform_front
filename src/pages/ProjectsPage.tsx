import { useState } from "react";
import { createProject, type ProjectOption } from "../api/projects";
import { IconButton } from "../components/Buttons";
import { Icon } from "../components/Icon";
import type { ActionHandler } from "../types";

export function ProjectsPage({
  isLoading,
  loadError,
  onAction,
  onCreated,
  projects,
}: {
  isLoading: boolean;
  loadError: string;
  onAction: ActionHandler;
  onCreated: (project: ProjectOption) => void;
  projects: ProjectOption[];
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <section className="page page-projects">
      <div className="filter-bar">
        <button className="seg active" onClick={() => onAction("全部项目")} type="button">全部</button>
        <button className="seg" onClick={() => onAction("高风险项目")} type="button">高风险</button>
        <button className="seg" onClick={() => onAction("最近活跃")} type="button">最近活跃</button>
        <label className="inline-field"><Icon name="search" /><input placeholder="搜索项目名称或团队" /></label>
        <button className="btn primary" onClick={() => setCreateOpen(true)} type="button">
          <Icon name="add" />
          创建项目
        </button>
      </div>
      <div className="split-layout">
        <article className="panel table-panel">
          <div className="panel-title">
            <h3>项目列表</h3>
            <button onClick={() => onAction("批量导入")} type="button">批量导入</button>
          </div>
          <table className="data-table project-table">
            <thead>
              <tr>
                <th>项目</th>
                <th>负责人</th>
                <th>计划</th>
                <th>覆盖率</th>
                <th>通过率</th>
                <th>最近更新</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr className="table-state-row">
                  <td colSpan={8}>
                    <div className="list-state loading">
                      <span className="list-state-icon"><Icon name="progress_activity" /></span>
                      <h4>正在加载项目</h4>
                      <p>正在从后端获取当前账号可见的项目列表。</p>
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && loadError && (
                <tr className="table-state-row">
                  <td colSpan={8}>
                    <div className="list-state error">
                      <span className="list-state-icon"><Icon name="error" /></span>
                      <h4>项目加载失败</h4>
                      <p>{loadError}</p>
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && !loadError && projects.length === 0 && (
                <tr className="table-state-row">
                  <td colSpan={8}>
                    <div className="list-state empty">
                      <span className="list-state-icon"><Icon name="folder_special" /></span>
                      <h4>暂无项目</h4>
                      <p>创建第一个项目后，接口用例、环境变量和执行记录都会归属到该项目下。</p>
                      <button className="btn primary" onClick={() => setCreateOpen(true)} type="button">
                        <Icon name="add" />
                        创建项目
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {projects.map((project) => (
                <tr key={project.id}>
                  <td><strong>{project.name}</strong><small>{project.description}</small></td>
                  <td>{project.owner}</td>
                  <td>-</td>
                  <td>-</td>
                  <td>-</td>
                  <td>{project.updatedAt}</td>
                  <td><span className={project.status === "正常" ? "status status-通过" : "status status-失败"}>{project.status}</span></td>
                  <td><IconButton icon="more_horiz" label={`管理 ${project.name}`} onAction={onAction} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
        <aside className="panel health-panel">
          <div className="panel-title">
            <h3>项目健康概览</h3>
            <button onClick={() => onAction("刷新健康概览")} type="button">刷新</button>
          </div>
          {projects.slice(0, 4).map((project, index) => (
            <div className="health-row" key={project.id}>
              <span>{project.name}</span>
              <div className="progress"><i style={{ width: `${92 - index * 11}%` }} /></div>
              <strong>{92 - index * 11}%</strong>
            </div>
          ))}
          {projects.length === 0 && (
            <div className="side-empty">
              <Icon name="monitoring" />
              <strong>暂无健康数据</strong>
              <p>创建项目后，这里会展示覆盖率、通过率和最近执行趋势。</p>
            </div>
          )}
          <div className="risk-card">
            <Icon name="warning" />
            <div>
              <strong>项目权限已接入</strong>
              <p>接口测试用例会跟随顶部选中的项目保存，避免用例脱离项目数据边界。</p>
            </div>
          </div>
        </aside>
      </div>

      {createOpen && (
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          onCreated={(project) => {
            onCreated(project);
            onAction(`创建项目 ${project.name}`);
            setCreateOpen(false);
          }}
        />
      )}
    </section>
  );
}

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: ProjectOption) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      setMessage("请输入项目名称");
      return;
    }

    setIsSaving(true);
    setMessage("");
    try {
      const project = await createProject({ name: name.trim(), description: description.trim() });
      onCreated(project);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建项目失败，请稍后重试");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-modal="true" className="project-create-modal" role="dialog">
        <div className="modal-head">
          <div>
            <span className="eyebrow">创建项目</span>
            <h3>新建自动化测试项目</h3>
            <p>项目创建后，当前用户会自动成为项目创建者。</p>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭" type="button">
            <Icon name="close" />
          </button>
        </div>
        <label className="modal-field">
          <span>项目名称</span>
          <input onChange={(event) => setName(event.target.value)} placeholder="例如：核心支付平台" value={name} />
        </label>
        <label className="modal-field">
          <span>项目说明</span>
          <textarea
            onChange={(event) => setDescription(event.target.value)}
            placeholder="说明项目范围、业务线或接口测试目标"
            value={description}
          />
        </label>
        {message && <p className="form-message">{message}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} type="button">取消</button>
          <button className="btn primary" disabled={isSaving} onClick={submit} type="button">
            <Icon name="save" />
            {isSaving ? "创建中..." : "创建"}
          </button>
        </div>
      </section>
    </div>
  );
}
