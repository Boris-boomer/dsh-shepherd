/**
 * dsh-shepherd · Host 入口。
 */

import { Config, LOOP_DEFAULTS, MODE_DEFAULTS } from './config.mjs'
import { createInterruptManager } from './lib/interrupt.mjs'
import { createArbiter } from './lib/arbiter.mjs'
import {
  registerTextRepeat,
  registerToolRepeat,
  registerNoProgress,
  registerToolTimeout,
  registerNoLanding,
  registerHardCap,
  registerNoEvidence,
} from './guards.mjs'
import { applyModeGuard, getRecentAudit } from './mode-guard.mjs'

export const name = 'shepherd'

// 关键修复：声明依赖 webServer，否则访问 ctx.webServer 会直接抛错
export const inject = ['webServer']

export { Config } from './config.mjs'
export * from './lib/detectors.mjs'

function mergeDeep(defaults, overrides) {
  if (!overrides) return { ...defaults }
  const result = { ...defaults }
  for (const key of Object.keys(overrides)) {
    const dv = defaults[key]
    const ov = overrides[key]
    if (dv && typeof dv === 'object' && !Array.isArray(dv) && ov && typeof ov === 'object' && !Array.isArray(ov)) {
      result[key] = mergeDeep(dv, ov)
    } else {
      result[key] = ov
    }
  }
  return result
}

export function apply(ctx, config) {
  const safeConfig = {
    loop: mergeDeep(LOOP_DEFAULTS, config?.loop),
    mode: mergeDeep(MODE_DEFAULTS, config?.mode),
  }

  const get = () => safeConfig
  const loop = () => get().loop
  const sub = (key) => () => {
    const c = loop()
    const s = c[key]
    if (key !== 'enabled' && typeof s === 'object' && s !== null && 'enabled' in s) {
      return { ...s, enabled: s.enabled && c.enabled }
    }
    return s
  }

  const manager = createInterruptManager(loop().maxInterruptsPerAgent)
  const arbiter = createArbiter()
  const prompt = () => loop().prompt

  registerTextRepeat(ctx, sub('textRepeat'), prompt, manager, arbiter)
  registerToolRepeat(ctx, sub('toolRepeat'), prompt, manager, arbiter)
  registerNoProgress(ctx, sub('noProgress'), prompt, manager, arbiter)
  registerToolTimeout(ctx, sub('toolTimeout'), prompt, manager, arbiter)
  registerNoLanding(ctx, sub('noLanding'), prompt, manager, arbiter)
  registerHardCap(ctx, sub('hardCap'), prompt, manager, arbiter)
  registerNoEvidence(ctx, sub('noEvidence'), prompt, manager, arbiter)

  applyModeGuard(ctx, () => get().mode)

  // 注册审计查询路由
  if (ctx.webServer?.register) {
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        method: 'GET',
        path: '/plugins/dsh-shepherd/audit',
        handler: (req, res) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(getRecentAudit()))
        },
      })
    )
  } else {
    console.warn('[shepherd] ctx.webServer.register 不可用，审计记录将只在 JSONL 中')
  }
}