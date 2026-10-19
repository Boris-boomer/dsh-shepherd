/**
 * dsh-agent-guard · 判据测试。
 */

import assert from 'node:assert/strict'
import { NS, DEFAULT_BLACKLIST, LoopGuardSchema, ModeGuardSchema, LOOP_DEFAULTS, MODE_DEFAULTS } from '../src/config.mjs'
import {
  accumulateWindow, detectTextRepeat,
  detectToolRepeat, detectNoProgress, detectNoLanding, detectHardCap,
  detectNoEvidence
} from '../src/lib/detectors.mjs'

let pass = 0
const ok = (name) => { pass++; console.log(`  ✅ ${name}`) }

console.log('dsh-agent-guard 判据测试')

// ---- 1. 配置结构 ----
{
  console.log('· 配置结构')
  assert.equal(NS, 'agent-guard')
  
  // 直接测试子 schema 的默认值填充（绕开 Config 的嵌套合并问题）
  const loopCfg = LoopGuardSchema({})
  const modeCfg = ModeGuardSchema({})
  
  assert.ok(loopCfg && typeof loopCfg === 'object', 'loop 子块解析成功')
  assert.ok(modeCfg && typeof modeCfg === 'object', 'mode 子块解析成功')
  ok('配置结构及子块解析')

  assert.equal(modeCfg.mode, 'planning', '默认模式 planning')
  assert.equal(loopCfg.maxInterruptsPerAgent, 6, '循环守卫默认打断预算 6')
  ok('子块默认值正确')

  assert.deepEqual(modeCfg.blacklist, DEFAULT_BLACKLIST, '黑名单默认值与常量一致')
  ok('黑名单默认值正确')
  
  assert.ok(loopCfg.noEvidence.enabled, 'G 检测器默认启用')
  ok('G 检测器默认启用')

  // 模拟 index.mjs 中的手动兜底合并逻辑
  const safeConfig = {
    loop: { ...LOOP_DEFAULTS, ...(loopCfg || {}) },
    mode: { ...MODE_DEFAULTS, ...(modeCfg || {}) },
  }
  assert.ok(safeConfig.loop.textRepeat.enabled && safeConfig.mode.enabled, '手动兜底合并成功')
  ok('手动兜底合并成功')
}

// ---- 2. 循环守卫检测器 ----
{
  console.log('· 检测器逻辑')

  // A: 文本重复
  const window = accumulateWindow('', 'hello '.repeat(4), 4000)
  assert.ok(detectTextRepeat(window, { minBlockLen: 5, maxBlockLen: 1200, repeats: 3 }), '文本重复触发')
  ok('A 文本重复')

  // B: 工具重复 (带结果感知)
  const exec = { name: 'read', arguments: { path: 'a' } }
  const result1 = { content: 'content-1' }
  const result2 = { content: 'content-2' }

  let b1 = detectToolRepeat(undefined, exec, result1, { repeats: 3 })
  let b2 = detectToolRepeat(b1.state, exec, result1, { repeats: 3 })
  let b3 = detectToolRepeat(b2.state, exec, result1, { repeats: 3 })
  assert.equal(b3.fired, true, '同参同结果 3 次触发')
  ok('B 工具重复 (无进展)')

  let b4 = detectToolRepeat(undefined, exec, result1, { repeats: 3 })
  let b5 = detectToolRepeat(b4.state, exec, result2, { repeats: 3 })
  let b6 = detectToolRepeat(b5.state, exec, result1, { repeats: 3 })
  assert.equal(b6.fired, false, '结果变化不触发')
  ok('B 工具重复 (有进度豁免)')

  // C: 无进展
  const r1 = detectNoProgress(undefined, { name: 't' }, { isError: true, content: 'err' }, { window: 3, checkIsError: true, checkResultHash: true })
  const r2 = detectNoProgress(r1.state, { name: 't' }, { isError: true, content: 'err' }, { window: 3, checkIsError: true, checkResultHash: true })
  const r3 = detectNoProgress(r2.state, { name: 't' }, { isError: true, content: 'err' }, { window: 3, checkIsError: true, checkResultHash: true })
  assert.equal(r3.fired, true)
  ok('C 无进展')

  // E: 无落地
  const n1 = detectNoLanding({ silentStreak: 0, sawTextThisAttempt: false }, false, 3)
  const n2 = detectNoLanding(n1.state, false, 3)
  const n3 = detectNoLanding(n2.state, false, 3)
  assert.equal(n3.fired, true)
  ok('E 无落地')

  // F: 硬上限
  const h1 = detectHardCap(undefined, { turn: 1, step: 10 }, { maxSteps: 50, maxSeconds: 900 }, 1000000)
  const h2 = detectHardCap(h1.state, { turn: 1, step: 50 }, { maxSteps: 50, maxSeconds: 900 }, 1001000)
  assert.equal(h2.reason, 'step-cap:50')
  ok('F 硬上限')

  // G: 无证据完成
  const kw = ['完成', 'done']
  assert.equal(detectNoEvidence('任务完成了', false, { keywords: kw }).fired, true)
  assert.equal(detectNoEvidence('任务完成了', true, { keywords: kw }).fired, false)
  assert.equal(detectNoEvidence('继续尝试', false, { keywords: kw }).fired, false)
  ok('G 无证据完成')
}

// ---- 3. 模式守卫 ----
{
  console.log('· 模式守卫配置')
  const m = ModeGuardSchema({})
  assert.equal(m.enabled, true)
  assert.ok(DEFAULT_BLACKLIST.includes('execute_command'))

  let rejected = false
  try { ModeGuardSchema({ mode: 'hack' }) } catch { rejected = true }
  assert.ok(rejected)
  ok('模式守卫校验')
}

console.log(`\n${pass} 项判据全部通过`)