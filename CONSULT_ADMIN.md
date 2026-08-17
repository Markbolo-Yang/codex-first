# 客服工作台

## 页面入口

小程序内部页面路径：

```text
pages/mentor/consult-admin
```

该页面不会出现在底部 TabBar 中。客服可通过小程序开发版/体验版的指定页面入口访问。

## 管理员配置

后端环境变量 `CONSULT_ADMIN_OPENIDS` 必须配置为允许访问工作台的微信 OpenID；多个 OpenID 使用英文逗号分隔：

```text
CONSULT_ADMIN_OPENIDS=openid_a,openid_b
```

后端会在每次查询或更新前使用小程序 `wx.login` 生成的临时 code 调用微信 `jscode2session`，并以微信返回的真实 OpenID 校验管理员名单。不要把管理员名单或数据库管理凭据写入小程序前端。

## 数据库准备

工作台读取现有的 `user_consult` 集合。建议为以下组合创建索引，以支持按状态筛选和按创建时间倒序分页：

```text
status ASC, createTime DESC
```

“标记已处理”会更新：

- `status`: `processed`
- `remark`: 客服备注
- `processedAt`: 服务端处理时间
- `processedBy`: 执行操作的管理员 OpenID

## 发布检查

1. 确认后端已配置 `APPID`、`APPSECRET` 和 `CONSULT_ADMIN_OPENIDS`。
2. 确认 `user_consult` 已创建所需索引。
3. 使用管理员微信账号打开工作台，验证待处理列表、筛选、下拉刷新和标记处理。
4. 使用普通微信账号访问，确认接口返回“无权访问客服工作台”。
