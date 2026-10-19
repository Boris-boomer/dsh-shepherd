/**
 * dsh-sentinel · 模式守卫。
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

let lastGated = null
let gatedCount = 0

const AUDIT_DIR = path.join(os.homedir(), '.dsh', 'sentinel')
const AUDIT_FILE = path.join(AUDIT_DIR, 'audit.jsonl')

function ensureAuditDir() {
  try { if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true }) } catch {}
}

function writeAuditLog(agentId, toolName, mode, decision, reason) {
  ensureAuditDir()
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), agentId, toolName, mode, decision, reason }) + '\n'
  try { fs.appendFileSync(AUDIT_FILE, entry) } catch (err) { console.warn('[sentinel] Failed to write audit log', err) }
}

function viewGate(mode) {
  return { mode, pending: lastGated ? [lastGated] : [], total: gatedCount }
}

export function applyModeGuard(ctx, getConfig) {
  ctx.connection.rpc.handle('sentinel/getState', async () => viewGate(getConfig().mode))
  ctx.connection.rpc.handle('sentinel/clearGateView', async () => {
    lastGated = null
    return { success: true }
  })

  const denyCounts = new WeakMap()

  ctx.on('tools/pre-execute', async (exec, next) => {
    const cfg = getConfig()
    if (!cfg || cfg.enabled === false) return next()

    const mode = cfg.mode
    const toolName = exec?.name
    const agent = exec?.agent

    if (!MODE_GATES_TOOLS[mode] || !toolName || !cfg.blacklist.includes(toolName)) {
      return next()
    }

    const currentRetries = denyCounts.get(agent)?.get(toolName) || 0
    if (currentRetries >= 3) {
      writeAuditLog(agent?.id, toolName, mode, 'deny', '熔断：多次重试被拒工具')
      return {
        kind: 'deny',
        reason: `sentinel 熔断：工具「${toolName}」已被拒绝超过 3 次。请停止尝试该工具，改换思路或向用户说明。`,
      }
    }

    lastGated = { id: String(++gatedCount), tool: toolName, at: Date.now() }
    writeAuditLog(agent?.id, toolName, mode, 'ask', '黑名单拦截，等待审批')
    console.warn(`[sentinel] ⏸  ${MODE_LABEL[mode]}：工具 ${toolName} 需要审批`)

    return {
      kind: 'ask',
      reason: `sentinel 处于 coding 模式：工具「${toolName}」在黑名单中，需要你批准后才会执行。`,
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

    if (toolName && cfg.blacklist.includes(toolName) && result?.isError) {
      const agentCounts = denyCounts.get(agent) || new Map()
      const count = (agentCounts.get(toolName) || 0) + 1
      agentCounts.set(toolName, count)
      denyCounts.set(agent, agentCounts)
      
      writeAuditLog(agent?.id, toolName, cfg.mode, 'error', `执行失败或被拒，当前计数: ${count}`)
    }
    return next()
  })

  ctx.on('agent/turn-stopping', ({ agent }) => {
    denyCounts.delete(agent)
  })
}