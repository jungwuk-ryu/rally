import assert from 'node:assert/strict'
import test from 'node:test'

import type { Market } from '../src/types.js'
import { parseUpbitTicker, pollMarketPrice } from './index.js'

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
