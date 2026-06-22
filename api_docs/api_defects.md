# 缺陷跟踪接口

状态：当前实现
最后核验：2026-06-18

缺陷模块用于按项目记录 Bug，并维护从创建到关闭或重新激活的生命周期。基础路径为 `/api/v1`。成功响应统一为 `{code, message, data}`。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/defects?project_id={id}` | 查询或创建当前项目缺陷 |
| GET/PUT/DELETE | `/defects/{defect_id}?project_id={id}` | 查询、更新或删除缺陷 |
| PUT | `/defects/{defect_id}/status?project_id={id}` | 推进缺陷状态 |
| POST | `/media/images?project_id={id}` | 上传待绑定的缺陷图片 |
| GET/DELETE | `/media/{media_id}/url?project_id={id}` / `/media/{media_id}?project_id={id}` | 刷新图片地址或删除附件 |

建议权限点包括 `defect:view`、`defect:create`、`defect:update`、`defect:delete` 和 `defect:transition`。

## 状态枚举

| 值 | 展示文案 |
| --- | --- |
| `new` | 新创建 |
| `active` | 已激活 |
| `confirmed` | 已确认 |
| `fixed` | 已修复 |
| `verified` | 已验证 |
| `closed` | 已关闭 |
| `reopened` | 重新激活 |

后端应校验状态流转合法性，并在非法流转时返回 HTTP `409` 或 `422`。

## 查询参数

```http
GET /api/v1/defects?project_id=1&keyword=支付&status=confirmed&urgency=critical&page_size=200
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `project_id` | 是 | 当前项目 ID |
| `keyword` | 否 | 按标题、指派人、报告人或内容搜索 |
| `status` | 否 | 缺陷状态 |
| `urgency` | 否 | 紧急程度 |
| `page` / `page_size` | 否 | 分页参数 |

响应可为数组，也可为 `{items,total,page,page_size}` 分页结构。前端当前兼容 `items`、`records` 和 `data`。

列表只消费摘要字段；进入 `/defects/{defect_id}` 详情页后，前端调用 `GET /defects/{defect_id}?project_id={id}` 获取正文、附件和最新元数据，避免把列表快照作为详情权威数据。

## 创建和更新

```json
{
  "title": "支付成功后订单状态未同步",
  "assignee": "qa_owner",
  "bug_type": "functional",
  "urgency": "critical",
  "status": "new",
  "content_html": "<p>复现步骤...</p><img src=\"/__defect_media__/12\" data-media-id=\"12\" alt=\"checkout.png\">",
  "media_ids": [12, 13]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | Bug 标题 |
| `assignee` | 否 | 指派人账号、姓名或用户 ID，具体类型由后端统一 |
| `bug_type` | 是 | `functional`、`ui`、`performance`、`security`、`compatibility`、`data`、`other` |
| `urgency` | 是 | `low`、`medium`、`high`、`critical` |
| `status` | 是 | 当前状态；创建时默认建议为 `new` |
| `content_html` | 是 | 富文本内容 HTML；正文图片使用相对地址 `/__defect_media__/{media_id}` 引用已绑定媒体，不能持久化会过期的预签名 URL |
| `media_ids` | 否 | 上传接口返回的媒体 ID；创建有附件时传入，无图片时可省略 |

编辑时不传 `media_ids` 表示保留原附件；传完整 ID 数组表示替换绑定；传 `[]` 表示解绑全部附件。旧客户端不传该字段仍可创建和编辑无图片 Bug。

后端清洗富文本 HTML，禁止脚本、事件属性和不安全 URL，并保留合法的相对图片地址 `/__defect_media__/{media_id}`；`data-media-id` 可以保留，但不是恢复正文图片的唯一依据。占位地址中的 ID 必须同时存在于本次绑定的 `media_ids` 或缺陷已有附件中；前端根据响应的 `attachments[].download_url` 把占位地址替换成当前访问地址。独立选择的图片显示在附件区，粘贴图片在正文显示且不重复出现在附件区。

## 状态流转

```http
PUT /api/v1/defects/18/status?project_id=1
```

```json
{
  "status": "fixed"
}
```

响应返回更新后的缺陷对象。若状态已被其他用户修改，建议返回 HTTP `409` 并附带当前状态，前端重新加载列表后再操作。

## 响应对象

```json
{
  "id": 18,
  "project_id": 1,
  "title": "支付成功后订单状态未同步",
  "assignee_name": "李雷",
  "bug_type": "functional",
  "urgency": "critical",
  "status": "confirmed",
  "content_html": "<p>复现步骤...</p>",
  "attachments": [
    {
      "id": 12,
      "original_filename": "checkout.png",
      "content_type": "image/png",
      "size_bytes": 183024,
      "download_url": "https://minio.example/testplatform/...?X-Amz-Signature=...",
      "created_at": "2026-06-17T08:30:00"
    }
  ],
  "reporter_name": "韩梅梅",
  "created_at": "2026-06-17T08:00:00",
  "updated_at": "2026-06-17T09:00:00"
}
```

媒体上传、刷新、删除、格式限制和错误状态详见 [媒体存储接口](api_media.md)。
