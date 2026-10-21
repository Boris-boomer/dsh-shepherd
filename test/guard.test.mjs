import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  accumulateWindow,
  detectTextRepeat,
  analyzeToolSequence,
  detectToolRepeat,
  noProgressFingerprint,
  detectNoProgress,
  detectNoLanding,
  detectHardCap,
  detectNoEvidence,
  isMeaningfulResult,
  classifyTool,
} from '../src/lib/detectors.mjs'
import { hasCharLevelCycle, hasRepeatedBlock, normalize } from '../src/lib/text.mjs'
import {
  canonicalize,
  contentHash,
  stripEphemeral,
  observationFingerprint,
  semanticArgHash,
} from '../src/lib/canon.mjs'
import { createArbiter, LEVEL } from '../src/lib/arbiter.mjs'

// ===================== 辅助 =====================

const exec = (name = 'read_file') => ({ name })
const ok = content => ({ isError: false, content })
const err = content => ({ isError: true, content })

const cfgText10 = { minBlockLen: 10, maxBlockLen: 100, repeats: 3, windowChars: 4000 }
const cfgText80 = { minBlockLen: 80, maxBlockLen: 1200, repeats: 3, windowChars: 4000 }
const cfgProgress = { window: 3, checkIsError: true, checkResultHash: true }

// ===================== text.mjs =====================

test('normalize 去除标点与空白', () => {
  assert.equal(normalize('Hello, World!'), 'helloworld')
})

test('hasRepeatedBlock 块级重复', () => {
  assert.equal(hasRepeatedBlock('abcabcabc', 3, 10, 3), true)
  assert.equal(hasRepeatedBlock('abcabcabc', 4, 10, 3), false)
})

test('hasCharLevelCycle 单字符与短语周期', () => {
  assert.equal(hasCharLevelCycle('a'.repeat(200)), true)
  assert.equal(hasCharLevelCycle('step1'.repeat(50)), true)
})

test('hasCharLevelCycle 每段重复不足 minSpan 不触发', () => {
  const segmented = 'x'.repeat(50) + 'y'.repeat(50) + 'z'.repeat(50)
  assert.equal(hasCharLevelCycle(segmented, 80, 3), false)
})

test('hasCharLevelCycle 短文本不触发', () => {
  assert.equal(hasCharLevelCycle('a'.repeat(63)), false)
})

// ===================== canon.mjs =====================

test('canonicalize 稳定排序', () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}')
})

test('contentHash 稳定且区分内容', () => {
  assert.equal(contentHash('x'), contentHash('x'))
  assert.notEqual(contentHash('x'), contentHash('y'))
})

test('stripEphemeral 替换时间戳与耗时', () => {
  assert.equal(stripEphemeral('took 12ms'), 'took <VAR>')
  assert.equal(stripEphemeral('at 2026-10-21T10:00:00Z'), 'at <VAR>')
})

test('observationFingerprint 忽略易变量', () => {
  const a = 'request at 2026-10-21T10:00:00Z returned 12ms'
  const b = 'request at 2026-10-21T11:00:00Z returned 50ms'
  assert.equal(observationFingerprint(a), observationFingerprint(b))
})

test('observationFingerprint 忽略 UUID', () => {
  const u1 = 'id 123e4567-e89b-12d3-a456-426614174000 done'
  const u2 = 'id 123e4567-e89b-12d3-a456-426614174999 done'
  assert.equal(observationFingerprint(u1), observationFingerprint(u2))
})

test('observationFingerprint 区分真实内容', () => {
  assert.notEqual(observationFingerprint('alpha'), observationFingerprint('beta'))
})

test('observationFingerprint 空值归一为 empty', () => {
  assert.equal(observationFingerprint(''), 'empty')
  assert.equal(observationFingerprint('   '), 'empty')
  assert.equal(observationFingerprint(null), 'empty')
})

test('semanticArgHash 剥离分页字段', () => {
  assert.equal(
    semanticArgHash({ path: 'f', offset: 0 }),
    semanticArgHash({ path: 'f', offset: 100 }),
  )
  assert.equal(
    semanticArgHash({ path: 'f', limit: 10 }),
    semanticArgHash({ path: 'f', limit: 20 }),
  )
})

test('semanticArgHash 保留主干差异', () => {
  assert.notEqual(semanticArgHash({ path: 'f' }), semanticArgHash({ path: 'g' }))
  assert.notEqual(
    semanticArgHash({ path: 'f', mode: 'a' }),
    semanticArgHash({ path: 'f', mode: 'b' }),
  )
})

// ===================== detectors.mjs =====================

test('accumulateWindow 截断并归一', () => {
  assert.equal(accumulateWindow('', 'abc', 10), 'abc')
  assert.equal(accumulateWindow('abc', 'def', 4), 'cdef')
})

test('detectTextRepeat 块级重复触发 identical', () => {
  const r = detectTextRepeat('a'.repeat(200), cfgText10)
  assert.equal(r.fired, true)
  assert.equal(r.evidenceType, 'identical')
})

test('detectTextRepeat 字符级周期在窗口不足块级时仍触发', () => {
  // 100 < 80*3，块级不会触发；字符级 minSpan=80，100>=80
  const r = detectTextRepeat('a'.repeat(100), cfgText80)
  assert.equal(r.fired, true)
  assert.equal(r.evidenceType, 'cycle')
})

test('detectTextRepeat 分段重复但每段不足 minSpan 不触发', () => {
  const segmented = 'x'.repeat(50) + 'y'.repeat(50) + 'z'.repeat(50)
  const r = detectTextRepeat(segmented, cfgText80)
  assert.equal(r.fired, false)
})

test('detectTextRepeat 短文本不触发', () => {
  assert.equal(detectTextRepeat('hello', cfgText80).fired, false)
})

test('analyzeToolSequence 历史不足 repeats 不误判', () => {
  assert.deepEqual(analyzeToolSequence([], 'A', 3), { sameTail: false, cycle: false })
  assert.deepEqual(analyzeToolSequence(['A'], 'A', 3), { sameTail: false, cycle: false })
})

test('analyzeToolSequence 连续相同达到 repeats 才触发', () => {
  assert.deepEqual(analyzeToolSequence(['A', 'A'], 'A', 3), { sameTail: true, cycle: true })
})

test('analyzeToolSequence 检测 A→B→A→B 周期', () => {
  const r = analyzeToolSequence(['A', 'B', 'A'], 'B', 2)
  assert.equal(r.sameTail, false)
  assert.equal(r.cycle, true)
})

test('detectToolRepeat 首次调用不触发', () => {
  const r = detectToolRepeat(undefined, exec(), ok('x'), { repeats: 3 })
  assert.equal(r.fired, false)
})

test('detectNoProgress A→B→A→B 判为振荡', () => {
  let state
  let last
  for (const content of ['A', 'B', 'A', 'B', 'A']) {
    last = detectNoProgress(state, exec(), ok(content), cfgProgress)
    state = last.state
  }
  assert.equal(last.fired, true)
  assert.equal(last.evidenceType, 'oscillating')
})

test('detectNoProgress A→B→C→D 不触发', () => {
  let state
  for (const content of ['A', 'B', 'C', 'D']) {
    const r = detectNoProgress(state, exec(), ok(content), cfgProgress)
    state = r.state
    assert.equal(r.fired, false)
  }
})

test('detectNoProgress 连续相同触发 identical', () => {
  let state
  let last
  for (let i = 0; i < 4; i++) {
    last = detectNoProgress(state, exec(), ok('same'), cfgProgress)
    state = last.state
  }
  assert.equal(last.fired, true)
  assert.equal(last.evidenceType, 'identical')
})

test('detectNoProgress 连续空结果触发 empty', () => {
  let state
  let last
  for (let i = 0; i < 4; i++) {
    last = detectNoProgress(state, exec(), ok(''), cfgProgress)
    state = last.state
  }
  assert.equal(last.fired, true)
  assert.equal(last.evidenceType, 'empty')
})

test('detectNoProgress checkResultHash=false 时 isEmpty 恒 false', () => {
  const cfg = { window: 2, checkIsError: true, checkResultHash: false }
  let state
  let last
  for (let i = 0; i < 3; i++) {
    last = detectNoProgress(state, exec(), ok(''), cfg)
    state = last.state
  }
  assert.equal(last.fired, true)
  assert.equal(last.evidenceType, 'identical')
})

test('noProgressFingerprint 独立返回 isEmpty', () => {
  const cfg = { checkIsError: true, checkResultHash: true }
  assert.equal(noProgressFingerprint(exec(), ok(''), cfg).isEmpty, true)
  assert.equal(noProgressFingerprint(exec(), ok('x'), cfg).isEmpty, false)
  const cfgOff = { checkIsError: true, checkResultHash: false }
  assert.equal(noProgressFingerprint(exec(), ok(''), cfgOff).isEmpty, false)
})

test('detectNoLanding 连续静默达到 turns 触发', () => {
  let state = { silentStreak: 0, sawTextThisAttempt: false }
  const r1 = detectNoLanding(state, false, 3)
  const r2 = detectNoLanding(r1.state, false, 3)
  const r3 = detectNoLanding(r2.state, false, 3)
  assert.equal(r1.fired, false)
  assert.equal(r2.fired, false)
  assert.equal(r3.fired, true)
})

test('detectNoLanding 有文本时重置', () => {
  const r = detectNoLanding({ silentStreak: 2, sawTextThisAttempt: false }, true, 3)
  assert.equal(r.state.silentStreak, 0)
  assert.equal(r.fired, false)
})

test('detectHardCap 步数上限', () => {
  const r = detectHardCap(undefined, { turn: 1, step: 50 }, { maxSteps: 50, maxSeconds: 900 }, 1000)
  assert.equal(r.reason, 'step-cap:50')
})

test('detectHardCap 时间上限', () => {
  const cfg = { maxSteps: 50, maxSeconds: 900 }
  const r1 = detectHardCap(undefined, { turn: 1, step: 1 }, cfg, 0)
  const r2 = detectHardCap(r1.state, { turn: 1, step: 2 }, cfg, 900 * 1000)
  assert.equal(r2.reason, 'time-cap:900')
})

test('detectNoEvidence 无成功证据触发 no-evidence', () => {
  const r = detectNoEvidence('all done', {
    hasMeaningfulSuccess: false,
    wroteAnything: false,
    verifiedAfterWrite: false,
  }, { keywords: ['done'] })
  assert.equal(r.fired, true)
  assert.equal(r.evidenceType, 'no-evidence')
})

test('detectNoEvidence 写后未验证触发 unverified-write', () => {
  const r = detectNoEvidence('all done', {
    hasMeaningfulSuccess: true,
    wroteAnything: true,
    verifiedAfterWrite: false,
  }, { keywords: ['done'] })
  assert.equal(r.fired, true)
  assert.equal(r.evidenceType, 'unverified-write')
})

test('detectNoEvidence 有成功证据且无写操作不触发', () => {
  const r = detectNoEvidence('all done', {
    hasMeaningfulSuccess: true,
    wroteAnything: false,
    verifiedAfterWrite: false,
  }, { keywords: ['done'] })
  assert.equal(r.fired, false)
})

test('detectNoEvidence 无关键词不触发', () => {
  const r = detectNoEvidence('still working', {
    hasMeaningfulSuccess: false,
    wroteAnything: false,
    verifiedAfterWrite: false,
  }, { keywords: ['done'] })
  assert.equal(r.fired, false)
})

test('isMeaningfulResult 排除错误与空内容', () => {
  assert.equal(isMeaningfulResult(ok('ok')), true)
  assert.equal(isMeaningfulResult(ok('')), false)
  assert.equal(isMeaningfulResult(ok('   ')), false)
  assert.equal(isMeaningfulResult(err('boom')), false)
  assert.equal(isMeaningfulResult(null), false)
})

test('classifyTool 识别写与验证工具', () => {
  assert.deepEqual(classifyTool('write_file'), { isWrite: true, isVerify: false })
  assert.deepEqual(classifyTool('read_file'), { isWrite: false, isVerify: true })
  assert.deepEqual(classifyTool('run_tests'), { isWrite: false, isVerify: true })
  assert.deepEqual(classifyTool('edit_file'), { isWrite: true, isVerify: false })
})

// ===================== arbiter.mjs =====================

test('arbiter identical 首次 BLOCK，第三次 STOP', () => {
  const arb = createArbiter()
  const agent = {}
  const signal = { fired: true, suspicion: 'high', evidenceType: 'identical' }
  assert.equal(arb.decide(agent, 'tool-repeat', signal).level, LEVEL.BLOCK)
  assert.equal(arb.decide(agent, 'tool-repeat', signal).level, LEVEL.BLOCK)
  assert.equal(arb.decide(agent, 'tool-repeat', signal).level, LEVEL.STOP)
})

test('arbiter near-duplicate medium 首次 WARN', () => {
  const arb = createArbiter()
  const r = arb.decide({}, 'tool-repeat', {
    fired: true, suspicion: 'medium', evidenceType: 'near-duplicate',
  })
  assert.equal(r.level, LEVEL.WARN)
})

test('arbiter text-repeat 强制 STOP', () => {
  const arb = createArbiter()
  const r = arb.decide({}, 'text-repeat', {
    fired: true, suspicion: 'high', evidenceType: 'identical',
  })
  assert.equal(r.level, LEVEL.STOP)
})

test('arbiter 未触发返回 NONE', () => {
  const arb = createArbiter()
  assert.equal(arb.decide({}, 'x', { fired: false }).level, LEVEL.NONE)
})

test('arbiter reset 后计数归零', () => {
  const arb = createArbiter()
  const agent = {}
  const signal = { fired: true, suspicion: 'high', evidenceType: 'identical' }
  arb.decide(agent, 'tool-repeat', signal)
  arb.decide(agent, 'tool-repeat', signal)
  arb.reset(agent)
  assert.equal(arb.decide(agent, 'tool-repeat', signal).count, 1)
})