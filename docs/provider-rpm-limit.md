# Provider RPM 限流（排队等待）

## 背景

部分上游模型服务商按 RPM（requests per minute）限流，超限返回 429。客户端（如 Claude Code）收到 429 后往往立即重试，重试本身又是新请求，进一步推高 RPM，形成"429 → 重试 → 更多 429"的限流风暴，最终造成业务侧大面积失败。

cc-gw2 在网关侧提供**主动限流 + 排队等待**：按后端 Provider 独立统计 RPM，达到该 Provider 配置的阈值后，后续路由到它的请求先在网关 hold 住，等 60 秒滑动窗口腾出空位再放行。代价是 TTFT 增加，但上游永远看不到超限 RPM，客户端也拿不到触发立即重试的 429，从根源上避免限流风暴。

## 语义

Provider 级配置字段（`~/.cc-gw/config.json` 的 `providers[]`，WebUI Provider 编辑抽屉 → 高级选项 → 「RPM 限流（排队等待）」）：

| 字段 | JSON 键 | 含义 |
|---|---|---|
| RPM 上限 | `rpmLimit` | 每分钟发往该 Provider 的请求数上限；`null`/`0`/缺省 = 不限流 |
| 最长等待 | `rpmMaxWaitSeconds` | 达到上限后请求最多排队等待的秒数；`null`/缺省 = 默认 30 秒 |

行为：

- **窗口内未达上限**：请求立即放行，行为与未开启限流时完全一致。
- **达到上限**：后续请求按 FIFO 排队，精确预约到"第 N 个旧请求满 60 秒"的时刻再放行。任意 60 秒窗口内实际发往上游的请求数严格 ≤ `rpmLimit`。
- **排队超过最长等待**：请求被拒绝，返回 **HTTP 429 + `Retry-After` 头**（下一个空位释放的秒数，向上取整），客户端按正常退避节奏稍后再来：

```json
HTTP 429 Too Many Requests
Retry-After: 60
{
  "error": {
    "code": "provider_rate_limit_exceeded",
    "message": "Provider RPM limit exceeded; retry after 60s"
  }
}
```

- **等待中客户端断连**：排队槽位自动释放，不占用后续请求的配额。
- **配置热更新**：调低上限时，新请求自动排到已有预约之后；调高立即生效。
- OpenAI 兼容模式的内部重试每次也是一次上游请求，同样受 RPM 约束；重试无法获得空位时停止重试并保留原上游响应。

## 与 API Key 最大并发的区别

| | API Key `maxConcurrency` | Provider `rpmLimit` |
|---|---|---|
| 维度 | 单个 Key 的**同时在途**请求数 | 单个 Provider 的**每分钟**请求数 |
| 超限行为 | 立即 429，不排队 | 排队等待，超时才 429 |
| 统计位置 | 网关侧内存计数（客户端视角） | 网关侧滑动窗口（上游视角） |

两者可同时使用：并发限制控制客户端爆炸半径，RPM 限流保护上游配额。

## 实现要点

- 限流器：`crates/cc-gw-core/src/ratelimit.rs` 的 `ProviderRateLimiter`。每个 Provider 维护一个升序派发时间戳队列（已放行 + 已预约），在单次锁内完成"剪枝 → 计算派发时刻 → 预约"，随后 `sleep_until` 等待。严格 FIFO、无惊群唤醒，等待中的请求被 drop 时由 RAII 守卫释放预约。
- 闸门位置：`proxy_routes.rs` 的 `proxy_standard_request()` 中，路由解析成功之后、请求日志落库之前。被拒绝的请求不写 `request_logs`，只记录事件；被 hold 后放行的请求，等待时间自然计入 `latency_ms`。
- 管理面的 Provider 连通性测试（`POST /api/providers/{id}/test`）与模型探测不走限流器。
- 放行后若上游转发失败（如连接错误），槽位仍然保留——这是保守的"每分钟请求尝试数"口径，与上游侧 RPM 计数一致，保证永不超过承诺上限。

## 事件

拒绝时记录事件（WebUI → Events 可见）：

- `type`: `"provider_rate_limit_rejected"`，`level`: `"warn"`，`source`: `"proxy"`
- `details`: `{"provider": "...", "rpmLimit": 60, "retryAfterSeconds": 60}`

## 配置示例

```json
{
  "providers": [
    {
      "id": "my-provider",
      "label": "官方主账号",
      "baseUrl": "https://api.example.com/v1",
      "rpmLimit": 60,
      "rpmMaxWaitSeconds": 45
    }
  ]
}
```

## 验证

- 限流器单测（虚拟时钟）：`cargo test -p cc-gw-core ratelimit`
- 服务端 429/事件/不限流回归：`cargo test -p cc-gw-server provider_rpm`
- WebUI 表单与真实链路 e2e：`pnpm exec playwright test tests/playwright/provider-rpm.spec.ts --reporter=line`
