/**
 * dsh-sentinel · 合并配置 schema。
 */

import z from '@deepseek-ai/schemastery'

export const NS = 'sentinel'

// ===================== 循环守卫（loop） =====================

export const TextRepeatSchema = z.object({
  enabled: z.boolean().default(true),
  minBlockLen: z.number().default(80),
  maxBlockLen: z.number().default(1200),
  repeats: z.number().default(3),
  windowChars: z.number().default(4000),
})

export const ToolRepeatSchema = z.object({
  enabled: z.boolean().default(true),
  repeats: z.number().default(3),
})

export const NoProgressSchema = z.object({
  enabled: z.boolean().default(true),
  window: z.number().default(6),
  checkResultHash: z.boolean().default(true),
  checkIsError: z.boolean().default(true),
})

export const ToolTimeoutSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.number().default(60000),
})

export const NoLandingSchema = z.object({
  enabled: z.boolean().default(true),
  turns: z.number().default(3),
})

export const HardCapSchema = z.object({
  enabled: z.boolean().default(true),
  maxSteps: z.number().default(50),
  maxSeconds: z.number().default(900),
})

export const NoEvidenceSchema = z.object({
  enabled: z.boolean().default(true),
  keywords: z.array(z.string()).default(['完成', '已修复', 'done', 'fixed', 'implemented']),
})

export const LOOP_PROMPT_DEFAULT =
  '⚠️ 检测到你陷入了无进展/循环，已自动打断本次生成。请停止重复刚才的动作，分析已有结果，换一个全新的角度或结束任务。'

export const LOOP_DEFAULTS = {
  enabled: true,
  maxInterruptsPerAgent: 3,
  textRepeat: { enabled: true, minBlockLen: 80, maxBlockLen: 1200, repeats: 3, windowChars: 4000 },
  toolRepeat: { enabled: true, repeats: 3 },
  noProgress: { enabled: true, window: 6, checkResultHash: true, checkIsError: true },
  toolTimeout: { enabled: true, timeoutMs: 60000 },
  noLanding: { enabled: true, turns: 3 },
  hardCap: { enabled: true, maxSteps: 50, maxSeconds: 900 },
  noEvidence: { enabled: true, keywords: ['完成', '已修复', 'done', 'fixed', 'implemented'] },
  prompt: LOOP_PROMPT_DEFAULT,
}

export const LoopGuardSchema = z.object({
  enabled: z.boolean().default(true),
  maxInterruptsPerAgent: z.number().default(3),
  textRepeat: TextRepeatSchema,
  toolRepeat: ToolRepeatSchema,
  noProgress: NoProgressSchema,
  toolTimeout: ToolTimeoutSchema,
  noLanding: NoLandingSchema,
  hardCap: HardCapSchema,
  noEvidence: NoEvidenceSchema,
  prompt: z.string().default(LOOP_PROMPT_DEFAULT),
})

// ===================== 模式守卫（mode） =====================

export const DEFAULT_BLACKLIST = [
  'execute_command', 'pytest', 'npm_test', 'lint', 'eslint',
  'compile', 'build', 'test', 'run_tests',
]

export const MODE_VALUES = ['planning', 'coding', 'verify']

export const MODE_DEFAULTS = {
  enabled: true,
  mode: 'planning',
  blacklist: [...DEFAULT_BLACKLIST],
}

export const ModeGuardSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.union([z.const('planning'), z.const('coding'), z.const('verify')]).default('planning'),
  blacklist: z.array(z.string()).default([...DEFAULT_BLACKLIST]),
})

// ===================== 顶层合并配置 =====================

export const Config = z.object({
  loop: LoopGuardSchema.default(LOOP_DEFAULTS),
  mode: ModeGuardSchema.default(MODE_DEFAULTS),
})

Config.meta = Config.meta || {}
Config.meta.volatile = true