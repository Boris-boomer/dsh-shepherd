/**
 * dsh-shepherd · 模式守卫。
 * 失败计数生命周期与会话/用户消息边界对齐，而非回合。
 * 审计记录同时写 JSONL（持久化）和内存环形缓冲区（供前端浮窗展示）。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'mode-guard'
export const MODE_VALUES = ['planning', 'coding', 'verify']

const MODE_GATES_TOOLS = { planning: false, coding: true, verify: false }
const MODE_LABEL = {
  planning: 'planning（规划中，只读分析）',
  coding: 'coding（编码中，敏感工具需审批）',
  verify: 'verify（验证中，放行执行类工具）',
}

const AUDIT_DIR = path.join(os.homedir(), '.dsh', 'shepherd')
const AUDIT_FILE = path.join(AUDIT_DIR, 'audit.jsonl')

const MAX_RECENT_AUDIT = 50
const recentAudit = []

function ensureAuditDir() {
  try { if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true }) } catch {}
}

function recordAudit(agentId, toolName, mode, decision, reason) {
  const entry = {
    timestamp: new Date().toISOString(),
    agentId,
    toolName,
    mode,
    decision,
    reason,
  }
  recentAudit.push(entry)
  if (recentAudit.length > MAX_RECENT_AUDIT) recentAudit.shift()

  ensureAuditDir()
  try { fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n') } catch (err) {
    console.warn('[shepherd] Failed to write audit log', err)
  }
  return entry
}

export function getRecentAudit() {
  return recentAudit.slice()
}

export function applyModeGuard(ctx, getConfig) {
  const denyCounts = new WeakMap()

  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    if (agent && messages?.some(m => m.source?.kind === 'user')) {
      denyCounts.delete(agent)
    }
    return next()
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    const cfg = getConfig()
    if (!cfg || cfg.enabled === false) return next()

    const mode = cfg.mode
    const toolName = exec?.name
    const agent = exec?.agent

    if (!MODE_GATES_TOOLS[mode] || !toolName || !cfg.blacklist.includes(toolName)) return next()
    if (!agent) return next()

    const currentRetries = denyCounts.get(agent)?.get(toolName) || 0
    if (currentRetries >= 3) {
      recordAudit(agent?.id, toolName, mode, 'deny', '熔断：多次重试被拒工具')
      return {
        kind: 'deny',
        reason: `shepherd 熔断：工具「${toolName}」已被拒绝超过 3 次。请停止尝试该工具，改换思路或向用户说明。`,
      }
    }

    recordAudit(agent?.id, toolName, mode, 'ask', '黑名单拦截，等待审批')
    console.warn(`[shepherd] ⏸  ${MODE_LABEL[mode]}：工具 ${toolName} 需要审批`)

    return {
      kind: 'ask',
      reason: `shepherd 处于 coding 模式：工具「${toolName}」在黑名单中，需要你批准后才会执行。`,
      displayReason: {
        en: `Tool "${toolName}" requires your approval in coding mode.`,
        zh: `coding 模式下工具「${toolName}」需要你批准后才会执行。`,
      },
    }
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const cfg = getConfig()
    if (!cfg || !MODE_GATES_TOOLS[cfg.mode]) return next()

    const toolName = exec?.name
    const agent = exec?.agent
    if (!agent || !toolName) return next()
    if (!cfg.blacklist.includes(toolName)) return next()

    const agentCounts = denyCounts.get(agent) || new Map()
    if (result?.isError) {
      const count = (agentCounts.get(toolName) || 0) + 1
      agentCounts.set(toolName, count)
      recordAudit(agent?.id, toolName, cfg.mode, 'error', `执行失败或被拒，当前计数: ${count}`)
    } else {
      agentCounts.delete(toolName)
      recordAudit(agent?.id, toolName, cfg.mode, 'ok', '执行成功，失败计数清零')
    }
    denyCounts.set(agent, agentCounts)
    return next()
  })
}