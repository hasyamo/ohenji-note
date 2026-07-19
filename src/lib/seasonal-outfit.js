import seasons from '../rewards/seasons.json'

/**
 * 季節衣装（YOMIASA のニゲキレ交換所で受け取ったもの）の解放状態を扱う。
 *
 * - 解放状態は YOMIASA 側の D1 が正。おへんじ帖は **読むだけ**。
 * - 取得できたらローカルにキャッシュし、失敗したら前回のキャッシュを使う
 *   （オフラインでも衣装が出るように）。
 * - 一度も取得できていなければ通常衣装。
 */

const UNLOCKS_URL = 'https://yomiasa-site.hasyamo.workers.dev/api/outfit/unlocks'

/**
 * 画像が存在するキャラの許可リスト。
 *
 * API 側は解放状態しか持っておらず「おへんじ帖に画像があるか」は知らないため、
 * 画像の有無はこちら側で持つ。ここに無い組み合わせは通常衣装のままになる。
 * 鈴（rinka-suzu）は夏衣装の絵が無いので summer に含めない。
 * 秋・冬・春は画像未制作（8月中旬以降）なので空。
 */
const AVAILABLE_OUTFITS = {
  summer: ['hiyori', 'tsukiko', 'you', 'shizuku', 'rinka', 'runa', 'mahiru'],
  autumn: [],
  winter: [],
  spring: [],
}

/**
 * 月（1-12）から季節 id を返す。該当が無ければ null。
 */
export function getSeasonForMonth(month) {
  const season = seasons.find((s) => s.months.includes(month))
  return season ? season.id : null
}

/**
 * 'YYYY-MM-DD' から季節 id を返す。
 */
export function getSeasonForDate(dateStr) {
  const month = Number(String(dateStr).split('-')[1])
  if (!month) return null
  return getSeasonForMonth(month)
}

/**
 * API レスポンスを { season: Set<characterId> } の形に畳む。
 */
function indexUnlocks(outfits) {
  const index = {}
  for (const entry of outfits) {
    if (!entry || !entry.season || !entry.characterId) continue
    if (!index[entry.season]) index[entry.season] = []
    if (!index[entry.season].includes(entry.characterId)) {
      index[entry.season].push(entry.characterId)
    }
  }
  return index
}

/**
 * 解放状態を取得する。成功したらキャッシュに保存し、失敗したら前回のキャッシュを返す。
 *
 * 戻り値: { unlocks, source } — source は 'network' | 'cache' | 'none'
 * 呼び出し側が待たなくていいよう、例外は投げない。
 */
export async function fetchOutfitUnlocks(noteId, storage) {
  if (!noteId) return { unlocks: {}, source: 'none' }

  try {
    const url = `${UNLOCKS_URL}?noteId=${encodeURIComponent(noteId)}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const unlocks = indexUnlocks(Array.isArray(data?.outfits) ? data.outfits : [])
    storage.setOutfitUnlocks(noteId, unlocks)
    return { unlocks, source: 'network' }
  } catch {
    // 通信失敗・パース失敗は前回のキャッシュで代替する（オフライン時の想定挙動）
    const cached = storage.getOutfitUnlocks(noteId)
    return cached ? { unlocks: cached, source: 'cache' } : { unlocks: {}, source: 'none' }
  }
}

/**
 * 褒め演出のちび絵を、季節衣装フォルダから読むべきか判定する。
 * すべて満たすときだけ季節 id を返し、そうでなければ null（＝通常衣装）。
 *
 *   1. 設定「季節衣装を使う」が ON
 *   2. 今の季節の衣装を、そのキャラで受け取り済み
 *   3. コラボキャラでない
 *
 * 季節が合わないときは通常衣装に戻す（夏衣装しか持っていない人が冬に開いても夏は出さない）。
 */
export function resolveOutfitSeason({ character, dateStr, unlocks, enabled }) {
  if (!enabled) return null
  if (!character || character.isCollab) return null

  const season = getSeasonForDate(dateStr)
  if (!season) return null

  // 画像が無い組み合わせ（鈴の夏、未制作の秋冬春）は通常衣装のまま
  if (!AVAILABLE_OUTFITS[season]?.includes(character.id)) return null

  const unlockedForSeason = unlocks?.[season]
  if (!Array.isArray(unlockedForSeason)) return null
  if (!unlockedForSeason.includes(character.id)) return null

  return season
}
