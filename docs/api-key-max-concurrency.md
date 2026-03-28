# API Key Per-Key Max Concurrency

## 背景

当前网关对每个 API Key 的并发请求数没有限制，所有 Key（包括 Wildcard Key）均可发起无限数量的同时上游请求。添加可配置的 `maxConcurrency` 字段后，运营者可以为单个 Key 设定并发上限，保护上游 Provider 配额、控制故障爆炸半径。

## 语义

| `max_concurrency` 值 | 行为 |
|---|---|
| `NULL` | 无限制（默认） |
| `0` | 无限制 |
| `> 0` | 同时进行中的请求不超过该值 |

超限时返回 **HTTP 429**，不做排队等待。

Wildcard Key 也支持此限制。

## 数据库变更

**文件**: `crates/cc-gw-core/src/storage.rs`

在 `initialize_database()` 末尾添加：

```sql
ALTER TABLE api_keys ADD COLUMN max_concurrency INTEGER DEFAULT NULL
```

使用现有 `maybe_add_column()` 模式，对旧库自动迁移、对新库幂等。

## 核心类型变更

### ResolvedApiKey

**文件**: `crates/cc-gw-core/src/api_keys.rs`

```rust
pub struct ResolvedApiKey {
    pub id: i64,
    pub name: String,
    pub is_wildcard: bool,
    pub provided_key: String,
    pub max_concurrency: Option<i64>,  // 新增
}
```

在 `resolve_api_key()` 中：
- 普通 Key 路径：从 `api_keys` 表查询时增加 `max_concurrency` 列并写入返回值
- Wildcard Key 路径（无 Authorization header）：从 wildcard 行读取 `max_concurrency`

### ApiKeyListItem

```rust
pub struct ApiKeyListItem {
    // ... 现有字段 ...
    pub max_concurrency: Option<i64>,  // 新增
}
```

`list_api_keys()` 的 SELECT 和映射同步增加该列。

### create / update 签名

- `create_api_key()` 增加 `max_concurrency: Option<i64>` 参数
- `update_api_key_settings()` 增加 `max_concurrency: Option<Option<i64>>` 参数（patch 语义：`Some(None)` 清除限制，`Some(Some(n))` 设置限制，`None` 不变更）

## 内存并发计数

### AppState 新增字段

**文件**: `crates/cc-gw-server/src/main.rs`

```rust
struct AppState {
    // ... 现有字段 ...
    active_requests_by_api_key: Arc<Mutex<HashMap<i64, u64>>>,
}
```

初始化为空 `HashMap`。

### RequestActivityGuard 扩展

**文件**: `crates/cc-gw-server/src/proxy_routes.rs`

在 `RequestActivityGuard` 中增加：

```rust
struct RequestActivityGuard {
    // ... 现有字段 ...
    api_key_id: Option<i64>,
    active_requests_by_api_key: Arc<Mutex<HashMap<i64, u64>>>,
}
```

- `new()` 时如果 `api_key_id` 存在，递增对应计数
- `Drop::drop` 时递减对应计数（为 0 则移除 entry）

### 并发检查

在 `proxy_standard_request()` 和 `dynamic_fallback()` 中，`authorize_request_with_context()` 成功之后、`RequestActivityGuard::new()` 之前插入：

```rust
if let Some(max) = api_key_context.max_concurrency {
    if max > 0 {
        let current = state.active_requests_by_api_key
            .lock().ok()
            .and_then(|m| m.get(&api_key_context.id).copied())
            .unwrap_or(0);
        if current >= max as u64 {
            // 记录事件
            // 返回 429
        }
    }
}
```

**注意**：检查与递增不是原子的（先检查再创建 Guard），存在 TOCTOU 窗口。这是可接受的——在极端高并发场景下可能有少量请求略微超过限制，但不会持续超限。如果需要严格原子性，可以将检查和递增合并到同一个 lock scope 中。

推荐实现：将并发检查逻辑合并到 `RequestActivityGuard::new()` 内部，在同一个 `lock()` 内完成检查和递增：

```rust
impl RequestActivityGuard {
    fn new_with_concurrency_check(
        state: &AppState,
        // ... 其他参数 ...
        api_key_id: i64,
        max_concurrency: Option<i64>,
    ) -> Result<Self, ()> {
        // 在同一个 lock 内检查并递增
        if let Some(max) = max_concurrency.filter(|&m| m > 0) {
            let mut map = state.active_requests_by_api_key.lock().map_err(|_| ())?;
            let current = *map.get(&api_key_id).unwrap_or(&0);
            if current >= max as u64 {
                return Err(());  // 并发超限
            }
            map.entry(api_key_id).and_modify(|c| *c += 1).or_insert(1);
        } else {
            // 无限制，仅递增
            increment_active_entry(&state.active_requests_by_api_key, &api_key_id.to_string());
        }
        // ... 构造 Guard ...
        Ok(guard)
    }
}
```

## 429 响应格式

```json
HTTP 429 Too Many Requests
{
  "error": {
    "code": "concurrency_limit_exceeded",
    "message": "API key has reached its maximum concurrency limit of 5"
  }
}
```

## Admin API 变更

**文件**: `crates/cc-gw-server/src/admin_routes.rs`

### POST /api/keys (创建)

`CreateApiKeyBody` 增加：
```rust
#[serde(rename = "maxConcurrency")]
max_concurrency: Option<i64>,
```

传给 `create_api_key()`。

### PATCH /api/keys/{id} (更新)

在 JSON body 解析中增加 `maxConcurrency` 字段：
- `null` → 清除限制（`Some(None)`）
- 数字 → 设置限制（`Some(Some(n))`）
- 缺失 → 不变更（`None`）

传给 `update_api_key_settings()`。

## 前端变更

### TypeScript 类型

**文件**: `src/web/src/types/apiKeys.ts`

```typescript
export interface ApiKeySummary {
  // ... 现有字段 ...
  maxConcurrency: number | null  // 新增
}
```

### API Payload 类型

**文件**: `src/web/src/services/apiKeys.ts`

```typescript
export interface CreateApiKeyPayload {
  // ... 现有字段 ...
  maxConcurrency?: number | null
}

export interface ApiKeyMutationPayload {
  // ... 现有字段 ...
  maxConcurrency?: number | null
}
```

### UI 组件

**文件**: `src/web/src/pages/api-keys/ApiKeysDialogs.tsx`

- `CreateApiKeyDialog`：在 Description 输入框后增加 Number Input（label "Max Concurrency"，placeholder "Unlimited"）
- `EditApiKeyEndpointsDialog` 或新建编辑对话框：增加 Max Concurrency 编辑字段

**文件**: `src/web/src/pages/api-keys/ApiKeysSections.tsx`

- `ApiKeyCard`：在 `KeyMetaChip` 行增加一个 chip 显示并发限制（如 "Max concurrent: 5" 或 "Unlimited"）

**文件**: `src/web/src/pages/api-keys/useApiKeysPageState.ts`

- 增加 `newKeyMaxConcurrency` state
- `createKeyMutation` payload 中传入 `maxConcurrency`
- `handleCreateKey` 中传入 maxConcurrency

### 国际化

增加翻译 key：
- `apiKeys.maxConcurrency` — "Max Concurrency"
- `apiKeys.maxConcurrencyPlaceholder` — "Unlimited"
- `apiKeys.maxConcurrencyHint` — "Maximum concurrent requests allowed for this key. Leave empty for unlimited."
- `apiKeys.maxConcurrencyDisplay` — "Max concurrent: {{count}}"
- `apiKeys.maxConcurrencyUnlimited` — "Unlimited"

## 审计与事件

并发被拒时记录事件：
- `event_type`: `"api_key_concurrency_rejected"`
- `level`: `"warn"`
- `source`: `"auth"`
- `api_key_id` 和 `api_key_name` 填充
- `message`: "Request rejected: API key {name} exceeded max concurrency of {max}"

配置变更时记录审计日志：
- `operation`: `"update_max_concurrency"`
- `details`: JSON 包含旧值和新值

## 变更文件汇总

| 层 | 文件 | 变更 |
|---|---|---|
| DB | `crates/cc-gw-core/src/storage.rs` | `max_concurrency` 列迁移 |
| Core | `crates/cc-gw-core/src/api_keys.rs` | 类型、CRUD 增加 `max_concurrency` |
| Server | `crates/cc-gw-server/src/main.rs` | `AppState.active_requests_by_api_key`，`CreateApiKeyBody` |
| Server | `crates/cc-gw-server/src/proxy_routes.rs` | `RequestActivityGuard` 扩展 + 并发检查 |
| Server | `crates/cc-gw-server/src/admin_routes.rs` | 创建/更新接口增加 `maxConcurrency` |
| Web 类型 | `src/web/src/types/apiKeys.ts` | 接口增加 `maxConcurrency` |
| Web 服务 | `src/web/src/services/apiKeys.ts` | Payload 类型增加 `maxConcurrency` |
| Web UI | `src/web/src/pages/api-keys/ApiKeysDialogs.tsx` | 创建/编辑对话框增加输入框 |
| Web UI | `src/web/src/pages/api-keys/ApiKeysSections.tsx` | Key Card 显示并发限制 |
| Web UI | `src/web/src/pages/api-keys/useApiKeysPageState.ts` | 状态管理增加 `maxConcurrency` |
| i18n | `src/web/src/i18n/` | 翻译 key |

## 测试验证

1. **数据库迁移**: `cargo test -p cc-gw-core storage` — 验证 `max_concurrency` 列已添加
2. **CRUD**: `cargo test -p cc-gw-core api_keys` — 创建/列表/更新含 `max_concurrency` 的 Key
3. **429 行为**: 手动测试 — 设置 `max_concurrency: 1`，同时发 2 个请求，验证第二个返回 429
4. **Wildcard**: 给 wildcard key 设置 `max_concurrency`，验证未认证请求被限流
5. **前端**: 构建后创建带并发限制的 Key，验证卡片展示，编辑后验证更新
6. **E2E**: `pnpm test:e2e:web:core`
