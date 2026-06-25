import { describe, it, expect } from 'vitest'
import { shouldShowPraise } from '../src/lib/should-show-praise.js'

const article = (comments) => ({ key: 'a', comments })
const c = (status) => ({ key: status, status })

describe('shouldShowPraise', () => {
  it('表示すべきコメントが1件もない（全部 replied）なら true', () => {
    const articles = [article([c('replied'), c('replied')])]
    expect(shouldShowPraise(articles, { isRefreshing: false })).toBe(true)
  })

  it('記事が一つもなければ true', () => {
    expect(shouldShowPraise([], { isRefreshing: false })).toBe(true)
  })

  it('unreplied が1件でもあれば false', () => {
    const articles = [article([c('replied'), c('unreplied')])]
    expect(shouldShowPraise(articles, { isRefreshing: false })).toBe(false)
  })

  it('liked が1件でもあれば false', () => {
    const articles = [article([c('replied'), c('liked')])]
    expect(shouldShowPraise(articles, { isRefreshing: false })).toBe(false)
  })

  it('isRefreshing 中は表示すべきコメントゼロでも false', () => {
    const articles = [article([c('replied')])]
    expect(shouldShowPraise(articles, { isRefreshing: true })).toBe(false)
  })

  it('forceReward=true なら、unreplied があっても true', () => {
    const articles = [article([c('unreplied')])]
    expect(shouldShowPraise(articles, { isRefreshing: false, forceReward: true })).toBe(true)
  })

  it('forceReward=true でも、isRefreshing 中は false', () => {
    const articles = [article([c('unreplied')])]
    expect(shouldShowPraise(articles, { isRefreshing: true, forceReward: true })).toBe(false)
  })

  it('複数記事の判定: どこかの記事に未解決があれば false', () => {
    const articles = [
      article([c('replied')]),
      article([c('replied'), c('liked')]),
    ]
    expect(shouldShowPraise(articles, { isRefreshing: false })).toBe(false)
  })
})
