# 异步面试建议链路

## 接口

- `POST /api/interview/tasks`：创建或复用当前用户的面试建议任务。
- `GET /api/interview/tasks/:taskId?openid=...&after_seq=...`：增量读取分片和最终结构化结果。
- `POST /api/interview/tasks/:taskId/cancel`：仅在用户明确取消时终止任务。

面试建议从 `prompt_version` 中读取 `status=online`、`version_code=V_interview_final` 的 `full_prompt_text`。上传简历时复用 `/api/resume/parse`；未上传简历时直接使用有效求职意向。页面退出只停止前端轮询，不取消后台任务。

## 数据集合

部署前新增 `interview_task`、`interview_task_chunk`、`interview_result`、`interview_quota_ledger`，并允许 `users` 文档保存 `active_interview_task_id`。建议为任务状态与创建时间、分片任务 ID 与序号、流水任务 ID 建立索引。

## 次数语义

任务只有在模型流完成、JSON Schema 校验通过、结果入库和扣次流水事务全部成功后才进入 `succeeded` 且 `charged=true`。事务优先扣 `interviewFreeLeft`，再扣 `payInterviewCount`。超时、取消、模型/JSON异常和非 `ok` 输入均不扣次数；前端不得调用旧 `/deductQuota`。
