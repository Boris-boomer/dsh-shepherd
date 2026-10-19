/**
 * dsh-agent-guard · Client 浮窗。
 */

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { FC, ReactElement } from 'react'

const REGISTRY_ID = 'agent-guard'
const NS = 'agent-guard'
const MODES = ['planning', 'coding', 'verify'] as const
type Mode = typeof MODES[number]
const MODE_ICONS: Record<Mode, string> = { planning: '📋', coding: '⌨️', verify: '🚀' }

// ===================== 通用工具 =====================

function getAt(value: Record<string, unknown> | undefined, path: string): unknown {
  if (!value) return undefined
  let cur: unknown = value
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function setAt(value: Record<string, unknown>, path: string, next: unknown): Record<string, unknown> {
  const keys = path.split('.')
  const root = { ...value }
  let cur: Record<string, unknown> = root
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    const existing = cur[k]
    cur[k] = existing != null && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[keys[keys.length - 1]] = next
  return root
}

async function readSnapshot(ctx: any): Promise<Record<string, unknown>> {
  try {
    const response = await ctx.remote.settings.describe()
    if (!response.ok) return {}
    const ns = response.value.namespaces?.find((c: any) => c.ns === NS)
    return ns?.value ?? {}
  } catch { return {} }
}

async function writeField(ctx: any, path: string, next: unknown, base?: Record<string, unknown>): Promise<void> {
  try {
    const response = await ctx.remote.settings.describe()
    const revision = response.ok
      ? response.value.namespaces?.find((c: any) => c.ns === NS)?.revision
      : undefined
    await ctx.remote.settings.update(NS, setAt(base ?? {}, path, next), revision)
  } catch (cause) {
    console.warn('[agent-guard] settings update failed', cause instanceof Error ? cause.message : cause)
  }
}

// ===================== RPC 通信 =====================

interface PendingItem { id: string; tool: string }

async function callBackend(ctx: any, method: string, ...args: unknown[]) {
  const wrapped = await (ctx as any).connection.rpc.call('/api', `agent-guard/${method}`, {
    args: args.length === 0 ? {} : args.length === 1 ? args[0] : args,
  }) as { ok?: boolean; value?: unknown; error?: { message?: string } } | undefined
  if (!wrapped || wrapped.ok !== true) throw new Error(wrapped?.error?.message ?? 'RPC 调用失败')
  return wrapped.value
}

// ===================== 浮动容器 =====================

function createFloatingContainer(): HTMLDivElement {
  const container = document.createElement('div')
  container.style.cssText = `
    position: fixed; bottom: 180px; right: 24px; width: 320px; max-height: 400px;
    background: #ffffff; border: 1px solid #e0e0e0; border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.22); z-index: 999999;
    overflow: hidden; display: none; flex-direction: column;
    font-family: system-ui, -apple-system, sans-serif;
  `
  let isDragging = false, offsetX = 0, offsetY = 0
  container.addEventListener('mousedown', (e) => {
    if (!(e.target as HTMLElement).closest('.panel-header')) return
    isDragging = true
    const rect = container.getBoundingClientRect()
    offsetX = e.clientX - rect.left; offsetY = e.clientY - rect.top
    container.style.cursor = 'grabbing'; e.preventDefault()
  })
  const onMove = (e: MouseEvent) => {
    if (!isDragging) return
    container.style.left = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - container.offsetWidth)) + 'px'
    container.style.top = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - container.offsetHeight)) + 'px'
    container.style.right = 'auto'; container.style.bottom = 'auto'
  }
  const onUp = () => { if (isDragging) { isDragging = false; container.style.cursor = 'default' } }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  const orig = container.remove.bind(container)
  container.remove = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); orig() }
  return container
}

// ===================== React 面板 =====================

const LOOP_TOGGLES = [
  { label: '总开关', path: 'loop.enabled' },
  { label: '文本重复 A', path: 'loop.textRepeat.enabled' },
  { label: '工具重复 B', path: 'loop.toolRepeat.enabled' },
  { label: '无进展 C', path: 'loop.noProgress.enabled' },
  { label: '工具超时 D', path: 'loop.toolTimeout.enabled' },
  { label: '无落地 E', path: 'loop.noLanding.enabled' },
  { label: '硬上限 F', path: 'loop.hardCap.enabled' },
  { label: '无证据完成 G', path: 'loop.noEvidence.enabled' },
]

interface LoopTabProps {
  snapshot: Record<string, unknown>
  onToggle: (path: string, next: unknown) => void
}
const LoopTab: FC<LoopTabProps> = ({ snapshot, onToggle }) => {
  const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }
  return (
    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#161616' }}>🔁 循环守护</span>
        <span style={{ fontSize: 11, color: '#8a8a8a' }}>实时循环/卡死打断 · 详细参数在 设置→插件配置</span>
      </div>
      {LOOP_TOGGLES.map(f => {
        const on = Boolean(getAt(snapshot, f.path))
        return (
          <div key={f.path} style={row}>
            <span style={{ fontSize: 12, color: '#3a3a3a' }}>{f.label}</span>
            <button role="switch" aria-checked={on} onClick={() => onToggle(f.path, !on)} style={{
              position: 'relative', width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
              background: on ? '#0969da' : '#d0d0d0', border: 'none', flexShrink: 0,
            }}>
              <span style={{
                position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18,
                borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                transition: 'left 0.2s',
              }} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

interface ModeTabProps {
  ctx: any
  snapshot: Record<string, unknown>
  onModeChange: (mode: Mode) => void
}
const ModeTab: FC<ModeTabProps> = ({ ctx, snapshot, onModeChange }): ReactElement => {
  const [queue, setQueue] = useState<PendingItem[]>([])
  const mode = (getAt(snapshot, 'mode.mode') as Mode) ?? 'planning'

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const q = await callBackend(ctx, 'getQueue') // 原接口如果还存在请换成 getState 内的 pending
        if (alive && Array.isArray(q)) setQueue(q)
      } catch {
        // 回退测试 getState
        try {
          const state = await callBackend(ctx, 'getState')
          if (alive && state && Array.isArray(state.pending)) setQueue(state.pending)
        } catch {}
      }
    }
    void load()
    const offQueue = ctx.on('agent-guard/mode/queue-updated', (q: PendingItem[]) => setQueue(q)) as unknown as () => void
    const offMode = ctx.on('agent-guard/mode/mode-changed', () => load()) as unknown as () => void
    return () => { alive = false; offQueue(); offMode() }
  }, [ctx])

  const switchMode = (next: Mode) => { if (next !== mode) onModeChange(next) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
        {MODES.map(m => (
          <button key={m} onClick={() => switchMode(m)} style={{
            flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid #ccc',
            background: mode === m ? '#2d7d46' : '#f5f5f5',
            color: mode === m ? '#fff' : '#333', fontWeight: mode === m ? 'bold' : 'normal',
            cursor: 'pointer', fontSize: 13, transition: 'all 0.2s',
          }}>{MODE_ICONS[m]} {m.charAt(0).toUpperCase() + m.slice(1)}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {queue.length === 0 ? (
          <div style={{ color: '#888', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>📭 挂起队列为空</div>
        ) : queue.map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#333' }}>{item.tool}</span>
            <button onClick={() => void callBackend(ctx, 'executeOne', item.id).then(() => {
              const q = callBackend(ctx, 'getQueue'); q.then(v => Array.isArray(v) && setQueue(v))
            })} style={{
              background: '#0969da', color: '#fff', border: 'none', borderRadius: 4,
              padding: '2px 10px', fontSize: 12, cursor: 'pointer',
            }}>▶</button>
          </div>
        ))}
      </div>
    </div>
  )
}

interface PanelProps {
  ctx: any
  snapshot: Record<string, unknown>
  onToggle: (path: string, next: unknown) => void
  onModeChange: (mode: Mode) => void
}
const PanelContent: FC<PanelProps> = ({ ctx, snapshot, onToggle, onModeChange }): ReactElement => {
  const [tab, setTab] = useState<'loop' | 'mode'>('loop')
  const tabStyle = (active: boolean) => ({
    flex: 1, padding: '7px 0', borderRadius: 6, border: '1px solid #ccc',
    background: active ? '#0969da' : '#f5f5f5',
    color: active ? '#fff' : '#333', fontWeight: (active ? 'bold' : 'normal') as const,
    cursor: 'pointer', fontSize: 13,
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-header" style={{
        padding: '10px 12px', background: '#0969da', color: '#fff', fontWeight: 600, fontSize: 14,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
        cursor: 'grab', userSelect: 'none',
      }}>
        <span>🛡️ Agent Guard</span>
        <button onClick={() => { if (floatingContainer) floatingContainer.style.display = 'none' }}
          style={{ background: 'none', border: 'none', color: '#fff', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
        <button style={tabStyle(tab === 'loop')} onClick={() => setTab('loop')}>🔁 循环守护</button>
        <button style={tabStyle(tab === 'mode')} onClick={() => setTab('mode')}>🚦 模式守卫</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'loop'
          ? <LoopTab snapshot={snapshot} onToggle={onToggle} />
          : <ModeTab ctx={ctx} snapshot={snapshot} onModeChange={onModeChange} />}
      </div>
    </div>
  )
}

// ===================== 入口 =====================

export const inject = ['remote', 'remote.settings', 'connection']

let floatingRoot: ReturnType<typeof createRoot> | null = null
let floatingContainer: HTMLDivElement | null = null

function renderPanel(ctx: any) {
  if (!floatingContainer) return
  const contentDiv = floatingContainer.querySelector('.panel-content') as HTMLDivElement | null
  if (!contentDiv) return
  if (!floatingRoot) floatingRoot = createRoot(contentDiv)
  floatingRoot.render(<div style={{ padding: '20px', textAlign: 'center', color: '#888' }}>⏳ 加载中...</div>)

  void readSnapshot(ctx).then(snapshot => {
    const refreshQueue = () => {
      floatingRoot!.render(
        <PanelContent
          ctx={ctx} snapshot={snapshot}
          onToggle={(path, next) => {
            void writeField(ctx, path, next, snapshot)
            snapshot = setAt(snapshot, path, next)
            refreshQueue()
          }}
          onModeChange={next => {
            void writeField(ctx, 'mode.mode', next, snapshot)
            snapshot = setAt(snapshot, 'mode.mode', next)
            refreshQueue()
          }}
        />
      )
    }
    refreshQueue()
  })
}

export function apply(ctx: any): void {
  if (floatingContainer && document.body.contains(floatingContainer)) return

  const container = createFloatingContainer()
  document.body.appendChild(container)
  floatingContainer = container

  const contentDiv = document.createElement('div')
  contentDiv.className = 'panel-content'
  contentDiv.style.cssText = 'display: flex; flex-direction: column; height: 100%;'
  container.appendChild(contentDiv)

  renderPanel(ctx)

  const registry = ((window as any).__dshIconRegistry ||= []) as Array<{
    id: string; icon: string; label: string; packageName?: string; onClick?: () => void
  }>
  registry.push({
    id: REGISTRY_ID, icon: '🛡️', label: 'Agent Guard', packageName: 'dsh-agent-guard',
    onClick: () => {
      if (!floatingContainer) return
      const visible = floatingContainer.style.display === 'flex'
      floatingContainer.style.display = visible ? 'none' : 'flex'
      if (!visible) renderPanel(ctx)
    },
  })

  ctx.on('dispose', () => {
    floatingRoot?.unmount(); floatingRoot = null
    floatingContainer?.remove(); floatingContainer = null
    const reg = (window as any).__dshIconRegistry as Array<{ id: string }> | undefined
    if (reg) { const i = reg.findIndex(e => e.id === REGISTRY_ID); if (i >= 0) reg.splice(i, 1) }
  })
}