export type Fx = 'none' | 'clear' | 'miss' | 'levelup' | 'launch' | 'chest' | 'type' | 'crit' | 'daily' | 'quest'
export type Dopa = {
  mode: 'idle' | 'working' | 'waiting'
  combo: number
  xp: number
  level: number
  gain: number
  fx: Fx
  tick: number
  typing: number
  streak: number
}
export type Loot = {
  themes: string[]
  theme: string
  shouts: string[]
  chest: { kind: 'theme' | 'shout' | 'xp'; id: string; bonus: number; seq: number; why: string; at: number } | null
  ctx: number | null
  lastDone: number | null
}

export type QuestId = 'nomiss' | 'cache' | 'fever' | 'detail' | 'finish'
export type Quests = {
  day: string
  list: QuestId[]
  prog: Partial<Record<QuestId, number>>
  bonus: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'dopa-backdrop': { dopa: Shaped<Dopa>; loot: Shaped<Loot>; quests: Shaped<Quests> }
  }
}
