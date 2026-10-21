# Changelog

## [0.4.0] - 2026-10-19

### Changed
- **Renamed**: `dsh-agent-guard` → `dsh-sentinel` to avoid name collision with an existing GitHub project (a5557/dsh-agent-guard) that has a completely different purpose.
- 所有命名空间（`NS`、RPC 端点、`__dshIconRegistry` ID）统一改为 `sentinel`。
- `maxInterruptsPerAgent` 默认值从 6 调整为 3，降低 429 触发概率。
- `peerDependencies` 从通配 `*` 改为精确范围：`cordis >=4.0.0 <5.0.0`，`dsh-typert-protocol >=0.2.1-rc.2 <0.3.0-0`。
- 移除 `index.mjs` 中内联的重复 G 检测器，统一走 `registerNoEvidence` 单一路径。

### Added
- 新增 G 检测器（no-evidence）：防止模型无工具验证即宣称完成。
- 模式守卫增加熔断机制与 JSONL 审计日志（`~/.dsh/sentinel/audit.jsonl`）。
- B 检测器（tool-repeat）加入结果哈希比对，合法迭代不再误杀。
- 前端浮窗支持 G 检测器开关。

### Fixed
- 修复 DSH Desktop 下裸 `@Remote` 导致的 RPC 失效问题，改用 `ctx.connection.rpc.handle`。
- 修复 `schemastery` 嵌套默认值不展开导致的配置读取为空问题，改由 `apply` 内手动兜底合并。

## [0.5.0] - 2026-10-21

### Changed
- **Renamed**: `dsh-sentinel` → `dsh-shepherd`，命名空间、RPC 端点、图标注册 ID、审计目录统一改为 `shepherd`。
- 检测器统一返回 `{ fired, suspicion, evidenceType }`，干预强度由新引入的仲裁层决定。
- `tool-repeat` 从 `tools/post-execute` 迁移到 `tools/pre-execute`，BLOCK/STOP 统一走 `deny`，不再额外 cancel。
- `no-progress` 引入 identical / oscillating / changed / empty 关系状态机，合法轮询不再误杀。
- `no-evidence` 收紧证据定义（非 error 且非空），增加写后验证规则。
- `mode-guard` 失败计数生命周期从回合边界改为用户消息边界。

### Added
- 仲裁层 `arbiter.mjs`：WARN / BLOCK / STOP 三档干预 + 屡犯升级。
- `hasCharLevelCycle`：字符级周期检测，补单字符/短语退化漏判。
- `observationFingerprint` + `semanticArgHash`：易变量剥离与参数主干语义哈希。
- `interrupt.mjs` 新增 `intervene(level)`，`fire` 保留为 STOP 档实现。

### Fixed
- `analyzeToolSequence` 首次调用误判 `sameTail`。
- `detectTextRepeat` 前置长度检查挡住字符级分支。
- `noProgressFingerprint` 的 `isEmpty` 不再依赖 `checkResultHash` 的字符串切分。
- `interrupt.mjs` 不再依赖 `this` 绑定。
- `mode-guard` 中 `WeakMap.set(undefined)` 潜在崩溃。
- 移除 `guards.mjs` 与 `mode-guard.mjs` 重复注册的 `agent/pre-step` 监听器。