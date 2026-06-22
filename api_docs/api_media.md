# 媒体存储接口

状态：当前实现
最后核验：2026-06-18

媒体模块使用私有 MinIO/S3 桶保存缺陷截图。接口基础路径为 `/api/v1/media`，成功响应统一为 `{code,message,data}`。

## 上传图片

`POST /media/images?project_id={project_id}` 使用 `multipart/form-data`，文件字段名为 `file`，成功状态为 HTTP `201`。需要 `defect:create` 或 `defect:update` 权限。

支持 PNG、JPEG、GIF、WebP，默认最大 10 MiB。空文件或伪造类型返回 `400`，超限返回 `413`，不支持格式返回 `415`，对象存储不可用返回 `503`。

```json
{
  "id": 12,
  "original_filename": "checkout.png",
  "content_type": "image/png",
  "size_bytes": 183024,
  "download_url": "https://minio.example/testplatform/...?X-Amz-Signature=...",
  "created_at": "2026-06-17T08:00:00"
}
```

上传成功后，前端在创建或更新缺陷时把返回的 `id` 放入 `media_ids`。粘贴到富文本的图片同时以 `src="/__defect_media__/{id}"` 相对占位地址写入 `content_html`，展示时再按附件响应替换为当前预签名 URL；`data-media-id` 仅作为可选辅助属性，预签名 URL 会过期，不得持久化。

## 刷新访问地址

`GET /media/{media_id}/url?project_id={project_id}` 需要 `defect:view`，返回：

```json
{
  "url": "https://minio.example/testplatform/...?X-Amz-Signature=...",
  "expires_in": 3600
}
```

## 删除媒体

`DELETE /media/{media_id}?project_id={project_id}` 允许上传者或具备项目 `defect:update` 权限的用户删除。存储不可用时返回 `503` 并保留元数据，客户端可重试。

媒体只能绑定到同一项目的缺陷，默认只能绑定自己上传且尚未被其他缺陷占用的对象。SVG 当前不支持。

## 配置与部署

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MINIO_ENDPOINT_URL` | `http://127.0.0.1:9000` | 后端访问地址 |
| `MINIO_PUBLIC_ENDPOINT_URL` | 空 | 浏览器可访问的签名地址；空时复用内部地址 |
| `MINIO_BUCKET` | `testplatform` | 预先创建的私有桶 |
| `MINIO_REGION` | `us-east-1` | S3 签名区域 |
| `MINIO_SECURE` | `false` | 未写 scheme 时是否补 `https` |
| `MEDIA_MAX_IMAGE_BYTES` | `10485760` | 图片最大字节数 |
| `MEDIA_PRESIGNED_URL_EXPIRE_SECONDS` | `3600` | 临时地址有效期 |

`MINIO_ACCESS_KEY` 和 `MINIO_SECRET_KEY` 必须仅由后端读取。部署前执行 Alembic revision `0019_media_objects`，预建私有桶，并授予服务账号对 `testplatform/projects/*` 的 `s3:PutObject`、`s3:GetObject` 和 `s3:DeleteObject` 权限。
