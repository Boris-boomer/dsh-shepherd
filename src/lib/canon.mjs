/**
 * dsh-shepherd · 参数规范化 + 内容哈希 + 易变量剥离。
 */

export function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const sorted = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue(value[key])
    }
    return sorted
  }
  return value
}

export function canonicalize(argumentsValue) {
  return JSON.stringify(sortJsonValue(argumentsValue ?? null))
}

export function contentHash(content) {
  let s = ''
  if (typeof content === 'string') {
    s = content.trim().replace(/\s+/g, ' ')
  } else if (content != null) {
    s = JSON.stringify(sortJsonValue(content))
  }
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return h.toString(36)
}

// ---- 易变量剥离 ----

const EPHEMERAL_PATTERNS = [
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
  /\b\d{2}:\d{2}:\d{2}\b/g,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\b[0-9a-f]{16,}\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds|秒|毫秒)\b/gi,
]

export function stripEphemeral(s) {
  if (typeof s !== 'string') return s
  let out = s
  for (const p of EPHEMERAL_PATTERNS) out = out.replace(p, '<VAR>')
  return out
}

/**
 * 观测指纹：剥离易变量后取哈希。
 * 返回 'empty' 表示无产出，调用方需单独区分。
 */
export function observationFingerprint(content) {
  if (content == null) return 'empty'
  const raw = typeof content === 'string' ? content : JSON.stringify(sortJsonValue(content))
  const stripped = stripEphemeral(raw).trim()
  if (!stripped) return 'empty'
  return contentHash(stripped)
}

// ---- 参数主干语义哈希 ----

const VOLATILE_ARG_KEYS = new Set([
  'offset', 'limit', 'page', 'cursor', 'timestamp', 'time', 'ts',
  'start', 'end', 'from', 'to', 'since', 'until',
  'retry', 'attempt', 'nonce', 'requestId', 'traceId',
])

export function stripVolatileFields(value, depth = 0) {
  if (depth > 6) return value
  if (Array.isArray(value)) return value.map(v => stripVolatileFields(v, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) {
      if (VOLATILE_ARG_KEYS.has(key)) continue
      out[key] = stripVolatileFields(value[key], depth + 1)
    }
    return out
  }
  return value
}

export function semanticArgHash(argumentsValue) {
  return contentHash(canonicalize(stripVolatileFields(argumentsValue)))
}