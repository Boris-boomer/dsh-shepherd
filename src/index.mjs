/**
 * dsh-sentinel · Host 入口。
 */

import { Config, LOOP_DEFAULTS, MODE_DEFAULTS } from './config.mjs'
import { createInterruptManager } from './lib/interrupt.mjs'
import {
  registerTextRepeat,
  registerToolRepeat,
  registerNoProgress,
  registerToolTimeout,
  registerNoLanding,
  registerHardCap,
  registerNoEvidence,
} from './guards.mjs'
import { applyModeGuard } from './mode-guard.mjs'

export const name = 'sentinel'
export { Config } from './config.mjs'
export * from './lib/detectors.mjs'

export function apply(ctx, config) {
  const safeConfig = {
    loop: { ...LOOP_DEFAULTS, ...(config?.loop || {}) },
    mode: { ...MODE_DEFAULTS, ...(config?.mode || {}) },
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

  // ---- 循环守卫 ----
  const manager = createInterruptManager(loop().maxInterruptsPerAgent)
  const prompt = () => loop().prompt

  registerTextRepeat(ctx, sub('textRepeat'), prompt, manager)
  registerToolRepeat(ctx, sub('toolRepeat'), prompt, manager)
  registerNoProgress(ctx, sub('noProgress'), prompt, manager)
  registerToolTimeout(ctx, sub('toolTimeout'), prompt, manager)
  registerNoLanding(ctx, sub('noLanding'), prompt, manager)
  registerHardCap(ctx, sub('hardCap'), prompt, manager)
  registerNoEvidence(ctx, sub('noEvidence'), prompt, manager)

  // ---- 模式守卫 ----
  applyModeGuard(ctx, () => get().mode)
}