/**
 * dsh-agent-guard · 参数规范化 + 内容哈希。
 * 增强：contentHash 支持传入对象。
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
  return JSON.stringify(sortJsonValue(argumentsValue))
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