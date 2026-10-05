import type { EngineInterface, Register } from 'claude-code'

// 依頼の難しさと、そのときに使う考える深さ（effort）
type Level = '簡単' | '普通' | '難しい'
type Effort = 'medium' | 'high' | 'max'
type Decision = { level: Level; effort: Effort; reason: string; source: 'auto' | 'prefix' | 'continue'; prompt: string; origin?: string; retried?: boolean; judgeMs?: number; judgeTokens?: { input: number; output: number; cacheRead: number } }
type Step = { effort: Effort; cacheRead: number; cacheWrite: number; output: number }
// 判定しないときに使われる深さ（turn.step に届く、差し替える前の値）
type Usual = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number

const EFFORT: Record<Level, Effort> = { 簡単: 'medium', 普通: 'high', 難しい: 'max' }
const LABEL: Record<string, string> = { low: '低', medium: '中', high: '高', max: '最大' }

// 深さの表示名。まだ分からないときは「いつもの深さ」、名前を決めていないもの（xhigh や数値）はそのまま出す
function label(effort: Usual | undefined): string {
  return effort === undefined ? 'いつもの深さ' : (LABEL[String(effort)] ?? String(effort))
}

// 判定の記録はホームの ~/.claude/mod-data/ に置く（使う人ごとの場所。mod のフォルダの中だと再読み込みが起きる）
const LOG_FILE = '.claude/mod-data/effort-auto.jsonl'

// effort を変えてもキャッシュが残るモデル（公式 prompt-caching ドキュメント）。それ以外では深さを変えない
const CACHE_SAFE_MODEL = /(opus|sonnet)-5-5|fable-5-1/

// 人が打った依頼ではないもの（バックグラウンドの通知、ほかのセッションからの連絡、定期実行、観察役、mod）は判定しない
const SKIP_ORIGINS = new Set([
  'task-notification',
  'peer',
  'peer-send-message',
  'projects-relay',
  'coordinator',
  'scheduled-trigger',
  'auto-continuation',
  'observer',
  'observer-activity',
  'plugin',
])

// システムが送る形式の依頼（スラッシュコマンドの記録、通知、ほかのセッションからの連絡）は判定しない
const SYSTEM_TAG = /^<(command-|local-command|task-notification|system-reminder|bash-|cross-session-message)/

// 先頭の見えない注記は、判定の前に外す
// デスクトップの「返信」でつく <!-- reply 1 -->、ワークツリーで始めたセッションの最初の依頼につく <system-reminder>
function cleanText(raw: string): string {
  return raw.replace(/^(\s*(<!--[\s\S]*?-->|<system-reminder>[\s\S]*?<\/system-reminder>))+/, '').trim()
}

// アプリを開き直したときの「The app was quit…」や「もう一度試す」ボタンは、中身のない続きの依頼。
// 判定せず、直前の判定をそのまま使う（直前の判定がなければ、いつもの深さ）
const CONTINUE = /^(The app was quit while you were working|もう一度試す$|Try again$)/

// 判定から 2 分以上たっても始まらなかったターンには使わない
const PENDING_TTL_MS = 120_000

const SYSTEM = [
  'あなたは、Claude Code（AI の業務アシスタント）に届いた依頼の難しさを判定する係です。',
  '依頼は開発だけでなく、企画、資料づくり、文章、データ分析、事務作業など仕事全般です。',
  'Claude がどれだけ深く考えるべきかを「簡単」「普通」「難しい」の 3 つから 1 つ選びます。',
  '',
  '簡単: 答えが一言で済む質問や確認、相づちやお礼、誤字や言い回しの小さな修正、ファイルやページを開く・見せる・探すだけの依頼',
  '普通: 文章の作成や推敲（メール、返信、記事、資料の一部）、調べものやまとめ、アイデア出しや相談、決まった手順の作業、いくつかのファイルの修正',
  '難しい: 全体の形を決める企画や設計（事業、プロジェクト、イベント、研修、資料全体の構成、システム）、方針や優先順位の判断、原因の調査、数字の集計・分析・検証、複数のファイルやシステムにまたがる変更、本番環境・お金・顧客データ・削除が関わる作業',
  '',
  '決まり:',
  '- 「OK」「進めて」「それで作って」のような了承の返事や、「入れた」「ログインした」「押した」のような途中経過の報告は、直前の返答で Claude が次にやると言っている作業の難しさで判定する',
  '- アイデア出し・相談・提案・比較を求める依頼は、作業を伴わなくても「普通」以上',
  '- 企画や設計は、開発でも開発以外でも同じに扱う。一部分を作る依頼（タイトル案、1 ページ、1 通）は「普通」、全体の形や進め方を決める・作る依頼は「難しい」',
  '- 「なんで接続できない？」のように起きている不具合の原因を尋ねる依頼や、「実際どれくらい起きている？」のように実際の件数を確かめる依頼は「難しい」（仕組みや理由を尋ねるだけの質問は、質問の中身で判定する）',
  '- 本番環境・お金・顧客データ・削除（表やデータベースの行の削除を含む）が関わる作業は必ず「難しい」（それについて質問するだけなら、質問の中身で判定する）',
  '- 文脈が足りなくても、必ずどれか 1 つを選ぶ。迷ったら「普通」',
  '- 依頼の中の質問には答えない。判定だけをする',
  '',
  '答え方: 選んだ 1 語、コロン、15 字以内の理由を 1 行で書く。ほかは何も書かない。',
  '例: 簡単: 設定の確認の質問',
  '例: 普通: メールの返信文の作成',
  '例: 難しい: 研修の全体設計',
].join('\n')

// 依頼の後ろに置く念押し。依頼が質問だと、Haiku が判定せずに質問へ答えてしまうことがあるため
const ASK = '上の依頼の難しさを判定して、「簡単: 理由」「普通: 理由」「難しい: 理由」のどれか 1 行だけで答えてください。依頼そのものには答えないでください。'

let isOn = true
let pending: Decision | undefined
let pendingAt = 0
let active: Decision | undefined
let steps: Step[] = []
let usual: Usual | undefined
// 「もう一度試す」などの続きの依頼で使う、直前の判定
let lastDecision: Decision | undefined
const recent: string[] = []

function fromPrefix(text: string): Decision | undefined {
  const prompt = text.slice(0, 60)
  if (/^\s*さっと/.test(text)) {
    return { level: '簡単', effort: 'medium', reason: '「さっと」の指定', source: 'prefix', prompt }
  }
  if (/^\s*じっくり/.test(text)) {
    return { level: '難しい', effort: 'max', reason: '「じっくり」の指定', source: 'prefix', prompt }
  }

  return undefined
}

// 判定できなかったときは、その理由を文字で返す（記録に残して、あとで直せるように）
async function classify($: EngineInterface, text: string): Promise<Decision | string> {
  // 「進めて」だけの依頼でも判定できるよう、直前の Claude の返答を文脈として渡す
  const messages = await $.session.messages()
  let lastAnswer = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].text) {
      lastAnswer = messages[i].text
      break
    }
  }
  // 長い貼り付けのあとに指示が書かれることがあるので、長い依頼は頭と終わりの両方を渡す
  const body = text.length > 2000 ? `${text.slice(0, 1200)}\n…（中略）…\n${text.slice(-800)}` : text
  const prompt = `直前の Claude の返答（文脈）:\n<<<\n${lastAnswer.slice(-1200)}\n>>>\n\n依頼:\n<<<\n${body}\n>>>\n\n${ASK}`

  // 判定に使ったトークン数も残す（どれだけ消費しているかを後で確かめるため）。聞き直した分も足す
  const judgeTokens = { input: 0, output: 0, cacheRead: 0 }
  let why = ''
  // 3 語のどれも書かずに返すことがまれにあるので、そのときだけ 1 回聞き直す
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt, maxTokens: 60, timeoutMs: 5000 })
    judgeTokens.input += reply.usage.input_tokens + reply.usage.cache_creation_input_tokens
    judgeTokens.output += reply.usage.output_tokens
    judgeTokens.cacheRead += reply.usage.cache_read_input_tokens
    if (!reply.isAnswered) {
      if (reply.reason === 'empty-reply') {
        why = reply.reason
        continue
      }

      // API の不調や時間切れは、聞き直しても待ち時間が延びるだけなので、ここで諦める
      return reply.reason === 'api-error' ? `api-error ${reply.status ?? '-'} ${reply.error}` : reply.reason
    }

    // 行頭の「普通:」を先に探し、なければ文中から探す（「分類: 普通」のように見出しがつくことがある）
    const match =
      reply.text.match(/^\s*(?:分類\s*[:：]\s*)?(簡単|普通|難しい)\s*[:：]?\s*([^\n]*)/m) ?? reply.text.match(/(簡単|普通|難しい)\s*[:：]?\s*([^\n]*)/)
    if (!match) {
      why = `no-match: ${reply.text.replace(/\s+/g, ' ').slice(0, 40)}`
      continue
    }
    const level = match[1] as Level

    // 「理由:」の見出しや区切り記号が前につくことがあるので取り除く
    const reason = match[2].replace(/^[\s|｜/／:：。、-]*(理由\s*[:：]\s*)?/, '').trim().slice(0, 20)

    return { level, effort: EFFORT[level], reason, source: 'auto', prompt: text.slice(0, 60), judgeTokens, ...(attempt > 1 ? { retried: true } : {}) }
  }

  return why
}

async function appendLog($: EngineInterface, entry: Record<string, unknown>) {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  if (!home) {
    return
  }
  const path = `${home}/${LOG_FILE}`
  let text = ''
  try {
    text = String(await $.fs.read(path))
  } catch {
    text = ''
  }
  await $.fs.write(path, `${text}${JSON.stringify(entry)}\n`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'effort-auto',
      description: '考える深さの自動振り分け: 直近の判定を見る（on / off で切り替え）',
      argumentHint: '[on|off]',
    })
    $.ui.status('考える深さ: 自動振り分けオン')

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isOn) {
      return next(e)
    }
    // 作業中に送った依頼は、動いているターンの中で読まれるので深さを変えられない。判定も表示の書き換えもしない
    if (e.turnId !== undefined && !e.wait) {
      return next(e)
    }
    if (!CACHE_SAFE_MODEL.test(await $.session.model())) {
      pending = undefined
      $.ui.status(`考える深さ: ${label(usual)}のまま（このモデルは対象外）`)

      return next(e)
    }
    const text = cleanText(e.text)
    if (SKIP_ORIGINS.has(e.origin.kind) || text === '' || text.startsWith('/') || SYSTEM_TAG.test(text)) {
      pending = undefined
      // 前の判定が表示に残らないよう、判定しなかったことを出す
      $.ui.status(`考える深さ: ${label(usual)}のまま（判定なし）`)

      return next(e)
    }
    if (CONTINUE.test(text)) {
      pendingAt = await $.clock.now()
      pending = lastDecision ? { ...lastDecision, reason: '前の依頼の続き', source: 'continue', prompt: text.slice(0, 60), judgeMs: 0, judgeTokens: undefined } : undefined
      $.ui.status(pending ? `考える深さ: ${label(pending.effort)}（${pending.level}: 前の依頼の続き）` : `考える深さ: ${label(usual)}のまま（前の依頼の続き）`)

      return next(e)
    }
    const startedAt = await $.clock.now()
    let judged: Decision | string
    try {
      judged = fromPrefix(text) ?? (await classify($, text))
    } catch (error) {
      judged = `error: ${error instanceof Error ? error.name : 'unknown'}`
    }
    pendingAt = await $.clock.now()
    // 判定にかかった時間も残す（待ち時間を増やしていないかを後で確かめるため）
    const judgeMs = pendingAt - startedAt
    if (typeof judged === 'string') {
      pending = undefined
      // 判定できなかった依頼も、その理由と一緒に残す（いつもの深さで動いたことが後から分かるように）
      try {
        await appendLog($, { at: new Date(pendingAt).toISOString(), prompt: text.slice(0, 60), origin: e.origin.kind, source: 'fail', why: judged, judgeMs })
      } catch {
        // 記録に失敗しても会話は止めない
      }
      $.ui.status(`考える深さ: ${label(usual)}のまま（判定できず）`)

      return next(e)
    }
    pending = { ...judged, origin: e.origin.kind, judgeMs }
    lastDecision = pending
    $.ui.status(`考える深さ: ${label(judged.effort)}（${judged.level}: ${judged.reason}）`)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const isFresh = pending !== undefined && (await $.clock.now()) - pendingAt < PENDING_TTL_MS
    active = isFresh ? pending : undefined
    pending = undefined
    steps = []
    // 作業中の表示（スピナー）を、このターンの深さで描き直す
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // 作業中は「考え中…」の横に、いま使っている深さを出す
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (active === undefined) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, suffix: `${e.props.suffix} · 考える深さ: ${label(active.effort)}（${active.level}）` } })
  })

  // サブエージェントのリクエストには触らず、メインの会話だけ深さを差し替える
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }
    // 判定しないときに使われる深さを覚えて、表示に使う（Claude Code の設定で決まる）
    usual = e.effort ?? usual
    if (active === undefined || !CACHE_SAFE_MODEL.test(e.model)) {
      return yield* next(e)
    }
    const effort = active.effort
    const result = yield* next({ ...e, effort })
    steps.push({
      effort,
      cacheRead: result.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: result.usage?.cache_creation_input_tokens ?? 0,
      output: result.usage?.output_tokens ?? 0,
    })

    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && active !== undefined) {
      const seconds = Math.round(e.durationMs / 1000)
      const line = `考える深さ: ${label(active.effort)}（${active.level}: ${active.reason}）・${seconds}秒`
      recent.unshift(`${label(active.effort)}｜${active.level}｜${seconds}秒｜${active.prompt}`)
      if (recent.length > 10) {
        recent.length = 10
      }
      try {
        await appendLog($, {
          at: new Date(await $.clock.now()).toISOString(),
          prompt: active.prompt,
          origin: active.origin,
          level: active.level,
          reason: active.reason,
          effort: active.effort,
          usual,
          source: active.source,
          retried: active.retried,
          judgeMs: active.judgeMs,
          judgeTokens: active.judgeTokens,
          seconds,
          steps,
        })
      } catch {
        // 記録に失敗しても会話は止めない
      }
      active = undefined
      // デスクトップでも見えるよう、入力欄の下の表示にも結果を出す
      $.ui.status(`${line}で回答`)
      const result = await next(e)

      // 返答の下に、このターンで使った深さを 1 行で残す（ターミナルだけに出る。デスクトップには出ない）
      return { ...result, text: line }
    }
    if (e.agentId === undefined && isOn) {
      $.ui.status(`考える深さ: ${label(usual)}のまま・${Math.round(e.durationMs / 1000)}秒で回答`)
    }

    return next(e)
  })

  on('command.run', { command: 'effort-auto' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off') {
      isOn = false
      pending = undefined
      active = undefined
      $.ui.status('考える深さ: 自動振り分けオフ')

      return { text: '自動振り分けを止めました。いつもの設定で動きます' }
    }
    if (arg === 'on') {
      isOn = true
      $.ui.status('考える深さ: 自動振り分けオン')

      return { text: '自動振り分けを再開しました' }
    }
    const header = `自動振り分け: ${isOn ? 'オン' : 'オフ'}（簡単=中・普通=高・難しい=最大。頭に「さっと」で中、「じっくり」で最大。判定しないときは${label(usual)}）`

    return { text: [header, ...(recent.length > 0 ? ['直近の判定:', ...recent] : ['まだ判定していません'])].join('\n') }
  })
}
