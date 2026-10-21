/**
 * dsh-shepherd · 7 个检测器的 Cordis 事件绑定。
 * 检测器只产出 { fired, suspicion, evidenceType }，由 arbiter 决定干预级别。
 */

import {
  accumulateWindow,
  detectTextRepeat,
  analyzeToolSequence,
  detectNoProgress,
  detectNoLanding,
  detectHardCap,
  detectNoEvidence,
  isMeaningfulResult,
  classifyTool,
  semanticArgHash,
} from './lib/detectors.mjs'
import { LEVEL } from './lib/arbiter.mjs'

function fireByLevel(manager, agent, level, kind, message, blockFallback = LEVEL.STOP) {
  if (level === LEVEL.NONE) return
  if (level === LEVEL.BLOCK) level = blockFallback
  if (level === LEVEL.STOP) {
    manager.fire(agent, { kind, message })
  } else if (level === LEVEL.WARN) {
    manager.intervene(agent, LEVEL.WARN, { kind, message })
  }
}

// ---- A: text-repeat ----
export function registerTextRepeat(ctx, getConfig, getPrompt, manager, arbiter) {
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
    const signal = detectTextRepeat(current.window, cfg)
    if (!signal.fired) return

    current.fired = true
    const { level } = arbiter.decide(agent, 'text-repeat', signal)
    fireByLevel(manager, agent, level, 'text-repeat', getPrompt(), LEVEL.STOP)
  })

  ctx.on('agent/turn-stopping', ({ agent }) => { accs.delete(agent) })
}

// ---- B: tool-repeat ----
// 在 tools/pre-execute 拦截：BLOCK/STOP 都走 deny，不额外 fire 避免 cancel 后重复处理。
export function registerToolRepeat(ctx, getConfig, getPrompt, manager, arbiter) {
  const chains = new WeakMap()

  ctx.on('tools/pre-execute', async (exec, next) => {
    const cfg = getConfig()
    if (!exec.agent || !cfg.enabled) return next()

    const agent = exec.agent
    const semanticKey = JSON.stringify([exec.name ?? '', semanticArgHash(exec.arguments)])
    const state = chains.get(agent) || { history: [] }
    const { sameTail, cycle } = analyzeToolSequence(state.history, semanticKey, cfg.repeats)

    const history = [...state.history, semanticKey].slice(-Math.max(cfg.repeats * 3, 12))
    chains.set(agent, { history })

    if (!sameTail && !cycle) return next()

    const signal = {
      fired: true,
      suspicion: sameTail ? 'high' : 'medium',
      evidenceType: sameTail ? 'near-duplicate' : 'cycle',
    }
    const { level } = arbiter.decide(agent, 'tool-repeat', signal)
    const message = `检测到你在反复调用同一工具（${exec.name}），参数主干重复或构成周期。请分析上一次结果，换一个不同的方法或不同参数，或结束任务。${getPrompt()}`

    if (level === LEVEL.WARN) {
      manager.intervene(agent, LEVEL.WARN, { kind: 'tool-repeat', message })
      return next()
    }

    return {
      kind: 'deny',
      reason: message,
      displayReason: {
        en: 'Repeated tool call blocked by shepherd.',
        zh: 'shepherd 已阻断重复工具调用。',
      },
    }
  })

  ctx.on('agent/turn-stopping', ({ agent }) => { chains.delete(agent) })
}

// ---- C: no-progress ----
export function registerNoProgress(ctx, getConfig, getPrompt, manager, arbiter) {
  const runs = new WeakMap()

  ctx.on('tools/result', (exec, result) => {
    const cfg = getConfig()
    if (!exec.agent || !cfg.enabled) return

    const { state, fired, suspicion, evidenceType } = detectNoProgress(runs.get(exec.agent), exec, result, cfg)
    runs.set(exec.agent, state)
    if (!fired) return

    const { level } = arbiter.decide(exec.agent, 'no-progress', { fired, suspicion, evidenceType })
    const message = `检测到连续 ${state.streak} 个工具调用结果无实质推进（${evidenceType}）。请停下来分析整体情况，换一个完全不同的策略，或结束任务。${getPrompt()}`
    fireByLevel(manager, exec.agent, level, 'no-progress', message, LEVEL.STOP)
    if (level !== LEVEL.NONE) runs.set(exec.agent, { ...state, streak: 0 })
  })

  ctx.on('agent/turn-stopping', ({ agent }) => { runs.delete(agent) })
}

// ---- D: tool-timeout ----
export function registerToolTimeout(ctx, getConfig, getPrompt, manager, arbiter) {
  ctx.on('tools/execute', async (exec, next) => {
    const cfg = getConfig()
    if (!cfg.enabled) return next()

    let timer
    let resolveTimeout
    const timeout = new Promise(resolve => { resolveTimeout = resolve })
    timer = setTimeout(() => {
      if (exec.agent) {
        const { level } = arbiter.decide(exec.agent, 'tool-timeout', {
          fired: true, suspicion: 'high', evidenceType: 'hard-cap',
        })
        fireByLevel(manager, exec.agent, level, 'tool-timeout',
          `工具调用（${exec.name ?? 'unknown'}）超过 ${Math.round(cfg.timeoutMs / 1000)}s 未返回，已自动打断。请检查该工具是否真的需要，或换一个不依赖它的方法。${getPrompt()}`,
          LEVEL.STOP)
      }
      resolveTimeout?.({
        content: `shepherd: tool call "${exec.name ?? 'unknown'}" timed out after ${cfg.timeoutMs}ms`,
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
export function registerNoLanding(ctx, getConfig, getPrompt, manager, arbiter) {
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
      const { state, fired, suspicion, evidenceType } = detectNoLanding(s, s.sawTextThisAttempt, cfg.turns)
      states.set(agent, { ...state, revision: s.revision })
      if (!fired) return
      const { level } = arbiter.decide(agent, 'no-landing', { fired, suspicion, evidenceType })
      fireByLevel(manager, agent, level, 'no-landing',
        `检测到连续 ${state.silentStreak} 次生成没有输出任何文本、也没有调用任何工具，处于纯思考空转。请停止空转，直接产出可见的文本或调用工具推进任务。${getPrompt()}`,
        LEVEL.STOP)
    }
  })

  ctx.on('tool/call', ({ agent }) => {
    if (!agent) return
    stateFor(agent).silentStreak = 0
  })
  ctx.on('agent/turn-stopping', ({ agent }) => { states.delete(agent) })
}

// ---- F: hard-cap ----
export function registerHardCap(ctx, getConfig, getPrompt, manager, arbiter) {
  const states = new WeakMap()

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type !== 'start' || !agent) return
    const cfg = getConfig()
    if (!cfg.enabled) return

    const { state, reason, suspicion, evidenceType } = detectHardCap(states.get(agent), frame, cfg)
    states.set(agent, state)
    if (!reason) return

    const { level } = arbiter.decide(agent, 'hard-cap', { fired: true, suspicion, evidenceType })
    const message = reason.startsWith('step-cap')
      ? `本轮已执行 ${state.step} 步，达到步数上限，已自动打断。请直接给出结论或结束任务，不要再继续推进步骤。${getPrompt()}`
      : `本轮已持续超过上限时长，已自动打断。请直接给出结论或结束任务。${getPrompt()}`
    fireByLevel(manager, agent, level, 'hard-cap', message, LEVEL.STOP)
  })

  ctx.on('agent/turn-stopping', ({ agent }) => { states.delete(agent) })
}

// ---- G: no-evidence ----
export function registerNoEvidence(ctx, getConfig, getPrompt, manager, arbiter) {
  const states = new WeakMap()

  function stateFor(agent) {
    let s = states.get(agent)
    if (!s) {
      s = { currentText: '', hasMeaningfulSuccess: false, wroteAnything: false, verifiedAfterWrite: false }
      states.set(agent, s)
    }
    return s
  }

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (!agent) return
    const s = stateFor(agent)
    if (frame.type === 'start') {
      s.currentText = ''
      s.hasMeaningfulSuccess = false
      s.wroteAnything = false
      s.verifiedAfterWrite = false
      return
    }
    if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') {
      s.currentText += frame.chunk.text
    }
  })

  ctx.on('tools/result', (exec, result) => {
    if (!exec.agent) return
    const s = stateFor(exec.agent)
    if (!isMeaningfulResult(result)) return
    s.hasMeaningfulSuccess = true
    const cls = classifyTool(exec.name)
    if (cls.isWrite) s.wroteAnything = true
    if (cls.isVerify && s.wroteAnything) s.verifiedAfterWrite = true
  })

  ctx.on('agent/turn-stopping', ({ agent }) => {
    const cfg = getConfig()
    if (!agent || !cfg.enabled) return
    const s = states.get(agent)
    if (!s) return
    const evidence = {
      hasMeaningfulSuccess: s.hasMeaningfulSuccess,
      wroteAnything: s.wroteAnything,
      verifiedAfterWrite: s.verifiedAfterWrite,
    }
    const signal = detectNoEvidence(s.currentText, evidence, cfg)
    states.delete(agent)
    if (!signal.fired) return
    const { level } = arbiter.decide(agent, 'no-evidence', signal)
    const suffix = evidence.wroteAnything && !evidence.verifiedAfterWrite ? '（写操作后缺少验证）' : ''
    fireByLevel(manager, agent, level, 'no-evidence',
      `检测到你宣称了任务完成（如“完成”、“已修复”），但本回合内没有足够的成功工具证据${suffix}。请先实际执行工具进行验证，或者提供详细的证明说明。${getPrompt()}`,
      LEVEL.WARN)
  })
}