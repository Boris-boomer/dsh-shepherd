/**
 * dsh-shepherd · 统一干预管理器。
 * 三档：WARN（软提示）/ BLOCK（由调用方返回决策）/ STOP（打断 + 注入）。
 * 全部使用闭包，不依赖 this 绑定。
 */

import { randomUUID } from 'node:crypto'
import { LEVEL } from './arbiter.mjs'

function stopAgent(agent, reason) {
  try {
    agent.cancel({ kind: 'hook', reason: reason.kind }, { keepInbox: true })
  } catch (err) {
    console.warn(`[shepherd] cancel failed for ${reason.kind}`, err)
    return false
  }
  try {
    agent.steer({
      id: randomUUID(),
      role: 'user',
      content: [{
        type: 'text',
        text: reason.message + '\n\n⚠️ 系统强制指令：不要再进行任何文字解释或道歉，立刻调用工具执行实际动作，或者直接结束对话。',
      }],
      source: { kind: 'shepherd', form: 'notice', summary: `shepherd: ${reason.kind}` },
    })
  } catch (err) {
    console.warn(`[shepherd] steer failed for ${reason.kind}`, err)
  }
  return true
}

function warnAgent(agent, reason) {
  try {
    agent.steer({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: `⚠️ [shepherd 观察] ${reason.message}` }],
      source: { kind: 'shepherd', form: 'notice', summary: `shepherd: ${reason.kind}` },
    })
  } catch (err) {
    console.warn(`[shepherd] warn steer failed for ${reason.kind}`, err)
  }
}

export function createInterruptManager(maxPerAgent) {
  const used = new WeakMap()

  function fire(agent, reason) {
    if (!agent) return false
    const count = used.get(agent) ?? 0
    if (count >= maxPerAgent) {
      console.warn(`[shepherd] 🛑 达到最大打断次数 (${maxPerAgent})，强制终止 agent。`)
      try { agent.cancel({ kind: 'hook', reason: 'max-interrupts-reached' }, { keepInbox: false }) } catch {}
      return false
    }
    used.set(agent, count + 1)
    return stopAgent(agent, reason)
  }

  function intervene(agent, level, reason) {
    if (!agent || level === LEVEL.NONE) return { applied: false }
    if (level === LEVEL.STOP) return { applied: fire(agent, reason) }
    if (level === LEVEL.WARN) { warnAgent(agent, reason); return { applied: true } }
    if (level === LEVEL.BLOCK) return { applied: true, action: 'block' }
    return { applied: false }
  }

  function reset(agent) {
    if (agent) used.delete(agent)
  }

  return { fire, intervene, reset }
}

export { LEVEL }