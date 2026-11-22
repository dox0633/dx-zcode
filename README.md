# dx-zcode

**DX Zcode插件** — 面向 DeepSeek Harness 的专用集成。

一次解决四个此前互相纠缠的问题：

| 问题 | 解决方式 |
|---|---|
| **3012 / 风控** | 模型流量完全交给官方 CLI 的 app-server 发出，插件不拼任何 HTTP envelope |
| **一键领取福利** | `marketing/touch` 探测 + `billing/claim` 领取，阿里云无感验证自动求解 |
| **多账号** | 按数据根组织账号池，支持本机登录 + 外部目录 + Z·SWITCH 账号库 |
| **网关转发** | 本地 `127.0.0.1` HTTP，同时说 OpenAI 与 Anthropic 两套协议 |

---

## 为什么之前的方案都不行

这一节是逆向 ZCode 3.18.2 后得到的**实测结论**，不是推测。

### ① 自建 HTTP 请求必然 3012

```
POST https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages
Authorization: Bearer <plan JWT>
→ HTTP 405 {"code":3012,"msg":"This client is not supported. Please use the official ZCode client."}
```

`/api/v1/ultra*` 路由要 OAuth access token，而本机凭据里只有过期的
`oauth:zai_cn:access_token`，**没有 refresh_token**，刷新不了。
且服务端下发 `codingPlanSignature.enable = true`，需要客户端签名握手。

**结论：模型流量只能由官方 CLI 发出。**

### ② 账号通道为什么消失（关键发现）

CLI 的 standalone 账号解析有一处不对称：

```js
// 认国内站
const ZAI_CN = 'zai_cn'
isZaiOAuthProvider = e => e === 'zai' || e === ZAI_CN

// 但 start-plan 分支只认两个字面量
readStartPlanSession: family = active['oauth:active_provider']
                      if (family !== 'zai' && family !== 'bigmodel') return undefined
```

国内站登录写入的正是 `zai_cn`，于是 `account:zai-start-plan`
**永远不进 provider registry** —— `session/create` 的模型目录里
根本没有 z.ai 账号通道。

这就是「订阅有额度、插件反代不出来」的确切断点。

**解法：影子数据根。** 把数据根复制成隔离副本，
`oauth:active_provider` 改写为 `zai`，**同时**把
`oauth:<family>:user_info` 等键名一并迁移
（CLI 用 `oauth:${family}:user_info` 拼 profile 键，
只改 provider 不改键名，`profileIdentity()` 照样拿到 null）。
原桌面目录一字不动。

### ③ 用户自建 provider 会挤掉账号通道

CLI 的 provider 解析：

```js
t.accountProviders.entries().filter(([x]) => t.zcodeBuiltinProviders.has(x))
```

只保留**同时在 builtin 里声明过**的 account provider。
如果 `provider_config.json` 里全是自建供应商，账号通道就被完全排除。
影子目录因此不复制用户的 `provider_config.json`。

### ④ 领取的 3007 闸门

```
POST /api/v1/zcode-plan/billing/claim
→ 400 {"code":3007,"msg":"captcha verify failed"}
```

必须带 `X-Aliyun-Captcha-Verify-Param`。无头模式被判 `F001`，
必须用**带界面**的 Chromium 加 `--disable-blink-features=AutomationControlled`
运行阿里云官方 SDK。

**实测对比**（同一活动、同一账号）：

| 条件 | 结果 |
|---|---|
| 无验证码 | `3007 captcha verify failed` |
| 有验证码 | `1003 target already exists`（验证码已通过，活动已领过） |

---

## 安装

### 1. 前置：npm 版 ZCode CLI

桌面端内核**不带** `provider/zcode-builtin.json`，`app-server` 起不来。

```powershell
npm i -g zcode-app-cli@3.18.2-47
```

装好后确认：

```powershell
node "$env:APPDATA\npm\node_modules\zcode-app-cli\vendor\zcode.cjs" doctor
```

插件会自动发现，也可以显式指定 `zcodeCliPath`。

### 2. 安装插件（tgz 正式形态）

desktop profile 由 Electron 独占管理，`dsh plugin add` 对它不可用。用本仓库安装器，
它复刻 dsh-purge-community 的存活模式（tgz 落持久 pkgs 库 → `file:` 依赖 → bundle 注册，
目录型 `file:` 依赖会被插件管理器清理，tgz 型长期存活）：

```powershell
cd dx-zcode
node bin\install-tgz.mjs
```

幂等，可重复运行；升级后重跑一次即可。卸载用 `node bin\rollback.mjs`。

### 3. 重启 DSH

打开设置 → 模型，应能看到 `DX Zcode（官方 CLI）`。

---

## 面板入口

- **设置页「DX Zcode」分区**（首选位置）：设置导航里的礼物盒图标 + 「DX Zcode」，
  点开即完整控制面板 —— 双站登录、福利领取、剩余 token（30 秒自动刷新）、
  账号启停、网关开关、调用记录。
- **侧栏「DX Zcode」按钮**：主界面侧栏的同名入口，打开同一面板。
- **设置 → 插件 → DX Zcode → 详情**：插件详情页的配置区视图。

---

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 注册模型 provider |
| `zcodeCliPath` | 自动 | `vendor/zcode.cjs` 绝对路径 |
| `zcodeDataBaseDir` | 自动 | ZCode 数据根，留空读 `setting.json` 的 `dataBaseDir` |
| `extraDataDirs` | `[]` | 额外账号数据根（多账号） |
| `zswitchDataRoot` | 自动 | Z·SWITCH 账号库根目录 |
| `providerId` | `zcode-cli` | 注册给 DSH 的 provider id |
| `gatewayEnabled` | `false` | 启动本地网关 |
| `gatewayPort` | `8788` | 网关端口 |
| `gatewayHost` | `127.0.0.1` | 网关监听地址 |
| `gatewayAuthToken` | 空 | 网关鉴权密钥 |
| `autoClaimMinutes` | `0` | 自动领取间隔（分钟），0 关闭 |
| `turnTimeoutMs` | `600000` | 单轮超时 |
| `appServerTimeoutMs` | `120000` | app-server 请求超时 |

---

## 网关

```bash
# OpenAI 协议
curl http://127.0.0.1:8788/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"GLM-5.3-Flash","messages":[{"role":"user","content":"你好"}]}'

# Anthropic 协议
curl http://127.0.0.1:8788/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"GLM-5.3-Flash","max_tokens":64,"messages":[{"role":"user","content":"你好"}]}'

# 模型列表 / 健康检查
curl http://127.0.0.1:8788/v1/models
curl http://127.0.0.1:8788/health
```

支持的客户端：Claude Code、Codex CLI、Cherry Studio、Cline、LobeChat 等任何
OpenAI / Anthropic 兼容工具。

---

## 架构

```
DSH Agent
   │
   ▼
provider "zcode-cli"
   │
   ▼
ZcodeWelfareAdapter.stream()
   │
   ▼
AccountPool.pick()  ──►  AppServerClient（每账号一个常驻进程）
   │                          │  spawn zcode.cjs app-server --stdio
   │                          ├─ session/create   → 读模型目录
   │                          ├─ session/subscribe → 事件流
   │                          ├─ session/setModel → 切通道
   │                          └─ session/send     → 发回合
   │                                 │
   │                                 ▼
   │                     interaction/requestProviderRuntimeHeaders
   │                     ← 宿主回 { headersApplied, requestAuth.headers }
   │                       （验证码 X-Aliyun-Captcha-Verify-Param 从这里注入）
   │                                 │
   │                                 ▼
   │                      官方 CLI 自己发请求 → zcode.z.ai
   │
   └──► Gateway（可选）──► OpenAI / Anthropic HTTP 协议
```

---

## 文件

| 文件 | 职责 |
|---|---|
| `lib/credentials.js` | `enc:v1` / `enc:v2` 解密，系统凭据库读取 |
| `lib/family-alias.js` | 影子数据根，family 改写与键名迁移 |
| `lib/app-server.js` | stdio JSON-RPC 客户端，验证码注入点 |
| `lib/welfare.js` | 活动探测、余额查询、领取 |
| `lib/captcha.js` | 阿里云无感验证求解（CDP + 官方 SDK） |
| `lib/pool.js` | 账号池、额度缓存、并行领取 |
| `lib/gateway.js` | 双协议本地网关 |
| `lib/index.js` | provider 适配器与插件入口 |

---

## 已知边界

- **start-plan 模型通道仍受上游 3012 闸门限制。** 插件已把验证码正确注入
  （已验证 `headersApplied` 契约生效），但 3.18.2 的服务端同时校验客户端签名，
  仅靠验证码不足以通过。领取侧不受影响。
- 网关不支持工具调用透传（CLI 的工具集不对外）。
- 图片输入取决于 CLI 侧是否支持，插件当前按纯文本处理。

---

## 许可

MIT
