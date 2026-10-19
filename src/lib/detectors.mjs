/**
 * dsh-agent-guard · 纯检测逻辑。
 */

import { normalize, hasRepeatedBlock } from './text.mjs'
import { canonicalize, contentHash } from './canon.mjs'

export { normalize, hasRepeatedBlock }

// ---- A: text-repeat ----

export function accumulateWindow(prev, text, windowChars) {
  return normalize((prev + text).slice(-windowChars))
}

export function detectTextRepeat(window, cfg) {
  if (window.length < cfg.minBlockLen * cfg.repeats) return false
  return hasRepeatedBlock(window, cfg.minBlockLen, cfg.maxBlockLen, cfg.repeats)
}

// ---- B: tool-repeat (含进度感知) ----

export function detectToolRepeat(prev, exec, result, cfg) {
  const argsHash = canonicalize(exec.arguments)
  const resHash = contentHash(result?.content)
  const key = JSON.stringify([exec.name ?? '', argsHash, resHash])

  const state = (prev?.key === key)
    ? { key, count: prev.count + 1 }
    : { key, count: 1 }
  return { state, fired: state.count >= cfg.repeats }
}

// ---- C: no-progress ----

export function noProgressKey(exec, result, cfg) {
  const parts = []
  if (cfg.checkIsError) parts.push(String(Boolean(result?.isError)))
  if (cfg.checkResultHash) {
    const content = result?.content
    parts.push(contentHash(content))
  }
  parts.push(exec?.name ?? '')
  return parts.join('|')
}

export function detectNoProgress(prev, exec, result, cfg) {
  const key = noProgressKey(exec, result, cfg)
  const state = (prev?.lastKey === key)
    ? { streak: prev.streak + 1, lastKey: key }
    : { streak: 1, lastKey: key }
  return { state, fired: state.streak >= cfg.window }
}

// ---- E: no-landing ----

export function detectNoLanding(prev, sawText, turns) {
  const silentStreak = sawText ? 0 : prev.silentStreak + 1
  const state = { silentStreak, sawTextThisAttempt: false }
  return { state, fired: silentStreak >= turns }
}

// ---- F: hard-cap ----

export function detectHardCap(prev, frame, cfg, now = Date.now()) {
  const state = (prev?.turn === frame.turn)
    ? { turn: prev.turn, step: frame.step, startedAt: prev.startedAt }
    : { turn: frame.turn, step: frame.step, startedAt: now }
  if (state.step >= cfg.maxSteps) return { state, reason: `step-cap:${cfg.maxSteps}` }
  if (now - state.startedAt >= cfg.maxSeconds * 1000) return { state, reason: `time-cap:${cfg.maxSeconds}` }
  return { state }
}

// ---- G: no-evidence (新增) ----

export function detectNoEvidence(text, hasSuccessTool, cfg) {
  const hasClaim = cfg.keywords.some(kw => text.includes(kw))
  const fired = hasClaim && !hasSuccessTool
  return { fired }
}