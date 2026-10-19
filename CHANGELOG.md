# Changelog

## [0.4.0] - 2026-10-19

### Added
- 新增 G 检测器（no-evidence）：防止模型无工具验证即宣称完成。
- 模式守卫增加熔断机制与 JSONL 审计日志（`~/.dsh/agent-guard/audit.jsonl`）。
- B 检测器（tool-repeat）加入结果哈希比对，合法迭代不再误杀。
- 前端浮窗支持 G 检测器开关。

### Changed
- `maxInterruptsPerAgent` 默认值从 6 调整为 3，降低 429 触发概率。
- `peerDependencies` 从通配 `*` 改为精确范围：`cordis >=4.0.0 <5.0.0`，`dsh-typert-protocol >=0.2.1-rc.2 <0.3.0-0`。
- 移除 `index.mjs` 中内联的重复 G 检测器，统一走 `registerNoEvidence` 单一路径。

### Fixed
- 修复 DSH Desktop 下裸 `@Remote` 导致的 RPC 失效问题，改用 `ctx.connection.rpc.handle`。
- 修复 `schemastery` 嵌套默认值不展开导致的配置读取为空问题，改由 `apply` 内手动兜底合并。