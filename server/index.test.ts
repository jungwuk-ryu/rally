import assert from 'node:assert/strict'
import test from 'node:test'

import type { Market } from '../src/types.js'
import {
  calculateLeveragedReturnRate,
  fetchUpbitTickerPrice,
  marketFromActualPrice,
  parseUpbitTicker,
  pollMarketPrice,
  settleLeveragedPosition,
} from './index.js'

test('ticker failures preserve the last actual price and chart history', async () => {
  const market: Market = {
    symbol: 'KRW-BTC',
    name: '비트코인',
    price: 123_456_000,
    previousPrice: 123_400_000,
    changeRate: 0.05,
    history: [123_100_000, 123_250_000, 123_456_000],
    source: 'upbit',
  }
  const before = structuredClone(market)
  const failingRequest: typeof fetch = async () => {
    throw new Error('network unavailable')
  }

  assert.equal(await pollMarketPrice(market, failingRequest), false)
  assert.equal(await pollMarketPrice(market, failingRequest), false)
  assert.deepEqual(market, before)
})

test('Upbit SIMPLE ticker messages expose the subscribed symbol and price', () => {
  assert.deepEqual(
    parseUpbitTicker(JSON.stringify({ ty: 'ticker', cd: 'KRW-BTC', tp: 123_456_000 })),
    { symbol: 'KRW-BTC', price: 123_456_000 },
  )
})

test('a cached or primed actual price seeds the market without a hardcoded DEMO jump', async () => {
  const primed = await fetchUpbitTickerPrice('KRW-BTC', async () => new Response(JSON.stringify([{ trade_price: 107_740_000 }]), { status: 200 }))
  const market = marketFromActualPrice('KRW-BTC', '비트코인', primed ?? 0)

  assert.equal(primed, 107_740_000)
  assert.equal(market.price, 107_740_000)
  assert.equal(market.source, 'upbit')
  assert.deepEqual(market.history, Array.from({ length: 40 }, () => 107_740_000))
})

test('ten-times leverage applies to both profit and loss settlement', () => {
  assert.equal(calculateLeveragedReturnRate(100, 110, 10), 1)
  assert.equal(settleLeveragedPosition(100, 100, 110, 10), 200)
  assert.equal(settleLeveragedPosition(100, 100, 90, 10), 0)
  assert.equal(settleLeveragedPosition(100, 100, 80, 10), 0)
})
