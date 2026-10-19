/**
 * dsh-agent-guard · 统一打断管理器（防套娃加强版）。
 */

import { randomUUID } from 'node:crypto'

function interrupt(agent, reason) {
  try {
    // 1. 强制中止当前回合
    agent.cancel({ kind: 'hook', reason: reason.kind }, { keepInbox: true })
  } catch (err) {
    console.warn(`[agent-guard] cancel failed for ${reason.kind}`, err)
    return
  }
  
  try {
    // 2. 注入强指令
    agent.steer({
      id: randomUUID(),
      role: 'user',
      content: [{ 
        type: 'text', 
        text: reason.message + '\n\n⚠️ 系统强制指令：不要再进行任何文字解释或道歉，立刻调用工具执行实际动作，或者直接结束对话。' 
      }],
      source: { kind: 'agent-guard', form: 'notice', summary: `agent-guard: ${reason.kind}` },
    })
  } catch (err) {
    console.warn(`[agent-guard] steer failed for ${reason.kind}`, err)
  }
}

export function createInterruptManager(maxPerAgent) {
  const used = new WeakMap()
  return {
    fire(agent, reason) {
      const count = used.get(agent) ?? 0
      if (count >= maxPerAgent) {
        // 如果超过最大打断次数，强制走终极打断（不再注入，直接停）
        console.warn(`[agent-guard] 🛑 达到最大打断次数 (${maxPerAgent})，强制终止 agent。`)
        try { agent.cancel({ kind: 'hook', reason: 'max-interrupts-reached' }, { keepInbox: false }) } catch {}
        return false
      }
      used.set(agent, count + 1)
      interrupt(agent, reason)
      return true
    },
    reset(agent) {
      used.delete(agent)
    }
  }
}