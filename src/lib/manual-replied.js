/**
 * 手動返信印リスト（manualReplied）の純粋関数群。
 *
 * 新形式エントリ:
 *   {
 *     key:        コメントキー (string)
 *     markedAt:   ISO8601 文字列 (string | null)
 *     source:     'reply-button' | 'legacy-array-migration' (string)
 *     clickSeq:   そのセッションで何回目のクリックか (number | null)
 *     eventId:    クリックを束ねる識別子 (string | null)
 *     appVersion: 記録時のアプリバージョン (string | null)
 *     buildHash:  記録時のビルドハッシュ (string | null)
 *     migratedAt: 旧形式からの移行時刻 (string, source='legacy-array-migration' のみ)
 *   }
 */

/**
 * 値が新形式エントリの形をしているかを判定する。
 */
export function isEntry(value) {
  return value != null && typeof value === 'object' && typeof value.key === 'string' && value.key.length > 0
}

/**
 * 旧形式（文字列配列）/ 混在 / 不正値を含む配列を、新形式エントリ配列に正規化する。
 *
 * - 文字列要素は legacy-array-migration として移行する
 * - 既に新形式のエントリはそのまま保持する
 * - 同じ key の重複は最初に現れたものを優先（旧→新の順で渡せば legacy 側が残る）
 * - null/undefined/空文字列など不正値は捨てる
 */
export function migrateManualReplied(raw, { now, appVersion = null, buildHash = null } = {}) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const result = []
  const migratedAt = now || null
  for (const item of raw) {
    if (typeof item === 'string') {
      if (!item) continue
      if (seen.has(item)) continue
      seen.add(item)
      result.push({
        key: item,
        markedAt: null,
        source: 'legacy-array-migration',
        clickSeq: null,
        eventId: null,
        appVersion,
        buildHash,
        migratedAt,
      })
    } else if (isEntry(item)) {
      if (seen.has(item.key)) continue
      seen.add(item.key)
      result.push(item)
    }
  }
  return result
}

/**
 * 既存エントリ配列に新しいエントリを追加した結果を返す。
 * 既に同じ key があれば追加しない（重複を作らない）。
 * 異常を検知した場合は debugEvent を返す（呼び出し側でリングバッファに積む）。
 *
 * 入力:
 *   - entries: 既存エントリ配列
 *   - key: 追加するコメントキー
 *   - context: { now, source, clickSeq, eventId, appVersion, buildHash }
 *
 * 出力:
 *   - entries: 追加後のエントリ配列（追加されなかった場合は元のまま）
 *   - added: 新規追加されたエントリ（重複時は null）
 *   - debugEvent: 異常検知時のデバッグイベント候補（無ければ null）
 */
export function addManualRepliedEntry(entries, key, context = {}) {
  if (!key || typeof key !== 'string') {
    return { entries, added: null, debugEvent: null }
  }
  const {
    now = new Date().toISOString(),
    source = 'reply-button',
    clickSeq = null,
    eventId = null,
    appVersion = null,
    buildHash = null,
  } = context

  // 既に存在すれば追加しない
  if (entries.some((e) => e.key === key)) {
    return { entries, added: null, debugEvent: null }
  }

  const newEntry = { key, markedAt: now, source, clickSeq, eventId, appVersion, buildHash }
  const nextEntries = [...entries, newEntry]

  // 異常検知: 同じ eventId が既に他のエントリに付いていれば「1クリックで複数件追加」
  let debugEvent = null
  if (eventId) {
    const sameEvent = nextEntries.filter((e) => e.eventId === eventId)
    if (sameEvent.length > 1) {
      debugEvent = {
        type: 'manual_replied_multiple_in_event',
        at: now,
        eventId,
        clickSeq,
        keys: sameEvent.map((e) => e.key),
        addedKey: key,
      }
    }
  }

  return { entries: nextEntries, added: newEntry, debugEvent }
}

/**
 * 「同じ eventId に複数件」のエントリ群を集計する。
 * サポートデータに含める suspiciousGroups の計算に使う。
 */
export function buildSuspiciousManualGroups(entries) {
  const byEventId = new Map()
  for (const e of entries) {
    if (!e.eventId) continue
    if (!byEventId.has(e.eventId)) byEventId.set(e.eventId, [])
    byEventId.get(e.eventId).push(e)
  }
  const groups = []
  for (const [eventId, group] of byEventId) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => (a.markedAt || '').localeCompare(b.markedAt || ''))
    groups.push({
      eventId,
      clickSeq: sorted[0].clickSeq,
      keys: sorted.map((e) => e.key),
      firstMarkedAt: sorted[0].markedAt,
      lastMarkedAt: sorted[sorted.length - 1].markedAt,
    })
  }
  return groups
}

/**
 * エントリ配列を、画面表示判定で使う形（key の Set + legacy key の Set）に変換する。
 */
export function indexManualReplied(entries) {
  const all = new Set()
  const legacy = new Set()
  for (const e of entries) {
    if (!isEntry(e)) continue
    all.add(e.key)
    if (e.source === 'legacy-array-migration') legacy.add(e.key)
  }
  return { all, legacy }
}
