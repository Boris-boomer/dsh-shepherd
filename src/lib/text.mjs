/**
 * dsh-agent-guard · 文本归一化 + 重复块检测。
 * 纯函数，无副作用，可独立测试。
 * （源自 dsh-loop-guard/src/lib/text.mjs，合并后保留）
 */

/**
 * 归一化文本：小写 + 压缩空白 + 去除标点 + 合并空格。
 * 目的：让内容对比不受格式差异影响。
 */
export function normalize(s) {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\u4e00-\u9fa5]/g, '')
    .replace(/\s/g, '')
}

/**
 * 检测窗口尾部是否存在重复块。
 *
 * 算法：从 minBlockLen 到 max(窗口长度/repeats) 枚举块长度，
 * 检查末尾是否连续 repeats 次相同块。
 *
 * @param window - 归一化后的文本窗口
 * @param minBlockLen - 最小块长度（避免误判短重复）
 * @param maxBlockLen - 最大块长度
 * @param repeats - 需要重复的次数
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