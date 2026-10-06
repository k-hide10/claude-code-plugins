import { expect, test } from 'claude-code/testing'

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }

type Seen = { effort?: unknown; agentId?: unknown }

// 判定の呼び出し回数、記録に書いた中身、入力欄の下の表示を、試験から確かめるための入れ物
type Spy = { judgeCalls: number; prompts: string[]; writes: string[]; paths: string[]; statuses: (string | undefined)[] }

function spy(): Spy {
  return { judgeCalls: 0, prompts: [], writes: [], paths: [], statuses: [] }
}

type Reply = { isAnswered: boolean; text?: string }

// メインの会話のモデル。対象外のモデルの試験だけ差し替える
let MODEL = 'claude-opus-5-5'

// 設定（環境変数）の値。経路の試験だけ差し替える
let ENV: Record<string, string> = { HOME: '/home/tester' }

// 何も答えない層の代わりに、テストがエンジン側として答える
// reply に並びを渡すと、判定のたびに順に返す（最後のものを繰り返す）
function engine(on: any, seen: Seen[], replies: Reply | Reply[], s: Spy = spy()) {
  on('prompt.submit', (_$: unknown, e: any) => ({ text: e.text, context: e.context, origin: e.origin }))
  on('turn.start', (_$: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$: unknown, e: any) {
    seen.push({ effort: e.effort, agentId: e.agentId })
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: e.model } }
  })
  on('turn.complete', (_$: unknown, e: any) => ({ text: e.answer }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: '構成案を 2 つ出しました', toolUses: [] }] }))
  on('model.complete', (_$: unknown, e: any) => {
    s.judgeCalls++
    s.prompts.push(e.prompt)
    const reply = Array.isArray(replies) ? replies[Math.min(s.judgeCalls, replies.length) - 1] : replies
    return {
      value: reply.isAnswered
        ? { isAnswered: true, text: reply.text, usage: USAGE }
        : { isAnswered: false, reason: 'empty-reply', usage: USAGE },
    }
  })
  on('clock.now', () => ({ value: 1_000_000 }))
  on('session.model', () => ({ value: MODEL }))
  on('env.get', (_$: unknown, e: any) => ({ value: e.name in ENV ? ENV[e.name] : undefined }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', (_$: unknown, e: any) => {
    s.writes.push(e.text)
    s.paths.push(e.path)
    return { value: undefined }
  })
  on('ui.status', (_$: unknown, e: any) => {
    s.statuses.push(e.text)
    return { value: undefined }
  })
}

async function runTurn($: any, text: string, agentId?: string, submit: Record<string, unknown> = {}) {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...submit })
  await $.turn.start({ text, turnId: 't1' })
  const step = $.turn.step({
    turnId: 't1',
    index: 0,
    model: MODEL,
    effort: 'max',
    messageCount: 2,
    ...(agentId ? { agentId } : {}),
  })
  for await (const _chunk of step) {
    // 流れてくる応答はそのまま読み捨てる
  }
  await step.result
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
}

test('「じっくり」で始まる依頼は最大で送る', async ($, on) => {
  const seen: Seen[] = []
  engine(on, seen, { isAnswered: true, text: '簡単: 確認だけ' })
  await runTurn($, 'じっくり 設計を考えて')
  expect(seen[0].effort).toBe('max')
})

test('「さっと」で始まる依頼は中で送る', async ($, on) => {
  const seen: Seen[] = []
  engine(on, seen, { isAnswered: true, text: '難しい: 設計' })
  await runTurn($, 'さっと 誤字を直して')
  expect(seen[0].effort).toBe('medium')
})

test('Haiku が「簡単」と判定したら中で送る', async ($, on) => {
  const seen: Seen[] = []
  engine(on, seen, { isAnswered: true, text: '簡単: 誤字の修正' })
  await runTurn($, 'ここの誤字を直して')
  expect(seen[0].effort).toBe('medium')
})

test('Haiku が「普通」と判定したら高で送る', async ($, on) => {
  const seen: Seen[] = []
  engine(on, seen, { isAnswered: true, text: '普通: 文章の推敲' })
  await runTurn($, 'この文章を読みやすくして')
  expect(seen[0].effort).toBe('high')
})

test('判定できなかったら、いつもの深さのまま送る', async ($, on) => {
  const seen: Seen[] = []
  engine(on, seen, { isAnswered: false })
  await runTurn($, 'これお願い')
  expect(seen[0].effort).toBe('max')
})

test('サブエージェントのリクエストには触らない', async ($, on) => {
  const seen: Seen[] = []
  engine(on, seen, { isAnswered: true, text: '簡単: 確認だけ' })
  await runTurn($, 'ここの誤字を直して', 'agent-1')
  expect(seen[0].effort).toBe('max')
})

test('作業中のスピナーと返答の下に深さを出す（ターミナルとデスクトップ）', async ($: any, on: any) => {
  const seen: Seen[] = []
  engine(on, seen, { isAnswered: true, text: '簡単: 誤字の修正' })
  on('ui.render', (_$: unknown, e: any) => {
    const { Text } = _$ as any
    return { type: 'Text', props: {}, children: [e.props.suffix] }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  await $.prompt.submit({ text: 'ここの誤字を直して', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'x', turnId: 't1' })
  const spinner = await $.ui.render({ component: 'Spinner', surface: 'desktop', requestId: 's1', props: { word: '考え中', message: null, suffix: '', mode: 'thinking' } })
  expect(JSON.stringify(spinner)).toContain('考える深さ: 中（簡単）')
  const done = await $.turn.complete({ answer: 'ok', durationMs: 6000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(done.text).toBe('考える深さ: 中（簡単: 誤字の修正）・6秒')
})

test('デスクトップの返信（<!-- reply 1 --> つき）も判定する', async ($: any, on: any) => {
  const seen: Seen[] = []
  engine(on, seen, { isAnswered: true, text: '簡単: 確認の質問' })
  await runTurn($, '<!-- reply 1 -->\n> 見分け方\n\nこれどこ？')
  expect(seen[0].effort).toBe('medium')
})

test('スラッシュコマンドの記録は判定しない', async ($: any, on: any) => {
  const seen: Seen[] = []
  engine(on, seen, { isAnswered: true, text: '簡単: 確認だけ' })
  await runTurn($, '<command-name>/help</command-name>')
  expect(seen[0].effort).toBe('max')
})

test('ワークツリーで始めたセッションの最初の依頼（<system-reminder> つき）も判定する', async ($: any, on: any) => {
  const seen: Seen[] = []
  engine(on, seen, { isAnswered: true, text: '簡単: 確認の質問' })
  await runTurn($, '<system-reminder>\nYou are operating in a git worktree.\n</system-reminder>\n# 引き継ぎ: 表示を確かめて')
  expect(seen[0].effort).toBe('medium')
})

test('作業中に送った依頼は判定しない（動いているターンの深さは変えられないため）', async ($: any, on: any) => {
  const seen: Seen[] = []
  const s = spy()
  engine(on, seen, { isAnswered: true, text: '簡単: 確認の質問' }, s)
  await runTurn($, 'これ何？', undefined, { turnId: 't0' })
  expect(s.judgeCalls).toBe(0)
  // 送ったときに表示を書き換えない（終わったときの「…で回答」だけが出る）
  expect(s.statuses.some(text => text?.includes('判定'))).toBe(false)
  expect(seen[0].effort).toBe('max')
})

test('ほかのセッションからの連絡は判定しない', async ($: any, on: any) => {
  const seen: Seen[] = []
  const s = spy()
  engine(on, seen, { isAnswered: true, text: '簡単: 確認だけ' }, s)
  await runTurn($, '<cross-session-message from="local_1">進み具合を教えて</cross-session-message>', undefined, { origin: { kind: 'peer' } })
  expect(s.judgeCalls).toBe(0)
  expect(seen[0].effort).toBe('max')
})

test('「分類: 普通: …」のように見出しがついても読む', async ($: any, on: any) => {
  const seen: Seen[] = []
  engine(on, seen, { isAnswered: true, text: '分類: 普通: 文章の推敲' })
  await runTurn($, 'この文章を読みやすくして')
  expect(seen[0].effort).toBe('high')
})

test('1 回目に 3 語が無くても、聞き直して判定する', async ($: any, on: any) => {
  const seen: Seen[] = []
  const s = spy()
  engine(on, seen, [{ isAnswered: true, text: '分類: 確認の質問' }, { isAnswered: true, text: '簡単: 確認の質問' }], s)
  await runTurn($, '他のセッションでも使える？')
  expect(s.judgeCalls).toBe(2)
  expect(seen[0].effort).toBe('medium')
  expect(s.writes.at(-1) ?? '').toContain('"retried":true')
})

test('聞き直しても 3 語が無ければ、いつもの深さのまま', async ($: any, on: any) => {
  const seen: Seen[] = []
  const s = spy()
  engine(on, seen, { isAnswered: true, text: '分類: 確認の質問' }, s)
  await runTurn($, '他のセッションでも使える？')
  expect(s.judgeCalls).toBe(2)
  expect(seen[0].effort).toBe('max')
})

test('判定できなかった理由を記録に残し、表示は実際の深さ（最大）で出す', async ($: any, on: any) => {
  const seen: Seen[] = []
  const s = spy()
  engine(on, seen, { isAnswered: true, text: '分類: 確認の質問で実作業なし' }, s)
  await runTurn($, 'まず最大まで上げておく？')
  await runTurn($, 'もう一度：まず最大まで上げておく？')
  expect(seen[1].effort).toBe('max')
  const failLine = s.writes.at(-1) ?? ''
  expect(failLine).toContain('"source":"fail"')
  expect(failLine).toContain('"why":"no-match: 分類: 確認の質問で実作業なし"')
  // 1 回目のターンで実際の深さ（最大）が分かるので、2 回目は「最大のまま」と出す
  expect(s.statuses).toContain('考える深さ: 最大のまま（判定できず）')
  expect(s.statuses.at(-1)).toBe('考える深さ: 最大のまま・1秒で回答')
})

test('アプリの再開や「もう一度試す」は判定せず、直前の判定を使う', async ($: any, on: any) => {
  const seen: Seen[] = []
  const s = spy()
  engine(on, seen, { isAnswered: true, text: '簡単: 確認の質問' }, s)
  await runTurn($, 'これ合ってる？')
  await runTurn($, 'The app was quit while you were working. Please continue from where you left off.', undefined, { origin: { kind: 'sdk' } })
  await runTurn($, 'もう一度試す')
  expect(s.judgeCalls).toBe(1)
  expect(seen.map(x => x.effort)).toEqual(['medium', 'medium', 'medium'])
  expect(s.statuses).toContain('考える深さ: 中（簡単: 前の依頼の続き）')
})

test('長い依頼は、頭と終わりの両方を判定に渡す（貼り付けのあとの指示を落とさない）', async ($: any, on: any) => {
  const seen: Seen[] = []
  const s = spy()
  engine(on, seen, { isAnswered: true, text: '普通: 貼り付けた文の推敲' }, s)
  await runTurn($, `${'貼り付けた文章。'.repeat(400)}\n上の文章を読みやすくして`)
  expect(s.prompts.at(-1) ?? '').toContain('上の文章を読みやすくして')
  expect(s.prompts.at(-1) ?? '').toContain('（中略）')
})

test('対象外のモデルでは判定せず、深さも変えない', async ($: any, on: any) => {
  MODEL = 'claude-opus-4-8'
  try {
    const seen: Seen[] = []
    const s = spy()
    engine(on, seen, { isAnswered: true, text: '簡単: 誤字の修正' }, s)
    await runTurn($, 'ここの誤字を直して')
    expect(seen[0].effort).toBe('max')
    expect(s.judgeCalls).toBe(0)
    expect(s.statuses.some(t => String(t).includes('このモデルは対象外'))).toBe(true)
  } finally {
    MODEL = 'claude-opus-5-5'
  }
})

test('記録は使う人のホームに書く', async ($: any, on: any) => {
  const seen: Seen[] = []
  const s = spy()
  engine(on, seen, { isAnswered: true, text: '普通: 文章の推敲' }, s)
  await runTurn($, 'この文章を読みやすくして')
  expect(s.paths.some(p => p === '/home/tester/.claude/mod-data/effort-auto.jsonl')).toBe(true)
})

// Bedrock や Google Cloud などの経路を選ぶ設定が入っていると、判定も切り替えもしない
async function expectSkippedRoute($: any, on: any, flag: string, value: string) {
  ENV = { HOME: '/home/tester', [flag]: value }
  try {
    const seen: Seen[] = []
    const s = spy()
    engine(on, seen, { isAnswered: true, text: '簡単: 誤字の修正' }, s)
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_$: unknown, e: any) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await runTurn($, 'ここの誤字を直して')
    expect(s.judgeCalls).toBe(0)
    expect(seen[0].effort).toBe('max')
    expect(s.statuses.some(t => String(t).includes('この接続方法は対象外'))).toBe(true)
  } finally {
    ENV = { HOME: '/home/tester' }
  }
}

test('Bedrock 経由では判定も切り替えもしない', async ($: any, on: any) => {
  await expectSkippedRoute($, on, 'CLAUDE_CODE_USE_BEDROCK', '1')
})

test('Google Cloud 経由では判定も切り替えもしない', async ($: any, on: any) => {
  await expectSkippedRoute($, on, 'CLAUDE_CODE_USE_VERTEX', 'true')
})

test('Anthropic 以外のゲートウェイ経由では判定も切り替えもしない', async ($: any, on: any) => {
  await expectSkippedRoute($, on, 'ANTHROPIC_BASE_URL', 'https://gateway.example.com')
})

test('ふつうの接続（設定なし、または接続先が Anthropic）なら切り替える', async ($: any, on: any) => {
  ENV = { HOME: '/home/tester', ANTHROPIC_BASE_URL: 'https://api.anthropic.com', CLAUDE_CODE_USE_BEDROCK: '0' }
  try {
    const seen: Seen[] = []
    engine(on, seen, { isAnswered: true, text: '簡単: 誤字の修正' })
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_$: unknown, e: any) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await runTurn($, 'ここの誤字を直して')
    expect(seen[0].effort).toBe('medium')
  } finally {
    ENV = { HOME: '/home/tester' }
  }
})
