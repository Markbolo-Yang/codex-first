# 异步简历诊断接口

小程序正式链路使用数据库任务队列和短轮询。`/run` 仅作为兼容的 curl/SSE 调试入口；客户端断开该入口不会取消后台任务。

## 接口

以下接口由 `routes/index.js` 统一挂载到 `/api/diagnose`，小程序请求地址与
`app.js` 的 `/api` 前缀保持一致。

### 解析简历文件

`POST /api/resume/parse`

使用 `multipart/form-data` 上传字段 `file`。支持不超过 5MB 的 `.doc`、`.docx`、
`.pdf` 和 `.txt` 文件。解析成功后返回真实 `resumeInfo`，小程序再创建诊断任务。

### 创建任务

`POST /api/diagnose/tasks`

```json
{
  "openid": "用户openid",
  "resumeInfo": "简历正文或对象",
  "jobTarget": "目标岗位或对象",
  "customPrompt": "额外要求",
  "resume_id": "简历ID"
}
```

成功返回 HTTP 202；同一用户已有活动任务时返回 HTTP 200 和原 `task_id`。

### 查询增量

`GET /api/diagnose/tasks/:taskId?openid=...&after_seq=0&limit=20`

前端保存 `latest_returned_seq`，下一轮放入 `after_seq`。当 `generation` 变化时应清空旧预览并从 `after_seq=0` 重新获取，这是 Worker 接管过期租约后重新生成的标志。

* `queued/running`：继续轮询。
* `stage=first_token_waiting`：显示“稍等片刻，一些局部还在精心梳理中”。
* `chunks` 非空：隐藏 Loading，按 `seq` 追加预览内容。
* `succeeded`：以 `result` 作为权威结构化报告，刷新用户次数。
* `failed/cancelled`：显示 `error_message`；`charged=false`。

建议轮询间隔 1.5～2 秒。单次轮询均为短 HTTP 请求，不受一次长连接约 60 秒断开的影响。

### 取消任务

`POST /api/diagnose/tasks/:taskId/cancel`

```json
{ "openid": "用户openid" }
```

只有明确调用取消接口才停止后台任务。退出页面或轮询断线不会取消任务。

## 时间规则

时间从 Worker 正式发起火山请求开始计算：

* 20 秒无首字：更新等待状态，不结束任务。
* 80 秒无首字：`FIRST_TOKEN_TIMEOUT`，不扣次数。
* 120 秒模型流仍未结束：`STREAM_STUCK`，不扣次数。
* 80 秒内出现首字：清除首字超时，继续到完整结束或 120 秒上限。

## 成功与扣费

只有以下步骤在同一成功路径完成后，任务才变为 `succeeded`：

1. 火山模型流完整结束；
2. JSON 可解析且包含 `overview/advantages/improve/optimize_ref`；
3. `diagnose_result` 以 `task_id` 幂等写入；
4. 用户次数和 `diagnose_quota_ledger` 在数据库事务中写入；
5. 任务标记 `charged=true`。

任何超时、模型异常、格式异常、取消或数据库事务失败均不会提交扣费。

## Worker 部署

`app.js` 在 HTTP 服务监听成功后调用一次 `startDiagnoseWorker()`。云托管需保持持续运行、最小实例数至少 1。Worker 使用数据库条件更新抢占任务，并通过 `worker_id + lease_expire_at` 续租；多实例时只有抢占成功的实例执行任务。

需要的集合与索引：

* `diagnose_task.task_id` 唯一；`status+created_at`、`status+lease_expire_at`、`openid+status` 非唯一。
* `diagnose_task_chunk.task_id+seq` 唯一。
* `diagnose_quota_ledger.task_id` 唯一。
* `diagnose_result.task_id` 普通索引；结果文档自身使用 `task_id` 作为文档 ID 保证幂等。
