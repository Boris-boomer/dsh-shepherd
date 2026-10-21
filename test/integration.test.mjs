import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  registerTextRepeat,
  registerToolRepeat,
  registerNoProgress,
  registerNoEvidence,
} from '../src/guards.mjs'
import { createInterruptManager } from '../src/lib/interrupt.mjs'
import { createArbiter } from '../src/lib/arbiter.mjs'
import { applyModeGuard } from '../src/mode-guard.mjs'

// ===================== mock =====================

function createCtx() {
  const handlers = new Map()
  return {
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(fn)
    },
    handlersFor(event) { return handlers.get(event) || [] },
  }
}

function createAgent() {
  const calls = { cancel: [], steer: [] }
  return {
    id: 'test-agent',
    cancel(opts, opts2) { calls.cancel.push([opts, opts2]) },
    steer(payload) { calls.steer.push(payload) },
    calls,
  }
}

const passNext = async () => ({ kind: 'allow' })

function setupGuards(register, cfg) {
  const ctx = createCtx()
  const agent = createAgent()
  const manager = createInterruptManager(3)
  const arbiter = createArbiter()
  register(ctx, () => cfg, () => 'test-prompt', manager, arbiter)
  return { ctx, agent, manager, arbiter }
}

// ===================== A: text-repeat =====================

test('integration: text-repeat 触发 cancel + steer', () => {
  const { ctx, agent } = setupGuards(registerTextRepeat, {
    enabled: true, minBlockLen: 10, maxBlockLen: 100, repeats: 3, windowChars: 4000,
  })
  const handler = ctx.handlersFor('agent/assistant-stream')[0]
  handler({ agent, frame: { type: 'start' } })
  handler({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'a'.repeat(200) } } })
  assert.equal(agent.calls.cancel.length, 1)
  assert.equal(agent.calls.steer.length, 1)
})

test('integration: text-repeat 同一 agent 只触发一次', () => {
  const { ctx, agent } = setupGuards(registerTextRepeat, {
    enabled: true, minBlockLen: 10, maxBlockLen: 100, repeats: 3, windowChars: 4000,
  })
  const handler = ctx.handlersFor('agent/assistant-stream')[0]
  handler({ agent, frame: { type: 'start' } })
  const chunk = { agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'a'.repeat(200) } } }
  handler(chunk)
  handler(chunk)
  assert.equal(agent.calls.cancel.length, 1)
})

// ===================== B: tool-repeat =====================

test('integration: tool-repeat 前两次放行，第三次 deny', async () => {
  const { ctx, agent } = setupGuards(registerToolRepeat, { enabled: true, repeats: 3 })
  const handler = ctx.handlersFor('tools/pre-execute')[0]
  const exec = { agent, name: 'read_file', arguments: { path: 'f', offset: 0 } }

  assert.equal((await handler(exec, passNext)).kind, 'allow')
  assert.equal((await handler(exec, passNext)).kind, 'allow')
  const r = await handler(exec, passNext)
  assert.equal(r.kind, 'deny')
  assert.ok(r.reason.includes('read_file'))
})

test('integration: tool-repeat 分页参数不同仍判近重复', async () => {
  const { ctx, agent } = setupGuards(registerToolRepeat, { enabled: true, repeats: 3 })
  const handler = ctx.handlersFor('tools/pre-execute')[0]
  const a = { agent, name: 'read_file', arguments: { path: 'f', offset: 0 } }
  const b = { agent, name: 'read_file', arguments: { path: 'f', offset: 100 } }
  const c = { agent, name: 'read_file', arguments: { path: 'f', offset: 200 } }
  await handler(a, passNext)
  await handler(b, passNext)
  const r = await handler(c, passNext)
  assert.equal(r.kind, 'deny')
})

test('integration: tool-repeat 不同文件不触发', async () => {
  const { ctx, agent } = setupGuards(registerToolRepeat, { enabled: true, repeats: 3 })
  const handler = ctx.handlersFor('tools/pre-execute')[0]
  for (const path of ['a', 'b', 'c', 'd']) {
    const r = await handler({ agent, name: 'read_file', arguments: { path } }, passNext)
    assert.equal(r.kind, 'allow')
  }
})

test('integration: tool-repeat 拒绝不触发 cancel', async () => {
  const { ctx, agent } = setupGuards(registerToolRepeat, { enabled: true, repeats: 3 })
  const handler = ctx.handlersFor('tools/pre-execute')[0]
  const exec = { agent, name: 'read_file', arguments: { path: 'f' } }
  await handler(exec, passNext)
  await handler(exec, passNext)
  await handler(exec, passNext)
  assert.equal(agent.calls.cancel.length, 0)
})

// ===================== C: no-progress =====================

test('integration: no-progress 振荡首次 WARN（steer 不 cancel）', () => {
  const { ctx, agent } = setupGuards(registerNoProgress, {
    enabled: true, window: 3, checkIsError: true, checkResultHash: true,
  })
  const handler = ctx.handlersFor('tools/result')[0]
  for (const content of ['A', 'B', 'A', 'B', 'A']) {
    handler({ agent, name: 'read_file' }, { isError: false, content })
  }
  assert.equal(agent.calls.steer.length, 1)
  assert.equal(agent.calls.cancel.length, 0)
})

test('integration: no-progress 连续相同首次 BLOCK 降级 STOP', () => {
  const { ctx, agent } = setupGuards(registerNoProgress, {
    enabled: true, window: 3, checkIsError: true, checkResultHash: true,
  })
  const handler = ctx.handlersFor('tools/result')[0]
  for (let i = 0; i < 4; i++) {
    handler({ agent, name: 'read_file' }, { isError: false, content: 'same' })
  }
  assert.equal(agent.calls.cancel.length, 1)
})

// ===================== G: no-evidence =====================

test('integration: no-evidence 声明完成但无工具证据触发 WARN', () => {
  const { ctx, agent } = setupGuards(registerNoEvidence, { enabled: true, keywords: ['done'] })
  const stream = ctx.handlersFor('agent/assistant-stream')[0]
  const stopping = ctx.handlersFor('agent/turn-stopping')[0]
  stream({ agent, frame: { type: 'start' } })
  stream({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'all done' } } })
  stopping({ agent })
  assert.equal(agent.calls.steer.length, 1)
  assert.equal(agent.calls.cancel.length, 0)
})

test('integration: no-evidence 有成功工具结果不触发', () => {
  const { ctx, agent } = setupGuards(registerNoEvidence, { enabled: true, keywords: ['done'] })
  const stream = ctx.handlersFor('agent/assistant-stream')[0]
  const results = ctx.handlersFor('tools/result')[0]
  const stopping = ctx.handlersFor('agent/turn-stopping')[0]
  stream({ agent, frame: { type: 'start' } })
  stream({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'all done' } } })
  results({ agent, name: 'run_tests' }, { isError: false, content: 'ok' })
  stopping({ agent })
  assert.equal(agent.calls.steer.length, 0)
})

test('integration: no-evidence 写后未验证触发', () => {
  const { ctx, agent } = setupGuards(registerNoEvidence, { enabled: true, keywords: ['done'] })
  const stream = ctx.handlersFor('agent/assistant-stream')[0]
  const results = ctx.handlersFor('tools/result')[0]
  const stopping = ctx.handlersFor('agent/turn-stopping')[0]
  stream({ agent, frame: { type: 'start' } })
  stream({ agent, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'all done' } } })
  results({ agent, name: 'write_file' }, { isError: false, content: 'ok' })
  stopping({ agent })
  assert.equal(agent.calls.steer.length, 1)
})

// ===================== mode-guard =====================

test('integration: mode-guard coding 黑名单返回 ask', async () => {
  const ctx = createCtx()
  const agent = createAgent()
  const cfg = { enabled: true, mode: 'coding', blacklist: ['execute_command'] }
  applyModeGuard(ctx, () => cfg)
  const handler = ctx.handlersFor('tools/pre-execute')[0]
  const r = await handler({ agent, name: 'execute_command' }, passNext)
  assert.equal(r.kind, 'ask')
})

test('integration: mode-guard planning 不拦截', async () => {
  const ctx = createCtx()
  const agent = createAgent()
  const cfg = { enabled: true, mode: 'planning', blacklist: ['execute_command'] }
  applyModeGuard(ctx, () => cfg)
  const handler = ctx.handlersFor('tools/pre-execute')[0]
  const r = await handler({ agent, name: 'execute_command' }, passNext)
  assert.equal(r.kind, 'allow')
})

test('integration: mode-guard 连续 3 次失败后 deny', async () => {
  const ctx = createCtx()
  const agent = createAgent()
  const cfg = { enabled: true, mode: 'coding', blacklist: ['execute_command'] }
  applyModeGuard(ctx, () => cfg)
  const preExec = ctx.handlersFor('tools/pre-execute')[0]
  const postExec = ctx.handlersFor('tools/post-execute')[0]
  const exec = { agent, name: 'execute_command' }
  for (let i = 0; i < 3; i++) {
    assert.equal((await preExec(exec, passNext)).kind, 'ask')
    await postExec(exec, { isError: true }, passNext)
  }
  assert.equal((await preExec(exec, passNext)).kind, 'deny')
})

test('integration: mode-guard 成功后失败计数清零', async () => {
  const ctx = createCtx()
  const agent = createAgent()
  const cfg = { enabled: true, mode: 'coding', blacklist: ['execute_command'] }
  applyModeGuard(ctx, () => cfg)
  const preExec = ctx.handlersFor('tools/pre-execute')[0]
  const postExec = ctx.handlersFor('tools/post-execute')[0]
  const exec = { agent, name: 'execute_command' }
  for (let i = 0; i < 2; i++) {
    await preExec(exec, passNext)
    await postExec(exec, { isError: true }, passNext)
  }
  await preExec(exec, passNext)
  await postExec(exec, { isError: false, content: 'ok' }, passNext)
  await preExec(exec, passNext)
  await postExec(exec, { isError: true }, passNext)
  assert.equal((await preExec(exec, passNext)).kind, 'ask')
})

test('integration: mode-guard 用户新消息重置计数', async () => {
  const ctx = createCtx()
  const agent = createAgent()
  const cfg = { enabled: true, mode: 'coding', blacklist: ['execute_command'] }
  applyModeGuard(ctx, () => cfg)
  const preExec = ctx.handlersFor('tools/pre-execute')[0]
  const postExec = ctx.handlersFor('tools/post-execute')[0]
  const preStep = ctx.handlersFor('agent/pre-step')[0]
  const exec = { agent, name: 'execute_command' }
  for (let i = 0; i < 3; i++) {
    await preExec(exec, passNext)
    await postExec(exec, { isError: true }, passNext)
  }
  await preStep({ agent, messages: [{ source: { kind: 'user' } }] }, passNext)
  assert.equal((await preExec(exec, passNext)).kind, 'ask')
})