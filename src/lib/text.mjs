/**
 * dsh-shepherd · 文本归一化 + 重复块/字符级周期检测。
 * 纯函数，无副作用，可独立测试。
 */


export function normalize(s) {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\u4e00-\u9fa5]/g, '')
    .replace(/\s/g, '')
}

/**
 * 块级重复检测（保留原有语义）。
 */
export function hasRepeatedBlock(window, minBlockLen, maxBlockLen, repeats) {
  const max = Math.min(maxBlockLen, Math.floor(window.length / repeats))
  if (max < minBlockLen) return false
  for (let blockLen = minBlockLen; blockLen <= max; blockLen++) {
    const unit = window.slice(-blockLen)
    if (window.slice(-blockLen * repeats) === unit.repeat(repeats)) return true
  }
  return false
}

/**
 * 字符级周期检测：从窗口末尾往前找最短周期 p，
 * 验证末尾至少 minSpan 个字符可以由该周期重复构成。
 * 逐字符不抽样，避免漏掉单字符/短语级退化。
 *
 * 复杂度受 maxPeriod 限制，窗口 4000 字符时最坏约 4000*512 次切片比较，
 * 只在 chunk 到达时调用，且 fired 后调用方会停止检测，可接受。
 */
export function hasCharLevelCycle(window, minSpan = 64, minRepeats = 3, maxPeriod = 512) {
  if (window.length < minSpan) return false
  const limit = Math.min(maxPeriod, Math.floor(window.length / minRepeats))
  for (let p = 1; p <= limit; p++) {
    const unit = window.slice(-p)
    let count = 0
    let idx = window.length
    while (idx >= p && window.slice(idx - p, idx) === unit) {
      count++
      idx -= p
    }
    if (count >= minRepeats && count * p >= minSpan) return true
  }
  return false
}