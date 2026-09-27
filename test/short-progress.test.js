import { describe, it, expect } from 'vitest'
import { shortProgress } from '../src/utils.js'

describe('shortProgress', () => {
  it('記事タイトルを除く', () => {
    expect(shortProgress('コメント取得中... (12/280) オリキャラの本音｜おはようカノジョ #293')).toBe('コメント取得中... (12/280)')
    expect(shortProgress('返信を取得中... (2/18) タイトル（スレッド 1/3）')).toBe('返信を取得中... (2/18)')
  })

  it('記事一覧の件数もそのまま残す', () => {
    expect(shortProgress('記事一覧を取得中... (36件)')).toBe('記事一覧を取得中... (36件)')
  })

  it('形が違えばそのまま返す', () => {
    expect(shortProgress('読み込み中...')).toBe('読み込み中...')
    expect(shortProgress(undefined)).toBe('')
  })
})
