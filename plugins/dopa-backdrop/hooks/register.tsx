import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Dopa, Fx, Loot, QuestId, Quests } from '../types'

const dopa = atom({ plugin: 'dopa-backdrop', key: 'dopa' } as const, {
  mode: 'idle', combo: 0, xp: 0, level: 1, gain: 0, fx: 'none', tick: 0, typing: 0, streak: 0,
} as Dopa, { shape: 'dopa-4' })

const loot = atom({ plugin: 'dopa-backdrop', key: 'loot' } as const, {
  themes: ['neon'], theme: 'neon', shouts: [], chest: null, ctx: null, lastDone: null,
} as Loot, { shape: 'loot-6' })

const quests = atom({ plugin: 'dopa-backdrop', key: 'quests' } as const, {
  day: '', list: [], prog: {}, bonus: false,
} as Quests, { shape: 'quests-1' })

const W = 2560
const H = 1600
const PER_LEVEL = 300
const CACHE_MIN = 60
const PANE = 'loot'
const PANE_BG = '#101E33'
const FEVER_AT = 10
let PINK = '#FF4FA0'
let CYAN = '#2EE6FF'
let LIME = '#7CFF6B'
let BG: [string, string, string] = ['#101E33', '#1A2C48', '#12223A']

type Theme = { name: string; a: string; b: string; c: string; bg: [string, string, string] }
const THEMES: Record<string, Theme> = {
  neon: { name: 'ネオン', a: '#FF4FA0', b: '#2EE6FF', c: '#7CFF6B', bg: ['#101E33', '#1A2C48', '#12223A'] },
  sunset: { name: '夕焼け', a: '#FF6B3D', b: '#FF9E5E', c: '#FF9EC4', bg: ['#2A1533', '#4A2040', '#2E1830'] },
  deep: { name: '深海', a: '#4D7CFF', b: '#3DF5D0', c: '#B7F7FF', bg: ['#06142B', '#0B2646', '#081A33'] },
  ice: { name: '氷', a: '#8AB8FF', b: '#E6F6FF', c: '#9FF5E1', bg: ['#0E1E36', '#1B3558', '#12263F'] },
  sakura: { name: '桜', a: '#FF8FB8', b: '#FFD1E3', c: '#B6F0C2', bg: ['#2B1826', '#472238', '#301A2A'] },
  wakaba: { name: '若葉', a: '#39FF88', b: '#B6FF5C', c: '#E6FFD0', bg: ['#07190F', '#0E2E1B', '#0A2014'] },
  grape: { name: 'ぶどう', a: '#B26BFF', b: '#FF7AF0', c: '#8CF3FF', bg: ['#170F33', '#2A1B55', '#1B1240'] },
}
const THEME_IDS = Object.keys(THEMES)

function applyTheme(id: string) {
  const t = THEMES[id] ?? THEMES.neon
  if (!t) return
  PINK = t.a
  CYAN = t.b
  LIME = t.c
  BG = t.bg
}
const RED = '#FF4D5E'
const FONT = 'Hiragino Sans, Noto Sans JP, sans-serif'
const NUM = 'Avenir Next Condensed, DIN Condensed, Helvetica Neue, Hiragino Sans, sans-serif'
const INK = '#0E1A2B'
const isAscii = (s: string) => /^[\x20-\x7E×]*$/.test(s)

const BONUS = [100, 100, 150, 150, 200, 300]

const QUESTS: Record<QuestId, { text: string; goal: number }> = {
  nomiss: { text: 'エラーなしで作業を終える（道具3回以上）', goal: 2 },
  cache: { text: '60分以内に続きを頼む（キャッシュを切らさない）', goal: 3 },
  fever: { text: 'コンボ10で FEVER に入る', goal: 1 },
  detail: { text: '40文字以上で具体的に頼む', goal: 3 },
  finish: { text: '作業を5回終える', goal: 5 },
}
const QUEST_IDS = Object.keys(QUESTS) as QuestId[]
const QUEST_XP = 80

function pickQuests(day: string): QuestId[] {
  let h = 7
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) % 100003
  const pool = [...QUEST_IDS]
  const out: QuestId[] = []
  while (out.length < 3 && pool.length > 0) {
    h = (h * 1103 + 12345) % 100003
    out.push(pool.splice(h % pool.length, 1)[0] as QuestId)
  }
  return out
}

function questDone(q: Quests, id: QuestId): boolean {
  return (q.prog[id] ?? 0) >= QUESTS[id].goal
}
// ---------- 背景 ----------

const HORIZON = 1020

function grid(dur: string): string {
  const v: string[] = []
  for (let i = -20; i <= 20; i++) {
    v.push(`<path d="M${W / 2} ${HORIZON} L${W / 2 + i * 300} ${H}" stroke="${CYAN}" stroke-width="2" opacity="0.38"/>`)
  }
  const hz: string[] = []
  for (let i = 0; i < 7; i++) {
    const y = HORIZON + i * 84
    hz.push(`<path d="M0 ${y} H${W}" stroke="${CYAN}" stroke-width="2" opacity="0.38"><animate attributeName="d" values="M0 ${y} H${W};M0 ${y + 84} H${W}" dur="${dur}" repeatCount="indefinite"/></path>`)
  }
  return v.join('') + hz.join('')
}

function confetti(delay = 0): string {
  const cs = [PINK, CYAN, LIME, '#FFFFFF']
  const out: string[] = []
  for (let i = 0; i < 90; i++) {
    const x = (i * 283) % W
    const d = 1.6 + ((i * 37) % 20) / 10
    const r = (i * 47) % 360
    out.push(`<rect x="${x}" y="-60" width="22" height="40" fill="${cs[i % 4]}" transform="rotate(${r} ${x} -60)"><animate attributeName="y" from="-60" to="${H + 60}" dur="${d}s" begin="${(delay + (i % 10) * 0.08).toFixed(2)}s" fill="freeze"/></rect>`)
  }
  return out.join('')
}

function rays(cx: number, cy: number, n: number, len: number, dur: string): string {
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = a0 + Math.PI / n
    parts.push(`<path d="M0 0 L${(Math.cos(a0) * len).toFixed(0)} ${(Math.sin(a0) * len).toFixed(0)} L${(Math.cos(a1) * len).toFixed(0)} ${(Math.sin(a1) * len).toFixed(0)} Z" fill="#FFFFFF" opacity="${i % 2 ? 0.1 : 0.2}"/>`)
  }
  return `<g transform="translate(${cx} ${cy})"><g>${parts.join('')}<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${dur}" repeatCount="indefinite"/></g></g>`
}

function big(text: string, color: string, y: number, size: number, blink = false): string {
  const anim = blink
    ? `<animate attributeName="opacity" values="1;0.25;1" dur="0.9s" repeatCount="indefinite"/>`
    : `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.75;1" dur="3s" fill="freeze"/>`
  const ascii = isAscii(text)
  const want = ascii ? Math.round(size * 1.15) : size
  const fit = Math.min(want, Math.floor(1050 / (text.length * (ascii ? 0.5 : 1))))
  return `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${ascii ? NUM : FONT}" font-weight="800" font-size="${fit}" ${ascii ? 'letter-spacing="6"' : ''} fill="${color}" stroke="${INK}" stroke-width="10" paint-order="stroke" filter="url(#glow)">${text}${anim}</text>`
}

function typeFx(tick: number, n: number): string {
  const cs = [PINK, CYAN, LIME, '#FFFFFF']
  const sparks: string[] = []
  for (let i = 0; i < 26; i++) {
    const x = 300 + ((i * 523 + tick * 211) % (W - 600))
    const y = 200 + ((i * 337 + tick * 157) % (H - 400))
    sparks.push(`<g transform="translate(${x} ${y})"><path d="M0 -60 L14 -14 L60 0 L14 14 L0 60 L-14 14 L-60 0 L-14 -14 Z" fill="${cs[i % 4]}" filter="url(#glow)" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="0.8s" begin="${(i % 6) * 0.05}s" fill="freeze"/><animateTransform attributeName="transform" type="scale" values="0.2;1.4;0.6" dur="0.8s" begin="${(i % 6) * 0.05}s" fill="freeze"/></path></g>`)
  }
  const label = `<text x="${W / 2}" y="1360" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="150" fill="#FFFFFF" stroke="${INK}" stroke-width="10" paint-order="stroke" filter="url(#glow)" opacity="0">${n}文字<animate attributeName="opacity" values="0;1;0" dur="1.1s" fill="freeze"/></text>`
  return sparks.join('') + label
}

const SHOUTS = ['いけぇ！！', '発射！！', '頼んだ！！', 'いってこい！！', 'まかせた！！']
const MORE_SHOUTS = ['ぶちかませ！！', 'GO！！', 'よろしく！！', 'ドーン！！', 'やっちゃえ！！', '出撃！！']
let SHOUT_POOL: string[] = SHOUTS

function launchFx(tick: number): string {
  const cx = W / 2
  const cy = 640
  const cs = [PINK, CYAN, LIME, '#FFFFFF']
  const rings: string[] = []
  for (let i = 0; i < 5; i++) {
    rings.push(`<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${cs[i % 4]}" stroke-width="22" filter="url(#glow)"><animate attributeName="r" from="10" to="1800" dur="1.2s" begin="${i * 0.14}s" fill="freeze"/><animate attributeName="opacity" from="1" to="0" dur="1.2s" begin="${i * 0.14}s" fill="freeze"/></circle>`)
  }
  const lines: string[] = []
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2
    lines.push(`<path d="M${(cx + Math.cos(a) * 260).toFixed(0)} ${(cy + Math.sin(a) * 260).toFixed(0)} L${(cx + Math.cos(a) * 1900).toFixed(0)} ${(cy + Math.sin(a) * 1900).toFixed(0)}" stroke="${i % 2 ? CYAN : PINK}" stroke-width="12" opacity="0"><animate attributeName="opacity" values="0;1;0.5;0" keyTimes="0;0.15;0.6;1" dur="1.4s" fill="freeze"/></path>`)
  }
  const burst: string[] = []
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + (i % 3) * 0.05
    const r = 700 + ((i * 97) % 600)
    burst.push(`<circle cx="${cx}" cy="${cy}" r="${10 + (i % 3) * 5}" fill="${cs[i % 4]}"><animate attributeName="cx" from="${cx}" to="${(cx + Math.cos(a) * r).toFixed(0)}" dur="1s" begin="0.15s" fill="freeze"/><animate attributeName="cy" from="${cy}" to="${(cy + Math.sin(a) * r).toFixed(0)}" dur="1s" begin="0.15s" fill="freeze"/><animate attributeName="opacity" values="0;1;0" keyTimes="0;0.2;1" dur="1.15s" fill="freeze"/></circle>`)
  }
  const flash = `<rect width="${W}" height="${H}" fill="#FFFFFF" opacity="0"><animate attributeName="opacity" values="0.75;0" dur="0.5s" fill="freeze"/></rect>`
  const shout = SHOUT_POOL[tick % SHOUT_POOL.length] ?? 'いけぇ！！'
  const size = Math.min(240, Math.floor(1050 / shout.length))
  const text = `<g transform="translate(${cx} ${cy + 90})"><g><text x="0" y="0" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="${size}" fill="#FFFFFF" stroke="${PINK}" stroke-width="12" paint-order="stroke" filter="url(#glow)" opacity="0">${shout}<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.8;1" dur="2.6s" fill="freeze"/></text><animateTransform attributeName="transform" type="scale" values="2.6;0.92;1" keyTimes="0;0.7;1" dur="0.32s" fill="freeze"/></g></g>`
  return flash + lines.join('') + rings.join('') + burst.join('') + text
}

function feverSky(): string {
  const cs = [PINK, CYAN, LIME, '#FFFFFF']
  const stars: string[] = []
  for (let i = 0; i < 22; i++) {
    const x = 700 + ((i * 487) % 1500)
    const y = 160 + ((i * 331) % 800)
    stars.push(`<g transform="translate(${x} ${y})"><path d="M0 -44 L10 -10 L44 0 L10 10 L0 44 L-10 10 L-44 0 L-10 -10 Z" fill="${cs[i % 4]}" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="0.7s" begin="${((i * 7) % 10) / 10}s" repeatCount="indefinite"/></path></g>`)
  }
  return `<g opacity="0.5">${rays(W / 2, HORIZON, 18, 2400, '6s')}</g>${stars.join('')}`
}

type Chest = NonNullable<Loot['chest']>

function prizeArt(c: Loot['chest'], big: boolean): string {
  if (!c) return ''
  if (c.kind === 'theme') {
    const t = THEMES[c.id]
    if (!t) return ''
    return `<g transform="scale(${big ? 2.4 : 1})"><circle cx="0" cy="0" r="62" fill="${t.bg[1]}" stroke="#FFFFFF" stroke-width="5"/><circle cx="-22" cy="14" r="24" fill="${t.a}"/><circle cx="22" cy="14" r="24" fill="${t.b}"/><circle cx="0" cy="-22" r="24" fill="${t.c}"/></g>`
  }
  if (c.kind === 'shout') {
    return big
      ? `<text x="0" y="50" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="130" fill="#FFFFFF" stroke="${INK}" stroke-width="14" paint-order="stroke" filter="url(#glow)">${c.id}</text>`
      : `<path d="M-60 -52 H60 Q72 -52 72 -40 V20 Q72 32 60 32 H-10 L-36 58 V32 H-60 Q-72 32 -72 20 V-40 Q-72 -52 -60 -52 Z" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linejoin="round"/><text x="0" y="10" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="54" fill="#FFFFFF">！！</text>`
  }
  return `<text x="0" y="${big ? 50 : 22}" text-anchor="middle" font-family="${NUM}" font-weight="800" font-size="${big ? 200 : 60}" fill="${LIME}" stroke="${INK}" stroke-width="${big ? 14 : 0}" paint-order="stroke">+${c.bonus}</text>`
}

function prizeName(c: Loot['chest']): string {
  if (!c) return ''
  if (c.kind === 'theme') return `背景の色「${THEMES[c.id]?.name ?? ''}」`
  if (c.kind === 'shout') return `発射の一言「${c.id}」`
  return `ボーナス経験値  +${c.bonus} XP`
}

function prizeNote(c: Loot['chest']): string {
  if (!c) return ''
  if (c.kind === 'theme') return '背景がこの色に変わります。/loot-color で切り替えられます'
  if (c.kind === 'shout') return '送信のときに出る一言が増えました'
  return '色と一言は全部集めました'
}

function chestFx(c: Loot['chest']): string {
  const cx = W / 2
  const th = c?.kind === 'theme' ? THEMES[c.id] : undefined
  const color = th ? th.a : LIME
  const OPEN = 1.2
  const GET = 2.6
  const fade = (begin: number, body: string) => `<g opacity="0">${body}<animate attributeName="opacity" from="0" to="1" begin="${begin}s" dur="0.2s" fill="freeze"/></g>`
  const box = `<g><animateTransform attributeName="transform" type="rotate" values="0 ${cx} 1020;-5 ${cx} 1020;5 ${cx} 1020;-6 ${cx} 1020;6 ${cx} 1020;0 ${cx} 1020" dur="${OPEN}s" fill="freeze"/>
<g><path d="M${cx - 270} 900 L${cx - 270} 850 Q${cx - 270} 780 ${cx - 200} 780 L${cx + 200} 780 Q${cx + 270} 780 ${cx + 270} 850 L${cx + 270} 900 Z" fill="#1B2F52" stroke="${CYAN}" stroke-width="10" stroke-linejoin="round" filter="url(#glow)"/><path d="M${cx - 60} 780 V900 M${cx + 60} 780 V900" stroke="${CYAN}" stroke-width="8"/><animateTransform attributeName="transform" type="translate" values="0 0;0 -70" begin="${OPEN}s" dur="0.3s" fill="freeze"/><animate attributeName="opacity" values="1;0.3" begin="${OPEN}s" dur="0.3s" fill="freeze"/></g>
<rect x="${cx - 270}" y="900" width="540" height="240" rx="26" fill="#14264A" stroke="${CYAN}" stroke-width="10" filter="url(#glow)"/>
<path d="M${cx - 60} 900 V1140 M${cx + 60} 900 V1140" stroke="${CYAN}" stroke-width="8"/>
<rect x="${cx - 46}" y="930" width="92" height="92" rx="16" fill="${INK}" stroke="${PINK}" stroke-width="8"/><circle cx="${cx}" cy="976" r="14" fill="${PINK}"/></g>`
  const beam = fade(OPEN, `<path d="M${cx - 240} 900 L${cx - 520} 120 L${cx + 520} 120 L${cx + 240} 900 Z" fill="#FFFFFF" opacity="0.2"/><path d="M${cx - 150} 900 L${cx - 260} 120 L${cx + 260} 120 L${cx + 150} 900 Z" fill="${color}" opacity="0.25"/>`)
  const spin = fade(OPEN, rays(cx, 620, 24, 1700, '5s'))
  const flash = `<rect width="${W}" height="${H}" fill="#FFFFFF" opacity="0"><animate attributeName="opacity" values="0;0.8;0" begin="${OPEN}s" dur="0.5s" fill="freeze"/></rect>`
  const prize = `<g transform="translate(${cx} 900)"><g opacity="0">${prizeArt(c, true)}<animate attributeName="opacity" from="0" to="1" begin="${OPEN + 0.3}s" dur="0.2s" fill="freeze"/><animateTransform attributeName="transform" type="translate" values="0 0;0 -220" begin="${OPEN + 0.3}s" dur="${(GET - OPEN - 0.3).toFixed(1)}s" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1" fill="freeze"/></g></g>`
  const title = `<text x="${cx}" y="430" text-anchor="middle" font-family="${NUM}" font-weight="800" font-size="180" letter-spacing="6" fill="#FFFFFF" stroke="${INK}" stroke-width="10" paint-order="stroke" filter="url(#glow)">TREASURE!<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.85;1" dur="${GET}s" fill="freeze"/></text>`
  const get = fade(GET, `<text x="${cx}" y="430" text-anchor="middle" font-family="${NUM}" font-weight="800" font-size="190" letter-spacing="8" fill="#FFFFFF" stroke="${PINK}" stroke-width="12" paint-order="stroke" filter="url(#glow)">GET!</text>`)
  const name = fade(GET + 0.2, `<text x="${cx}" y="1270" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="90" fill="${color}" stroke="${INK}" stroke-width="12" paint-order="stroke">${prizeName(c)}</text>`)
  return `<g transform="translate(0 -200)">${spin}${beam}${box}${prize}${title}${get}${name}</g>` + flash + confetti(GET)
}

function scene(d: Dopa, l: Loot): string {
  applyTheme(l.theme)
  SHOUT_POOL = [...SHOUTS, ...l.shouts]
  const into = d.xp % PER_LEVEL
  const barW = Math.max(22, Math.round((into / PER_LEVEL) * 620))
  const fever = d.combo >= FEVER_AT && d.mode !== 'idle'
  const beat = fever ? '0.5s' : '1.4s'
  const pulse = d.mode === 'working' ? `<animate attributeName="r" values="440;580;440" dur="${beat}" repeatCount="indefinite"/>` : ''
  const LX = 120
  const label = (y: number, s: string, c: string) => `<text x="${LX + 4}" y="${y}" font-family="${NUM}" font-weight="700" font-size="34" letter-spacing="8" fill="${c}">${s}</text>`
  const combo = d.combo >= 2
    ? `${label(560, 'COMBO', CYAN)}<text x="${LX - 6}" y="${760}" font-family="${NUM}" font-weight="800" font-size="${Math.min(280, 190 + d.combo * 6)}" fill="${PINK}" stroke="${INK}" stroke-width="10" paint-order="stroke" filter="url(#glow)">×${d.combo}</text>`
    : ''
  const feverFx = fever
    ? `<rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="${PINK}" stroke-width="20" filter="url(#glow)"><animate attributeName="stroke" values="${PINK};${CYAN};${LIME};${PINK}" dur="0.9s" repeatCount="indefinite"/></rect><g><rect x="${LX}" y="800" width="360" height="64" rx="12" fill="${LIME}"/><text x="${LX + 180}" y="846" text-anchor="middle" font-family="${NUM}" font-weight="800" font-size="46" letter-spacing="4" fill="${INK}">FEVER  XP×2</text><animate attributeName="opacity" values="1;0.55;1" dur="0.5s" repeatCount="indefinite"/></g>`
    : ''
  const gain = d.gain > 0
    ? `<text x="${LX + 640}" y="300" text-anchor="end" font-family="${NUM}" font-weight="800" font-size="76" fill="${LIME}" stroke="${INK}" stroke-width="8" paint-order="stroke">+${d.gain} XP<animate attributeName="y" from="300" to="220" dur="1.2s" fill="freeze"/><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.6;1" dur="1.2s" fill="freeze"/></text>`
    : ''
  let fx = ''
  if (d.fx === 'launch') fx = launchFx(d.tick)
  if (d.fx === 'type') fx = typeFx(d.tick, d.typing)
  if (d.fx === 'clear') fx = confetti() + big('CLEAR!', PINK, 820, 300)
  if (d.fx === 'levelup') fx = confetti() + big(`LEVEL UP!  Lv.${d.level}`, LIME, 820, 220)
  if (d.fx === 'daily') fx = confetti() + big(`デイリーボーナス  ${d.streak}日連続`, LIME, 820, 150)
  if (d.fx === 'quest') fx = confetti() + big('QUEST CLEAR!', LIME, 820, 240)
  if (d.fx === 'crit') fx = `<rect width="${W}" height="${H}" fill="#FFFFFF" opacity="0"><animate attributeName="opacity" values="0.6;0" dur="0.4s" fill="freeze"/></rect>` + rays(W / 2, 800, 30, 1900, '2s') + big('CRITICAL!!  XP×3', '#FFFFFF', 840, 180)
  if (d.fx === 'chest') fx = chestFx(l.chest)
  if (d.fx === 'miss') fx = `<rect width="${W}" height="${H}" fill="${RED}" opacity="0"><animate attributeName="opacity" values="0.45;0" dur="0.8s" fill="freeze"/></rect>` + big('MISS', RED, 820, 280)
  const yourTurn = d.mode === 'waiting' ? big('YOUR TURN!', CYAN, 1320, 200, true) : ''

  const streak = d.streak > 0
    ? `<rect x="${LX + 470}" y="372" width="150" height="44" rx="22" fill="none" stroke="${LIME}" stroke-width="3"/><text x="${LX + 545}" y="404" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="26" fill="${LIME}">連続 ${d.streak}日</text>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG[0]}"/><stop offset="0.62" stop-color="${BG[1]}"/><stop offset="1" stop-color="${BG[2]}"/></linearGradient>
<linearGradient id="xp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${CYAN}"/><stop offset="1" stop-color="#8CF3FF"/></linearGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="120"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<circle cx="260" cy="1500" r="460" fill="${fever ? LIME : PINK}" opacity="0.55" filter="url(#soft)">${pulse}</circle>
<circle cx="2300" cy="200" r="460" fill="${fever ? PINK : CYAN}" opacity="0.45" filter="url(#soft)">${pulse}</circle>
<path d="M0 ${HORIZON} H${W}" stroke="${PINK}" stroke-width="4" opacity="0.9" filter="url(#glow)"/>
${grid(beat)}
${fever ? feverSky() : ''}
${label(150, 'LEVEL', CYAN)}
<text x="${LX - 6}" y="320" font-family="${NUM}" font-weight="800" font-size="210" fill="#FFFFFF" stroke="${INK}" stroke-width="10" paint-order="stroke">${d.level}</text>
<rect x="${LX}" y="340" width="620" height="22" rx="11" fill="#FFFFFF" opacity="0.16"/>
<rect x="${LX}" y="340" width="${barW}" height="22" rx="11" fill="url(#xp)"/>
<text x="${LX + 4}" y="404" font-family="${NUM}" font-weight="700" font-size="34" fill="#E6F6FF">${into} / ${PER_LEVEL} XP</text>
${streak}${combo}${feverFx}${gain}${fx}${yourTurn}
</svg>`
}

function lootCard(l: Loot, d: Dopa, q: Quests, spin: boolean): string {
  const CW = 680
  applyTheme(l.theme)
  const CH = 966
  const c = l.chest
  const n = 16
  const STEP = 200
  const end = -(n - 1) * STEP
  const mk = (kind: Chest['kind'], id: string, bonus = 0): Chest => ({ kind, id, bonus, seq: 0, why: '', at: 0 })
  const pool: Chest[] = [...THEME_IDS.filter(id => id !== 'neon').map(id => mk('theme', id)), ...MORE_SHOUTS.slice(0, 3).map(id => mk('shout', id)), mk('xp', '', 200)]
  const strip: string[] = []
  for (let i = 0; i < n; i++) {
    const p = i === n - 1 && c ? c : pool[(i * 3 + (c?.seq ?? 0)) % pool.length]
    strip.push(`<g transform="translate(340 ${250 + i * STEP})">${prizeArt(p ?? null, false)}</g>`)
  }
  const show = (body: string) => spin
    ? `<g opacity="0">${body}<animate attributeName="opacity" from="0" to="1" begin="2.7s" dur="0.2s" fill="freeze"/></g>`
    : body
  const stripMove = spin
    ? `<animateTransform attributeName="transform" type="translate" from="0 0" to="0 ${end}" dur="2.6s" calcMode="spline" keyTimes="0;1" keySplines="0.12 0.75 0.2 1" fill="freeze"/>`
    : ''
  const top = c
    ? `<text x="${CW / 2}" y="54" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="24" fill="#CFE9F5">${c.why}</text>
${show(`<text x="${CW / 2}" y="128" text-anchor="middle" font-family="${NUM}" font-weight="800" font-size="72" letter-spacing="4" fill="#FFFFFF" stroke="${PINK}" stroke-width="6" paint-order="stroke" filter="url(#g)">GET!</text>`)}
<g clip-path="url(#win)"><rect x="240" y="150" width="200" height="200" fill="#16243A"/><g ${spin ? '' : `transform="translate(0 ${end})"`}>${strip.join('')}${stripMove}</g></g>
<rect x="240" y="150" width="200" height="200" rx="22" fill="none" stroke="${LIME}" stroke-width="8" filter="url(#g)"/>
${spin ? `<rect width="${CW}" height="${CH}" fill="#FFFFFF" opacity="0"><animate attributeName="opacity" values="0;0.8;0" begin="2.6s" dur="0.6s" fill="freeze"/></rect>` : ''}
${show(`<text x="${CW / 2}" y="424" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="38" fill="${LIME}" filter="url(#g)">${prizeName(c)}</text><text x="${CW / 2}" y="474" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="20" fill="#E6F6FF">${prizeNote(c)}</text>`)}`
    : `<rect x="240" y="150" width="200" height="200" rx="22" fill="#16243A" stroke="#4A5D7A" stroke-width="4"/><text x="${CW / 2}" y="285" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="110" fill="#4A5D7A">?</text><text x="${CW / 2}" y="420" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="24" fill="#CFE9F5">まだ宝箱を開けていません</text>`

  const chips = THEME_IDS.map((id, i) => {
    const t = THEMES[id]
    if (!t) return ''
    const x = 64 + i * 92
    const has = l.themes.includes(id)
    const on = l.theme === id
    return has
      ? `<circle cx="${x}" cy="632" r="${on ? 30 : 24}" fill="${t.bg[1]}" stroke="${on ? '#FFFFFF' : t.b}" stroke-width="${on ? 5 : 3}"/><circle cx="${x - 9}" cy="637" r="9" fill="${t.a}"/><circle cx="${x + 9}" cy="637" r="9" fill="${t.b}"/><circle cx="${x}" cy="622" r="9" fill="${t.c}"/><text x="${x}" y="686" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="15" fill="${on ? '#FFFFFF' : '#CFE9F5'}">${t.name}</text>`
      : `<circle cx="${x}" cy="632" r="24" fill="none" stroke="#4A5D7A" stroke-width="3" stroke-dasharray="6 6"/><text x="${x}" y="640" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="22" fill="#4A5D7A">?</text>`
  }).join('')
  const cleared = q.list.filter(id => questDone(q, id)).length
  const questRows = q.list.map((id, i) => {
    const y = 852 + i * 42
    const n = Math.min(q.prog[id] ?? 0, QUESTS[id].goal)
    const ok = questDone(q, id)
    return `<circle cx="44" cy="${y - 6}" r="11" fill="${ok ? LIME : 'none'}" stroke="${ok ? LIME : '#6C82A6'}" stroke-width="3"/>${ok ? `<path d="M38 ${y - 6} l5 5 l8 -10" fill="none" stroke="#0E1A2B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}<text x="68" y="${y}" font-family="${FONT}" font-weight="700" font-size="18" fill="${ok ? '#8FA3C0' : '#FFFFFF'}">${QUESTS[id].text}</text><text x="${CW - 30}" y="${y}" text-anchor="end" font-family="${NUM}" font-weight="700" font-size="22" fill="${ok ? LIME : CYAN}">${n} / ${QUESTS[id].goal}</text>`
  }).join('')
  const into = d.xp % PER_LEVEL
  const left = PER_LEVEL - into
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" overflow="hidden">
<defs>
<linearGradient id="cbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14264A"/><stop offset="1" stop-color="#0E1A2B"/></linearGradient>
<filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="blob" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="70"/></filter>
<clipPath id="card"><rect width="${CW}" height="${CH}" rx="24"/></clipPath>
<clipPath id="stage"><rect width="${CW}" height="530"/></clipPath>
<clipPath id="win"><rect x="240" y="150" width="200" height="200" rx="22"/></clipPath>
</defs>
<g clip-path="url(#card)">
<rect width="${CW}" height="${CH}" fill="url(#cbg)"/>
<g clip-path="url(#stage)"><circle cx="90" cy="470" r="170" fill="${PINK}" opacity="0.45" filter="url(#blob)"/><circle cx="600" cy="70" r="170" fill="${CYAN}" opacity="0.4" filter="url(#blob)"/>${c ? rays(CW / 2, 250, 20, 700, '6s') : ''}</g>
${top}
<path d="M30 540 H${CW - 30}" stroke="#2C4266" stroke-width="2"/>
<text x="30" y="586" font-family="${FONT}" font-weight="900" font-size="24" fill="#FFFFFF">集めた色と一言</text>
<text x="${CW - 30}" y="586" text-anchor="end" font-family="${FONT}" font-weight="700" font-size="18" fill="#CFE9F5">色 ${l.themes.length} / ${THEME_IDS.length}　一言 ${SHOUTS.length + l.shouts.length} / ${SHOUTS.length + MORE_SHOUTS.length}</text>
${chips}
<g transform="translate(0 -84)">
<text x="30" y="812" font-family="${FONT}" font-weight="900" font-size="24" fill="#FFFFFF">今日のクエスト</text>
<text x="${CW - 30}" y="812" text-anchor="end" font-family="${FONT}" font-weight="700" font-size="18" fill="#CFE9F5">${cleared} / ${q.list.length} 達成　1つ +${QUEST_XP} XP、全部で宝箱</text>
${questRows}
<text x="30" y="996" font-family="${FONT}" font-weight="700" font-size="20" fill="#CFE9F5">次の宝箱（Lv.${d.level + 1}）まで あと ${left} XP</text>
<rect x="30" y="1010" width="620" height="22" rx="11" fill="#FFFFFF" opacity="0.14"/>
<rect x="30" y="1010" width="${Math.round((into / PER_LEVEL) * 620)}" height="22" rx="11" fill="${CYAN}" filter="url(#g)"/>
${d.streak > 0 ? `<text x="${CW - 30}" y="996" text-anchor="end" font-family="${FONT}" font-weight="700" font-size="20" fill="${LIME}">連続 ${d.streak}日</text>` : ''}
</g>
</g>
</svg>`
}

// ---------- しくみ ----------

function patchDopa($: EngineInterface, f: (d: Dopa) => Partial<Dopa>) {
  return update($, dopa, d => ({ ...d, ...f(d) }))
}

function patchLoot($: EngineInterface, f: (l: Loot) => Partial<Loot>) {
  return update($, loot, l => ({ ...l, ...f(l) }))
}

function nowJst(ms: number) {
  const d = new Date(ms + 9 * 3600000)
  return { day: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }
}

async function openChest($: EngineInterface, why: string) {
  const l = await read($, loot)
  const pool: { kind: 'theme' | 'shout'; id: string }[] = [
    ...THEME_IDS.filter(id => !l.themes.includes(id)).map(id => ({ kind: 'theme' as const, id })),
    ...MORE_SHOUTS.filter(id => !l.shouts.includes(id)).map(id => ({ kind: 'shout' as const, id })),
  ]
  const pick = pool.length > 0 ? (pool[Math.floor(Math.random() * pool.length)] ?? null) : null
  const bonus = pick ? 0 : (BONUS[Math.floor(Math.random() * BONUS.length)] ?? 100)
  const now = await $.clock.now()
  const themes = pick?.kind === 'theme' ? [...l.themes, pick.id] : l.themes
  const shouts = pick?.kind === 'shout' ? [...l.shouts, pick.id] : l.shouts
  const chest = { kind: pick?.kind ?? ('xp' as const), id: pick?.id ?? '', bonus, seq: (l.chest?.seq ?? 0) + 1, why, at: now }
  await patchLoot($, () => ({ themes, shouts, chest }))
  await $.store.set('themes', themes)
  await $.store.set('shouts', shouts)
  await patchDopa($, d => ({ fx: 'chest', tick: d.tick + 1 }))
  $.clock.after(5600, () => {
    void (async () => {
      if (pick?.kind === 'theme') {
        await patchLoot($, () => ({ theme: pick.id }))
        await $.store.set('theme', pick.id)
      }
      await patchDopa($, d => (d.fx === 'chest' ? { fx: 'none', tick: d.tick + 1 } : {}))
      if (!pick) await gainXp($, bonus, 'none', false)
    })()
  })
  void $.audio.play({ asset: 'sounds/chest.wav' }).catch(() => undefined)
  $.ui.toast(`宝箱：${prizeName(chest)}`)
  void $.ui.open({ id: PANE, title: '宝箱とクエスト', backgroundColor: PANE_BG })
}

async function gainXp($: EngineInterface, amount: number, fx: Fx, canChest = true) {
  const before = await read($, dopa)
  const xp = before.xp + amount
  const level = 1 + Math.floor(xp / PER_LEVEL)
  const leveled = level > before.level
  const first: Fx = leveled && fx === 'none' ? 'levelup' : fx
  await patchDopa($, d => ({ xp, level: leveled && first !== 'levelup' ? d.level : level, gain: amount, fx: first, tick: d.tick + 1 }))
  await $.store.set('xp', xp)
  const wait = leveled && first !== 'levelup' ? 1300 : 0
  if (wait > 0) {
    $.clock.after(wait, () => { void patchDopa($, d => ({ level, gain: 0, fx: 'levelup', tick: d.tick + 1 })) })
  }
  if (first !== 'none' || leveled) {
    const last: Fx = leveled ? 'levelup' : first
    $.clock.after(wait + 3400, () => { void patchDopa($, d => (d.fx === last ? { fx: 'none', gain: 0, tick: d.tick + 1 } : {})) })
  }
  if (leveled && canChest) {
    $.clock.after(wait + 1500, () => { void openChest($, `レベル${level}になった`) })
  }
}

async function ensureQuests($: EngineInterface, day: string) {
  const cur = await read($, quests)
  if (cur.day === day) return
  const saved = (await $.store.get('quests')) as Quests | undefined
  const next: Quests = saved && saved.day === day ? saved : { day, list: pickQuests(day), prog: {}, bonus: false }
  await update($, quests, () => next)
  await $.store.set('quests', next)
}

async function questProgress($: EngineInterface, id: QuestId) {
  const q = await read($, quests)
  if (!q.list.includes(id) || questDone(q, id)) return
  const next: Quests = { ...q, prog: { ...q.prog, [id]: (q.prog[id] ?? 0) + 1 } }
  const all = next.list.every(x => questDone(next, x))
  if (all) next.bonus = true
  await update($, quests, () => next)
  await $.store.set('quests', next)
  if (!questDone(next, id)) return
  $.ui.toast(`クエスト達成：${QUESTS[id].text}　+${QUEST_XP} XP`)
  await gainXp($, QUEST_XP, 'quest')
  $.clock.after(4000, () => { void patchDopa($, d => (d.fx === 'quest' ? { fx: 'none', tick: d.tick + 1 } : {})) })
  if (all && !q.bonus) {
    $.clock.after(2500, () => { void openChest($, '今日のクエストを全部達成') })
  }
}

export const register: Register = on => {
  let turnStart = 0
  let tools = 0
  let errors = 0
  let typed = 0
  let lastTypeFx = 0

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const xp = Number((await $.store.get('xp')) ?? 0)
    const streak = Number((await $.store.get('streak')) ?? 0)
    await patchDopa($, () => ({ xp, level: 1 + Math.floor(xp / PER_LEVEL), streak }))
    const savedThemes = (await $.store.get('themes')) as string[] | undefined
    const themes = Array.isArray(savedThemes) && savedThemes.length > 0 ? savedThemes.filter(id => id in THEMES) : ['neon']
    const savedTheme = String((await $.store.get('theme')) ?? 'neon')
    const savedShouts = (await $.store.get('shouts')) as string[] | undefined
    await patchLoot($, () => ({ themes, theme: themes.includes(savedTheme) ? savedTheme : 'neon', shouts: Array.isArray(savedShouts) ? savedShouts : [] }))
    await ensureQuests($, nowJst(await $.clock.now()).day)
    await $.theme.set({ backdrop: { scene: 'dopa', glass: { blur: 4, tint: '#0E1A2B', opacity: 0.3 } } })
    await $.command.register({ name: 'loot', description: '宝箱と今日のクエストを見る' })
    await $.command.register({ name: 'loot-chest', description: '試しに宝箱を1つ開ける' })
    await $.command.register({ name: 'loot-color', description: '背景の色を、集めた色の中で次に切り替える' })
    if (!(await $.store.get('starter'))) {
      await $.store.set('starter', true)
      $.clock.after(2000, () => { void openChest($, 'はじめの宝箱') })
    }
    return r
  })

  on('command.run', { command: 'loot' }, async $ => {
    await $.ui.open({ id: PANE, title: '宝箱とクエスト', backgroundColor: PANE_BG })
    const q = await read($, quests)
    const lines = q.list.map(id => `${questDone(q, id) ? '済' : '未'}　${QUESTS[id].text}（${Math.min(q.prog[id] ?? 0, QUESTS[id].goal)}/${QUESTS[id].goal}）`)
    const l = await read($, loot)
    const got = `集めた色：${l.themes.map(id => THEMES[id]?.name ?? id).join('、')}（${l.themes.length}/${THEME_IDS.length}）　一言：${SHOUTS.length + l.shouts.length}/${SHOUTS.length + MORE_SHOUTS.length}`
    return { text: [got, '今日のクエスト', ...lines].join('\n') }
  })

  on('command.run', { command: 'loot-color' }, async $ => {
    const l = await read($, loot)
    const i = l.themes.indexOf(l.theme)
    const nextId = l.themes[(i + 1) % l.themes.length] ?? 'neon'
    await patchLoot($, () => ({ theme: nextId }))
    await $.store.set('theme', nextId)
    await patchDopa($, d => ({ tick: d.tick + 1 }))
    return { text: l.themes.length > 1 ? `背景の色を「${THEMES[nextId]?.name ?? nextId}」にしました。` : '色はまだ「ネオン」だけです。宝箱から新しい色が出ます。' }
  })

  on('command.run', { command: 'loot-chest' }, async $ => {
    await openChest($, '試しの宝箱')
    return { text: '宝箱を開けました。' }
  })

  on('prompt.submit', async ($, e, next) => {
    turnStart = await $.clock.now()
    tools = 0
    errors = 0
    typed = 0
    await patchDopa($, d => ({ mode: 'working', combo: 0, gain: 0, fx: 'launch', tick: d.tick + 1 }))
    $.clock.after(3000, () => { void patchDopa($, d => (d.fx === 'launch' ? { fx: 'none', tick: d.tick + 1 } : {})) })
    const today = nowJst(turnStart).day
    await ensureQuests($, today)
    const rawLen = String(e.text ?? '').replace(/<[^>]+>/g, ' ').trim().length
    const before = await read($, loot)
    const inCache = before.lastDone !== null && turnStart - before.lastDone < CACHE_MIN * 60000
    $.clock.after(2800, () => {
      void (async () => {
        if (inCache) await questProgress($, 'cache')
        if (rawLen >= 40) await questProgress($, 'detail')
      })()
    })
    const lastDay = String((await $.store.get('lastDay')) ?? '')
    if (lastDay !== today) {
      const was = Number((await $.store.get('streak')) ?? 0)
      const streak = lastDay === nowJst(turnStart - 86400000).day ? was + 1 : 1
      await $.store.set('lastDay', today)
      await $.store.set('streak', streak)
      const bonus = 50 * Math.min(streak, 7)
      $.clock.after(2700, () => {
        void patchDopa($, () => ({ streak })).then(() => gainXp($, bonus, 'daily'))
        $.ui.toast(`デイリーボーナス +${bonus} XP（${streak}日連続）`)
      })
    }
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    const added = e.inputText.length - (e.end - e.start)
    if (added > 0 && added < 40) {
      typed += added
      const now = await $.clock.now()
      if (typed >= 10 && now - lastTypeFx > 900) {
        lastTypeFx = now
        await patchDopa($, d => ({ typing: typed, fx: d.fx === 'none' || d.fx === 'type' ? 'type' : d.fx, tick: d.tick + 1 }))
        $.clock.after(1200, () => { void patchDopa($, d => (d.fx === 'type' ? { fx: 'none', tick: d.tick + 1 } : {})) })
      }
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion') {
      await patchDopa($, d => ({ mode: 'waiting', fx: 'none', tick: d.tick + 1 }))
      const r = await next(e)
      await patchDopa($, d => ({ mode: 'working', tick: d.tick + 1 }))
      return r
    }

    const r = await next(e)
    tools++
    if ('isError' in r && r.isError) {
      errors++
      await patchDopa($, d => ({ combo: 0, gain: 0, fx: 'miss', tick: d.tick + 1 }))
      $.clock.after(2500, () => { void patchDopa($, d => (d.fx === 'miss' ? { fx: 'none', tick: d.tick + 1 } : {})) })
      return r
    }
    await patchDopa($, d => ({ combo: d.combo + 1 }))
    const d = await read($, dopa)
    const crit = Math.random() < 0.12
    const base = 10 + Math.min(d.combo, 20) * 2
    await gainXp($, base * (crit ? 3 : 1) * (d.combo >= FEVER_AT ? 2 : 1), crit ? 'crit' : 'none')
    if (d.combo === FEVER_AT) {
      $.ui.toast('FEVER！ コンボ10、経験値が2倍')
      await questProgress($, 'fever')
    }

    const lastDrop = Number((await $.store.get('lastDrop')) ?? 0)
    const now = await $.clock.now()
    if (Math.random() < 0.04 && now - lastDrop > 15 * 60000) {
      await $.store.set('lastDrop', now)
      $.clock.after(800, () => { void openChest($, '道の途中で宝箱を見つけた') })
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const sec = turnStart ? Math.round((now - turnStart) / 1000) : 0
    await patchDopa($, () => ({ mode: 'idle' }))
    await gainXp($, 50, 'clear')
    $.clock.after(6000, () => { void patchDopa($, d => (d.fx === 'clear' ? { fx: 'none', gain: 0, tick: d.tick + 1 } : {})) })
    const cleanRun = tools >= 3 && errors === 0
    $.clock.after(1800, () => {
      void (async () => {
        await questProgress($, 'finish')
        if (cleanRun) await questProgress($, 'nomiss')
      })()
    })

    const usage = await $.session.usage()
    const ctx = usage.context.percent ?? null
    await patchLoot($, () => ({ ctx, lastDone: now }))
    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== 'dopa-backdrop') return next(e)
    const els = $.ui.resolve(e)
    if (!('Svg' in els)) return next(e)
    const { Svg } = els
    return <Svg source={scene(await read($, dopa), await read($, loot))} alt="ネオンの背景。レベル、コンボ、宝箱" width={W} height={H} isInteractive={true} />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const d = await read($, dopa)
    applyTheme((await read($, loot)).theme)
    const into = d.xp % PER_LEVEL
    const bar = '■'.repeat(Math.round((into / PER_LEVEL) * 10)).padEnd(10, '□')
    const extra: string[] = []
    const q = await read($, quests)
    if (q.list.length > 0) extra.push(`クエスト ${q.list.filter(id => questDone(q, id)).length}/${q.list.length}`)
    return (
      <Box flexDirection="row" gap={2}>
        <Text bold color={PINK}>Lv.{d.level}</Text>
        <Text color={CYAN}>{bar}</Text>
        {extra.length > 0 && <Text color={LIME}>{extra.join('  ')}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Svg = 'Svg' in els ? els.Svg : null
    const l = await read($, loot)
    const d = await read($, dopa)
    const q = await read($, quests)
    const spin = l.chest !== null && (await $.clock.now()) - l.chest.at < 3500
    return (
      <Box flexDirection="column" gap={1}>
        {Svg && <Svg source={lootCard(l, d, q, spin)} alt="宝箱のルーレット、集めた色と一言、今日のクエスト" width={600} height={852} isInteractive={true} />}
        <Text dimColor>宝箱が出るとき：レベルアップ（300 XPごと）、作業中にたまに、今日のクエストを全部達成。中身は背景の色か、発射の一言。色の切り替えは /loot-color、試すなら /loot-chest</Text>
      </Box>
    )
  })
}
