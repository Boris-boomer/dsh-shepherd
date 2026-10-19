/**
 * dsh-agent-guard · 7 个检测器的 Cordis 事件绑定。
 */

import { accumulateWindow, detectTextRepeat } from './lib/detectors.mjs'
import { detectToolRepeat } from './lib/detectors.mjs'
import { detectNoProgress } from './lib/detectors.mjs'
import { detectNoLanding } from './lib/detectors.mjs'
import { detectHardCap } from './lib/detectors.mjs'
import { detectNoEvidence } from './lib/detectors.mjs'

// ---- A: text-repeat ----
export function registerTextRepeat(ctx, getConfig, getPrompt, manager) {
  const accs = new WeakMap()

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (!agent) return
    if (frame.type === 'start') { accs.set(agent, { window: '', fired: false }); return }
    if (frame.type !== 'chunk') return
    const cfg = getConfig()
    if (!cfg.enabled) return

    const text = (frame.chunk.type === 'text-delta' || frame.chunk.type === 'reasoning-delta')
      ? frame.chunk.text : null
    if (!text) return

    const current = accs.get(agent) ?? { window: '', fired: false }
    accs.set(agent, current)
    if (current.fired) return

    current.window = accumulateWindow(current.window, text, cfg.windowChars)
    if (!detectTextRepeat(current.window, cfg)) return

    current.fired = true
    manager.fire(agent, { kind: 'text-repeat', message: getPrompt() })
  })

  ctx.on('agent/turn-stopping', ({ agent }) => { accs.delete(agent) })
}

// ---- B: tool-repeat ----
export function registerToolRepeat(ctx, getConfig, getPrompt, manager) {
  const chains = new WeakMap()

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    const cfg = getConfig()
    if (!exec.agent || !cfg.enabled) return downstream

    const { state, fired } = detectToolRepeat(chains.get(exec.agent), exec, result, cfg)
    chains.set(exec.agent, state)
    if (!fired) return downstream

    manager.fire(exec.agent, {
      kind: 'tool-repeat',
      message: `检测到你在反复调用同一工具（${exec.name}）且参数、结果相同、毫无进展。已自动打断。请分析上一次结果，换一个不同的方法或不同参数，或结束任务。${getPrompt()}`,
    })
    return downstream
  })

  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    if (messages.some(m => m.source?.kind === 'user')) chains.delete(agent)
    return next()
  })
}

// ---- C: no-progress ----
export function registerNoProgress(ctx, getConfig, getPrompt, manager) {
  const runs = new WeakMap()

  ctx.on('tools/result', (exec, result) => {
    const cfg = getConfig()
    if (!exec.agent || !cfg.enabled) return

    const { state, fired } = detectNoProgress(runs.get(exec.agent), exec, result, cfg)
    runs.set(exec.agent, state)
    if (!fired) return

    manager.fire(exec.agent, {
      kind: 'no-progress',
      message: `检测到连续 ${state.streak} 个工具调用结果毫无进展。已自动打断。请停下来分析整体情况，换一个完全不同的策略，或结束任务。${getPrompt()}`,
    })
    runs.set(exec.agent, { ...state, streak: 0 })
  })

  ctx.on('agent/turn-stopping', ({ agent }) => { runs.delete(agent) })
}

// ---- D: tool-timeout ----
export function registerToolTimeout(ctx, getConfig, getPrompt, manager) {
  ctx.on('tools/execute', async (exec, next) => {
    const cfg = getConfig()
    if (!cfg.enabled) return next()

    let timer
    let resolveTimeout
    const timeout = new Promise(resolve => { resolveTimeout = resolve })
    timer = setTimeout(() => {
      if (exec.agent) {
        manager.fire(exec.agent, {
          kind: 'tool-timeout',
          message: `工具调用（${exec.name ?? 'unknown'}）超过 ${Math.round(cfg.timeoutMs / 1000)}s 未返回，已自动打断。请检查该工具是否真的需要，或换一个不依赖它的方法。${getPrompt()}`,
        })
      }
      resolveTimeout?.({
        content: `agent-guard: tool call "${exec.name ?? 'unknown'}" timed out after ${cfg.timeoutMs}ms`,
        isError: true,
      })
    }, cfg.timeoutMs)

    try {
      return await Promise.race([next(), timeout])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  })
}

// ---- E: no-landing ----
export function registerNoLanding(ctx, getConfig, getPrompt, manager) {
  const states = new WeakMap()

  function stateFor(agent) {
    let s = states.get(agent)
    if (!s) { s = { revision: -1, silentStreak: 0, sawTextThisAttempt: false }; states.set(agent, s) }
    return s
  }

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (!agent) return
    const s = stateFor(agent)

    if (frame.type === 'start') { s.revision = frame.revision; s.sawTextThisAttempt = false; return }
    if (frame.type === 'chunk') {
      if (frame.revision !== s.revision) { s.revision = frame.revision; s.sawTextThisAttempt = false }
      if (frame.chunk.type === 'text-delta') { s.sawTextThisAttempt = true; s.silentStreak = 0 }
      return
    }
    if (frame.type === 'end') {
      const cfg = getConfig()
      if (!cfg.enabled) return
      const { state, fired } = detectNoLanding(s, s.sawTextThisAttempt, cfg.turns)
      states.set(agent, { ...state, revision: s.revision })
      if (!fired) return
      manager.fire(agent, {
        kind: 'no-landing',
        message: `检测到连续 ${state.silentStreak} 次生成没有输出任何文本、也没有调用任何工具，处于纯思考空转。已自动打断。请停止空转，直接产出可见的文本或调用工具推进任务。${getPrompt()}`,
      })
    }
  })

  ctx.on('tool/call', ({ agent }) => {
    if (!agent) return
    stateFor(agent).silentStreak = 0
  })

  ctx.on('agent/turn-stopping', ({ agent }) => { states.delete(agent) })
}

// ---- F: hard-cap ----
export function registerHardCap(ctx, getConfig, getPrompt, manager) {
  const states = new WeakMap()

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type !== 'start' || !agent) return
    const cfg = getConfig()
    if (!cfg.enabled) return

    const { state, reason } = detectHardCap(states.get(agent), frame, cfg)
    states.set(agent, state)
    if (!reason) return

    manager.fire(agent, {
      kind: 'hard-cap',
      message: reason.startsWith('step-cap')
        ? `本轮已执行 ${state.step} 步，达到步数上限，已自动打断。请直接给出结论或结束任务，不要再继续推进步骤。${getPrompt()}`
        : `本轮已持续超过上限时长，已自动打断。请直接给出结论或结束任务。${getPrompt()}`,
    })
  })

  ctx.on('agent/turn-stopping', ({ agent }) => { states.delete(agent) })
}

// ---- G: no-evidence ----
export function registerNoEvidence(ctx, getConfig, getPrompt, manager) {
  const states = new WeakMap()

  function stateFor(agent) {
    let s = states.get(agent)
    if (!s) { s = { currentText: '', hasSuccess: false }; states.set(agent, s) }
    return s
  }

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (!agent) return
    const s = stateFor(agent)
    if (frame.type === 'start') { s.currentText = ''; s.hasSuccess = false; return }
    if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') { s.currentText += frame.chunk.text }
  })

  ctx.on('tools/result', (exec, result) => {
    if (!exec.agent) return
    if (!result?.isError) { stateFor(exec.agent).hasSuccess = true }
  })

  ctx.on('agent/turn-stopping', ({ agent }) => {
    const cfg = getConfig()
    if (!agent || !cfg.enabled) return
    const s = states.get(agent)
    if (!s) return
    const { fired } = detectNoEvidence(s.currentText, s.hasSuccess, cfg)
    states.delete(agent)
    if (!fired) return
    manager.fire(agent, {
      kind: 'no-evidence',
      message: `检测到你宣称了任务完成（如“完成”、“已修复”），但本回合内没有任何成功的工具调用结果作为证据。请先实际执行工具进行验证，或者提供详细的证明说明。${getPrompt()}`,
    })
  })
}