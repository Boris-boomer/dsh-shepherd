/**
 * dsh-shepherd · 纯检测逻辑。
 * 所有 detect* 返回 { fired, suspicion, evidenceType }，
 * 由 arbiter 决定干预强度，检测器不直接决定惩罚。
 */
import { normalize, hasRepeatedBlock, hasCharLevelCycle } from './text.mjs'
import {
  canonicalize,
  contentHash,
  observationFingerprint,
  semanticArgHash,
} from './canon.mjs'

export { normalize, hasRepeatedBlock, hasCharLevelCycle }
export { observationFingerprint, semanticArgHash }

// ---- A: text-repeat ----

export function accumulateWindow(prev, text, windowChars) {
  return normalize((prev + text).slice(-windowChars))
}

export function detectTextRepeat(window, cfg) {
  if (hasRepeatedBlock(window, cfg.minBlockLen, cfg.maxBlockLen, cfg.repeats)) {
    return { fired: true, suspicion: 'high', evidenceType: 'identical' }
  }
  if (hasCharLevelCycle(window, Math.max(64, cfg.minBlockLen), cfg.repeats)) {
    return { fired: true, suspicion: 'high', evidenceType: 'cycle' }
  }
  return { fired: false, suspicion: 'low', evidenceType: 'none' }
}

// ---- B: tool-repeat ----

export function analyzeToolSequence(history, semanticKey, repeats) {
  const probe = [...history, semanticKey]
  const sameTail = probe.length >= repeats && probe.slice(-repeats).every(k => k === semanticKey)

  let cycle = false
  for (let p = 1; p <= Math.floor(probe.length / repeats); p++) {
    const tail = probe.slice(-p * repeats)
    let ok = true
    for (let i = 0; i < tail.length; i++) {
      if (tail[i] !== tail[i % p]) { ok = false; break }
    }
    if (ok) { cycle = true; break }
  }
  return { sameTail, cycle }
}

export function detectToolRepeat(prev, exec, result, cfg) {
  const semanticKey = JSON.stringify([exec.name ?? '', semanticArgHash(exec.arguments)])
  const history = prev?.history ?? []
  const { sameTail, cycle } = analyzeToolSequence(history, semanticKey, cfg.repeats)
  const nextHistory = [...history, semanticKey].slice(-Math.max(cfg.repeats * 3, 12))
  const state = { history: nextHistory }
  if (sameTail) return { state, fired: true, suspicion: 'high', evidenceType: 'near-duplicate' }
  if (cycle) return { state, fired: true, suspicion: 'medium', evidenceType: 'cycle' }
  return { state, fired: false, suspicion: 'low', evidenceType: 'none' }
}

// ---- C: no-progress ----

/**
 * 返回 { key, isEmpty }。
 * isEmpty 独立于字符串拼接，避免 checkResultHash=false 时静默失效。
 */
export function noProgressFingerprint(exec, result, cfg) {
  const parts = []
  if (cfg.checkIsError) parts.push(String(Boolean(result?.isError)))
  let fp = null
  if (cfg.checkResultHash) {
    fp = observationFingerprint(result?.content)
    parts.push(fp)
  }
  parts.push(exec?.name ?? '')
  return { key: parts.join('|'), isEmpty: fp === 'empty' }
}

export function detectNoProgress(prev, exec, result, cfg) {
  const { key: fingerprint, isEmpty } = noProgressFingerprint(exec, result, cfg)
  const seen = prev?.seen ? new Set(prev.seen) : new Set()
  const lastFp = prev?.lastFp
  const streak = prev?.streak ?? 0

  let relation = 'changed'
  if (lastFp != null && lastFp === fingerprint) relation = 'identical'
  else if (seen.has(fingerprint)) relation = 'oscillating'

  if (relation === 'changed') {
    seen.add(fingerprint)
    const cap = Math.max(cfg.window * 3, 12)
    if (seen.size > cap) {
      const arr = Array.from(seen)
      seen.clear()
      for (const x of arr.slice(-cfg.window * 2)) seen.add(x)
    }
  }

  const shouldCount = relation === 'identical' || relation === 'oscillating'
  const nextStreak = shouldCount ? streak + 1 : 0
  const state = {
    seen: Array.from(seen),
    lastFp: fingerprint,
    streak: nextStreak,
    relation,
  }

  if (nextStreak >= cfg.window) {
    return {
      state,
      fired: true,
      suspicion: relation === 'identical' ? 'high' : 'medium',
      evidenceType: relation === 'identical' && isEmpty ? 'empty' : relation,
    }
  }
  return { state, fired: false, suspicion: 'low', evidenceType: relation }
}

// ---- E: no-landing ----

export function detectNoLanding(prev, sawText, turns) {
  const silentStreak = sawText ? 0 : prev.silentStreak + 1
  const state = { silentStreak, sawTextThisAttempt: false }
  const fired = silentStreak >= turns
  return {
    state,
    fired,
    suspicion: fired ? 'high' : 'low',
    evidenceType: fired ? 'empty' : 'none',
  }
}

// ---- F: hard-cap ----

export function detectHardCap(prev, frame, cfg, now = Date.now()) {
  const state = (prev?.turn === frame.turn)
    ? { turn: prev.turn, step: frame.step, startedAt: prev.startedAt }
    : { turn: frame.turn, step: frame.step, startedAt: now }

  if (state.step >= cfg.maxSteps) {
    return { state, reason: `step-cap:${cfg.maxSteps}`, suspicion: 'high', evidenceType: 'hard-cap' }
  }
  if (now - state.startedAt >= cfg.maxSeconds * 1000) {
    return { state, reason: `time-cap:${cfg.maxSeconds}`, suspicion: 'high', evidenceType: 'hard-cap' }
  }
  return { state, suspicion: 'low', evidenceType: 'none' }
}

// ---- G: no-evidence ----

export function isMeaningfulResult(result, minLen = 1) {
  if (!result || result.isError) return false
  const c = result.content
  if (c == null) return false
  const text = typeof c === 'string' ? c : JSON.stringify(c)
  return text.trim().length >= minLen
}

const WRITE_TOOL_PATTERN = /write|edit|patch|create|insert|update|delete|remove|apply/i
const VERIFY_TOOL_PATTERN = /read|cat|grep|test|verify|check|exec|run|shell|lint|build/i

export function classifyTool(name) {
  if (!name) return { isWrite: false, isVerify: false }
  return {
    isWrite: WRITE_TOOL_PATTERN.test(name),
    isVerify: VERIFY_TOOL_PATTERN.test(name),
  }
}

export function detectNoEvidence(text, evidence, cfg) {
  const hasClaim = cfg.keywords.some(kw => text.includes(kw))
  if (!hasClaim) return { fired: false, suspicion: 'low', evidenceType: 'none' }
  if (!evidence.hasMeaningfulSuccess) {
    return { fired: true, suspicion: 'high', evidenceType: 'no-evidence' }
  }
  if (evidence.wroteAnything && !evidence.verifiedAfterWrite) {
    return { fired: true, suspicion: 'medium', evidenceType: 'unverified-write' }
  }
  return { fired: false, suspicion: 'low', evidenceType: 'none' }
}