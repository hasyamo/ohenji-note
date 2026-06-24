import { describe, it, expect } from 'vitest'
import { processComments, classifyComment } from '../src/lib/process-comments.js'

// テスト用のコメント生成ヘルパー
const makeComment = (overrides = {}) => ({
  key: 'k1',
  user: { urlname: 'someone' },
  is_creator_replied: false,
  is_creator_liked: false,
  ...overrides,
})

// テスト用の記事生成ヘルパー
const makeArticle = (overrides = {}) => ({
  key: 'a1',
  title: 'article',
  publishedAt: '2026-01-01T00:00:00+09:00',
  comments: [],
  ...overrides,
})

describe('classifyComment', () => {
  it('is_creator_replied=true なら replied', () => {
    const c = makeComment({ is_creator_replied: true })
    expect(classifyComment(c, new Set())).toBe('replied')
  })

  it('手動印リストに含まれていれば replied', () => {
    const c = makeComment({ key: 'k1' })
    expect(classifyComment(c, new Set(['k1']))).toBe('replied')
  })

  it('replied 条件を満たさず is_creator_liked=true なら liked', () => {
    const c = makeComment({ is_creator_liked: true })
    expect(classifyComment(c, new Set())).toBe('liked')
  })

  it('どれも満たさなければ unreplied', () => {
    const c = makeComment()
    expect(classifyComment(c, new Set())).toBe('unreplied')
  })

  it('replied は liked より優先される', () => {
    const c = makeComment({ is_creator_replied: true, is_creator_liked: true })
    expect(classifyComment(c, new Set())).toBe('replied')
  })
})

describe('processComments', () => {
  it('自分のコメントは除外される', () => {
    const articles = [makeArticle({
      comments: [
        makeComment({ key: 'k1', user: { urlname: 'me' } }),
        makeComment({ key: 'k2', user: { urlname: 'other' } }),
      ],
    })]
    const result = processComments(articles, 'me')
    expect(result[0].comments).toHaveLength(1)
    expect(result[0].comments[0].key).toBe('k2')
  })

  it('ミュートユーザーのコメントは除外される', () => {
    const articles = [makeArticle({
      comments: [
        makeComment({ key: 'k1', user: { urlname: 'muted' } }),
        makeComment({ key: 'k2', user: { urlname: 'other' } }),
      ],
    })]
    const result = processComments(articles, 'me', [], ['muted'])
    expect(result[0].comments).toHaveLength(1)
    expect(result[0].comments[0].key).toBe('k2')
  })

  it('コメントが0件になった記事は結果から除外される', () => {
    const articles = [
      makeArticle({ key: 'a1', comments: [makeComment({ user: { urlname: 'me' } })] }),
      makeArticle({ key: 'a2', comments: [makeComment({ user: { urlname: 'other' } })] }),
    ]
    const result = processComments(articles, 'me')
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('a2')
  })

  it('unreplied → liked → replied の順にソートされる', () => {
    const articles = [makeArticle({
      comments: [
        makeComment({ key: 'r', is_creator_replied: true }),
        makeComment({ key: 'l', is_creator_liked: true }),
        makeComment({ key: 'u' }),
      ],
    })]
    const result = processComments(articles, 'me')
    expect(result[0].comments.map(c => c.key)).toEqual(['u', 'l', 'r'])
  })

  it('unrepliedCount は未返信＋いいね済の合算', () => {
    const articles = [makeArticle({
      comments: [
        makeComment({ key: 'r', is_creator_replied: true }),
        makeComment({ key: 'l', is_creator_liked: true }),
        makeComment({ key: 'u' }),
      ],
    })]
    const result = processComments(articles, 'me')
    expect(result[0].unrepliedCount).toBe(2)
  })

  it('記事は公開日の新しい順に並ぶ', () => {
    const articles = [
      makeArticle({ key: 'old', publishedAt: '2025-01-01T00:00:00+09:00',
        comments: [makeComment({ user: { urlname: 'other' } })] }),
      makeArticle({ key: 'new', publishedAt: '2026-06-01T00:00:00+09:00',
        comments: [makeComment({ user: { urlname: 'other' } })] }),
    ]
    const result = processComments(articles, 'me')
    expect(result.map(a => a.key)).toEqual(['new', 'old'])
  })

  it('手動印を追加すると該当コメント1件だけが replied になる（全件 replied 化しないことの確認）', () => {
    const articles = [
      makeArticle({ key: 'a1', comments: [
        makeComment({ key: 'k1', user: { urlname: 'u1' } }),
        makeComment({ key: 'k2', user: { urlname: 'u2' } }),
      ] }),
      makeArticle({ key: 'a2', publishedAt: '2025-12-31T00:00:00+09:00', comments: [
        makeComment({ key: 'k3', user: { urlname: 'u3' } }),
      ] }),
    ]
    const before = processComments(articles, 'me')
    const beforeTotal = before.reduce((s, a) => s + a.unrepliedCount, 0)

    const after = processComments(articles, 'me', ['k1'])
    const afterTotal = after.reduce((s, a) => s + a.unrepliedCount, 0)

    expect(beforeTotal - afterTotal).toBe(1)
  })
})

describe('processComments 回帰テスト', () => {
  describe('コメント状態まわり', () => {
    it('API返信済みのコメントは status=replied になる', () => {
      const articles = [makeArticle({
        comments: [makeComment({ key: 'k1', is_creator_replied: true })],
      })]
      const result = processComments(articles, 'me')
      expect(result[0].comments[0].status).toBe('replied')
    })

    it('手動返信済みのコメントは status=replied になる', () => {
      const articles = [makeArticle({
        comments: [makeComment({ key: 'k1' })],
      })]
      const result = processComments(articles, 'me', ['k1'])
      expect(result[0].comments[0].status).toBe('replied')
    })

    it('liked のみのコメントは status=liked になる', () => {
      const articles = [makeArticle({
        comments: [makeComment({ key: 'k1', is_creator_liked: true })],
      })]
      const result = processComments(articles, 'me')
      expect(result[0].comments[0].status).toBe('liked')
    })

    it('未返信のコメントは status=unreplied になる', () => {
      const articles = [makeArticle({
        comments: [makeComment({ key: 'k1' })],
      })]
      const result = processComments(articles, 'me')
      expect(result[0].comments[0].status).toBe('unreplied')
    })

    it('同じ記事内の複数コメントが個別に判定される', () => {
      const articles = [makeArticle({
        comments: [
          makeComment({ key: 'k1', is_creator_replied: true }),
          makeComment({ key: 'k2', is_creator_liked: true }),
          makeComment({ key: 'k3' }),
        ],
      })]
      const result = processComments(articles, 'me')
      const byKey = Object.fromEntries(result[0].comments.map(c => [c.key, c.status]))
      expect(byKey).toEqual({ k1: 'replied', k2: 'liked', k3: 'unreplied' })
    })
  })

  describe('記事単位の表示', () => {
    it('全コメントが他者以外で消える記事は一覧から除外される', () => {
      const articles = [makeArticle({
        comments: [makeComment({ user: { urlname: 'me' } })],
      })]
      const result = processComments(articles, 'me')
      expect(result).toHaveLength(0)
    })

    it('未解決コメント0件でも他者コメントが残っていれば記事は残る（返信済みだけの記事）', () => {
      const articles = [makeArticle({
        comments: [makeComment({ key: 'k1', is_creator_replied: true })],
      })]
      const result = processComments(articles, 'me')
      expect(result).toHaveLength(1)
      expect(result[0].unrepliedCount).toBe(0)
    })

    it('未解決コメントが1件でもある記事は残る', () => {
      const articles = [makeArticle({
        comments: [
          makeComment({ key: 'k1', is_creator_replied: true }),
          makeComment({ key: 'k2' }),
        ],
      })]
      const result = processComments(articles, 'me')
      expect(result).toHaveLength(1)
      expect(result[0].unrepliedCount).toBe(1)
    })

    it('comments プロパティが空配列の記事は結果から除外される', () => {
      const articles = [makeArticle({ comments: [] })]
      const result = processComments(articles, 'me')
      expect(result).toHaveLength(0)
    })
  })

  describe('入力の堅牢性', () => {
    it('manualReplied が空配列でも動く', () => {
      const articles = [makeArticle({
        comments: [makeComment({ key: 'k1' })],
      })]
      expect(() => processComments(articles, 'me', [])).not.toThrow()
    })

    it('manualReplied が未指定でも動く', () => {
      const articles = [makeArticle({
        comments: [makeComment({ key: 'k1' })],
      })]
      expect(() => processComments(articles, 'me')).not.toThrow()
    })

    it('comments プロパティが undefined でも落ちない', () => {
      const articles = [{ key: 'a1', publishedAt: '2026-01-01T00:00:00+09:00' }]
      expect(() => processComments(articles, 'me')).not.toThrow()
    })

    it('user が無いコメントは除外され、落ちない', () => {
      const articles = [makeArticle({
        comments: [
          { key: 'k1' },
          makeComment({ key: 'k2', user: { urlname: 'other' } }),
        ],
      })]
      const result = processComments(articles, 'me')
      expect(result[0].comments.map(c => c.key)).toEqual(['k2'])
    })

    it('articles が空配列でも空配列を返す', () => {
      expect(processComments([], 'me')).toEqual([])
    })
  })
})
