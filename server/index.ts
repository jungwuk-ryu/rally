import 'dotenv/config'

import { randomInt, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import cors from 'cors'
import express from 'express'
import { Server, type Socket } from 'socket.io'
import WebSocket, { type RawData } from 'ws'

import type {
  JoinPayload,
  Market,
  PartyEvent,
  PartyNotice,
  PartyOrder,
  PartySettings,
  PartyState,
  PartyUser,
  Position,
  Product,
  Session,
} from '../src/types.js'

const PORT = numberFromEnv(process.env.PORT, 8829)
const ROUND_CHECK_INTERVAL_MS = 1_000
const REST_RECOVERY_INTERVAL_MS = 15_000
const STREAM_STALE_MS = 15_000
const STREAM_RECONNECT_MAX_MS = 10_000
const MAX_PRICE_HISTORY = 72
const RALLY_DURATION_MS = 8_000
const UPBIT_TICKER_ENDPOINT = 'https://api.upbit.com/v1/ticker'
const UPBIT_MINUTE_CANDLES_ENDPOINT = 'https://api.upbit.com/v1/candles/minutes/1'
const UPBIT_TICKER_WEBSOCKET_ENDPOINT = 'wss://api.upbit.com/websocket/v1'
const INITIAL_HISTORY_POINTS = 40
const HOST_PASSWORD = process.env.HOST_PASSWORD?.trim() || '123456'

const MARKET_POOL = [
  { symbol: 'KRW-BTC', name: '비트코인', fallbackPrice: 156_200_000 },
  { symbol: 'KRW-ETH', name: '이더리움', fallbackPrice: 5_240_000 },
  { symbol: 'KRW-XRP', name: '엑스알피', fallbackPrice: 4_120 },
  { symbol: 'KRW-SOL', name: '솔라나', fallbackPrice: 272_000 },
  { symbol: 'KRW-DOGE', name: '도지코인', fallbackPrice: 286 },
  { symbol: 'KRW-ADA', name: '에이다', fallbackPrice: 1_180 },
  { symbol: 'KRW-AVAX', name: '아발란체', fallbackPrice: 35_500 },
] as const

const PRODUCTS: Product[] = [
  { id: 'highball', name: '시그니처 하이볼', description: '시원하게 한 잔', price: 35, emoji: '🥃', accent: '#e9b96b' },
  { id: 'beer', name: '라거 맥주', description: '가볍게 건배', price: 25, emoji: '🍺', accent: '#f4d35e' },
  { id: 'shot', name: '샷 한 잔', description: '분위기 올리기', price: 18, emoji: '🥂', accent: '#f5a0bd' },
  { id: 'snack', name: '트러플 감자', description: '함께 나눠요', price: 22, emoji: '🍟', accent: '#ee8a64' },
]

const DEFAULT_EVENTS: Array<Pick<PartyEvent, 'title' | 'reward'>> = [
  { title: '처음 보는 사람과 건배하기', reward: 30 },
  { title: '이번 라운드 1위와 건배하기', reward: 30 },
]

const MC_FALLBACKS = {
  roundStart: ['새 라운드 시작. 오늘의 흐름을 함께 즐겨요.', '새 종목이 열렸어요. 모두 준비!', '다음 라운드, 분위기 이어갑니다.'],
  priceMove: ['움직임이 커졌어요. 화면을 주목하세요!', '흐름이 바뀝니다. 파티 열기 유지!', '지금, 모두 같은 화면을 보고 있어요.'],
  rally: ['RALLY! 이 순간은 함께라서 더 뜨겁습니다.', '모두의 크레딧이 모였어요. RALLY!', '좋아요, 파티의 온도가 올라갑니다!'],
  gift: ['선물이 도착했어요. 건배 한 번!', '누군가 분위기를 한 잔 올렸어요.', '잔이 오가는 지금, 여기가 파티죠.'],
  roundEnd: ['이번 라운드 마감. 결과를 확인해요.', '라운드 종료! 다음 장면으로 갑니다.', '정산 완료. 다음 흐름을 기다려요.'],
} as const

type McTrigger = keyof typeof MC_FALLBACKS

interface Room {
  hostId: string
  userIdByPhone: Map<string, string>
  lastMcAt: number
  mcPending: boolean
  isTransitioning: boolean
  state: PartyState
}

interface Ack {
  ok: boolean
  error?: string
  state?: PartyState
  session?: Session
}

const rooms = new Map<string, Room>()
const sessions = new Map<string, Session>()
let activeRoomCode: string | undefined
let upbitTickerSocket: WebSocket | undefined
let upbitReconnectTimer: ReturnType<typeof setTimeout> | undefined
let upbitReconnectDelayMs = 500
let lastUpbitStreamMessageAt = 0
let isCreatingRoom = false
const latestUpbitPrices = new Map<string, number>()

const app = express()
app.disable('x-powered-by')
app.use(cors({ origin: true }))
app.use(express.json({ limit: '48kb' }))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'rally', rooms: rooms.size, uptimeSeconds: Math.floor(process.uptime()) })
})

const distDirectory = resolve(process.cwd(), 'dist')
const distIndex = resolve(distDirectory, 'index.html')
if (existsSync(distIndex)) {
  app.use(express.static(distDirectory))
  app.get('/{*path}', (request, response, next) => {
    if (request.path.startsWith('/api/')) return next()
    response.sendFile(distIndex)
  })
}

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: true, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
})

if (process.env.RALLY_TEST_MODE !== '1') {
  io.on('connection', (socket) => registerSocket(socket))
  connectUpbitTickerStream()

  setInterval(() => {
    for (const room of rooms.values()) {
      const now = Date.now()
      if (room.state.rallyActiveUntil && room.state.rallyActiveUntil <= now) {
        room.state.rallyActiveUntil = undefined
        broadcast(room)
      }
      if (room.state.settings.autoRoundEnabled && now - room.state.roundStartedAt >= room.state.settings.roundSeconds * 1_000) {
        finishRound(room, false)
      }
    }
  }, ROUND_CHECK_INTERVAL_MS).unref()

  setInterval(() => {
    if (isUpbitStreamStale()) {
      void pollMarkets()
      connectUpbitTickerStream()
    }
  }, REST_RECOVERY_INTERVAL_MS).unref()

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.info(`[rally] server listening on ${PORT}`)
  })
}

function registerSocket(socket: Socket) {
  socket.on('host:create', async (payload: { hostName?: unknown; settings?: Partial<PartySettings>; password?: unknown } = {}, ack?: (result: Ack) => void) => {
    if (!hasHostPassword(payload.password)) return fail(socket, ack, '호스트 비밀번호가 맞지 않아요.')
    if (activeRoom() || isCreatingRoom) return fail(socket, ack, '이미 진행 중인 Rally 파티가 있어요. 손님으로 참여해 주세요.')
    const hostName = cleanName(payload.hostName, '오늘의 호스트')
    isCreatingRoom = true
    try {
      const room = await createRoom(hostName, payload.settings)
      const session: Session = {
        roomCode: room.state.roomCode,
        userId: room.hostId,
        phone: '',
        nickname: hostName,
        isHost: true,
      }
      attachSession(socket, session)
      io.to(room.state.roomCode).emit('party:notice', room.state.notice)
      ack?.({ ok: true, state: room.state, session })
    } finally {
      isCreatingRoom = false
    }
  })

  socket.on('host:resume', (payload: { roomCode?: unknown; userId?: unknown; password?: unknown }, ack?: (result: Ack) => void) => {
    if (!hasHostPassword(payload?.password)) return fail(socket, ack, '호스트 비밀번호가 맞지 않아요.')
    const room = rooms.get(String(payload?.roomCode ?? '').trim().toUpperCase())
    if (!room || room.hostId !== String(payload?.userId ?? '')) return fail(socket, ack, '복구할 호스트 세션을 찾지 못했어요.')

    const session: Session = {
      roomCode: room.state.roomCode,
      userId: room.hostId,
      phone: '',
      nickname: room.state.hostName,
      isHost: true,
    }
    attachSession(socket, session)
    ack?.({ ok: true, state: room.state, session })
  })

  socket.on('host:join-active', (payloadOrAck?: unknown, possibleAck?: (result: Ack) => void) => {
    const ack = callbackFrom(payloadOrAck, possibleAck)
    const payload = payloadOrAck && typeof payloadOrAck === 'object' ? payloadOrAck as { password?: unknown } : undefined
    if (!hasHostPassword(payload?.password)) return fail(socket, ack, '호스트 비밀번호가 맞지 않아요.')
    const room = activeRoom()
    if (!room) return fail(socket, ack, '연결할 Rally 파티가 아직 없어요.')

    const session: Session = {
      roomCode: room.state.roomCode,
      userId: room.hostId,
      phone: '',
      nickname: room.state.hostName,
      isHost: true,
    }
    attachSession(socket, session)
    ack?.({ ok: true, state: room.state, session })
  })

  socket.on('party:join', (payload: JoinPayload, ack?: (result: Ack) => void) => {
    const room = rooms.get(String(payload?.roomCode ?? '').trim().toUpperCase())
    if (!room) return fail(socket, ack, '파티룸을 찾을 수 없어요.')

    const possibleHostSession = payload as JoinPayload & Partial<Session>
    if (possibleHostSession.isHost && room.hostId === possibleHostSession.userId) {
      if (!hasHostPassword((possibleHostSession as Partial<Session> & { password?: unknown }).password)) {
        return fail(socket, ack, '호스트 비밀번호가 맞지 않아요.')
      }
      const session: Session = {
        roomCode: room.state.roomCode,
        userId: room.hostId,
        phone: '',
        nickname: room.state.hostName,
        isHost: true,
      }
      attachSession(socket, session)
      return ack?.({ ok: true, state: room.state, session })
    }

    joinGuest(socket, room, payload, ack)
  })

  socket.on('party:join-default', (payload: Omit<JoinPayload, 'roomCode'>, ack?: (result: Ack) => void) => {
    const room = activeRoom()
    if (!room) return fail(socket, ack, '아직 열린 Rally 파티가 없어요.')
    joinGuest(socket, room, payload, ack)
  })

  socket.on('party:resume', (payload: Pick<JoinPayload, 'roomCode' | 'phone'>, ack?: (result: Ack) => void) => {
    const room = rooms.get(String(payload?.roomCode ?? '').trim().toUpperCase())
    const phone = normalizePhone(payload?.phone)
    const user = room && phone ? findUser(room, room.userIdByPhone.get(phone)) : undefined
    if (!room || !phone || !user) return fail(socket, ack, '복구할 참가자 정보를 찾지 못했어요.')

    const session: Session = { roomCode: room.state.roomCode, userId: user.id, phone, nickname: user.nickname, isHost: false }
    attachSession(socket, session)
    ack?.({ ok: true, state: room.state, session })
  })

  socket.on('position:open', (payload: { userId?: unknown; amount?: unknown }, ack?: (result: Ack) => void) => {
    const context = getGuestContext(socket, payload?.userId)
    if (!context) return fail(socket, ack, '참가자 세션을 확인해 주세요.')
    const amount = wholeNumber(payload?.amount, 1, context.user.credit)
    if (!amount) return fail(socket, ack, '보유 크레딧 안에서 금액을 입력해 주세요.')

    const { room, user } = context
    const price = room.state.market.price
    const position = user.position
    const isAdditionalBuy = Boolean(position)
    if (position) {
      const combined = position.amount + amount
      position.entryPrice = (position.entryPrice * position.amount + price * amount) / combined
      position.amount = combined
    } else {
      user.position = { amount, entryPrice: price, openedAt: Date.now() }
    }
    user.credit -= amount
    refreshPnls(room)
    room.state.notice = notice(
      'event',
      isAdditionalBuy ? '추가 매수' : '매수 체결',
      `${user.nickname}님이 ${amount} 크레딧을 담았어요.`,
    )
    broadcast(room)
    ack?.({ ok: true, state: room.state })
  })

  socket.on('position:close', (payload: { userId?: unknown; amount?: unknown; closeAll?: unknown }, ack?: (result: Ack) => void) => {
    closePosition(socket, payload, ack)
  })

  socket.on('credit:topup', (payload: { userId?: unknown; amount?: unknown }, ack?: (result: Ack) => void) => {
    const context = getGuestContext(socket, payload?.userId)
    if (!context) return fail(socket, ack, '참가자 세션을 확인해 주세요.')
    const amount = wholeNumber(payload?.amount, 1, 20_000)
    if (!amount) return fail(socket, ack, '충전할 크레딧을 확인해 주세요.')

    context.user.credit += amount
    context.room.state.notice = notice('event', '크레딧 충전', `${context.user.nickname}님이 ${amount} 크레딧을 더했어요.`)
    broadcast(context.room)
    ack?.({ ok: true, state: context.room.state })
  })

  socket.on('order:create', (payload: { userId?: unknown; productId?: unknown; recipientId?: unknown }, ack?: (result: Ack) => void) => {
    const context = getGuestContext(socket, payload?.userId)
    if (!context) return fail(socket, ack, '참가자 세션을 확인해 주세요.')
    const product = context.room.state.products.find((item) => item.id === String(payload?.productId ?? ''))
    const recipient = findUser(context.room, String(payload?.recipientId ?? context.user.id))
    if (!product || !recipient) return fail(socket, ack, '상품 또는 받는 사람을 확인해 주세요.')
    if (context.user.credit < product.price) return fail(socket, ack, '크레딧이 부족해요.')

    context.user.credit -= product.price
    const order: PartyOrder = {
      id: `order_${randomUUID()}`,
      productId: product.id,
      buyerId: context.user.id,
      recipientId: recipient.id,
      served: false,
      createdAt: Date.now(),
    }
    context.room.state.orders.unshift(order)
    const isGift = recipient.id !== context.user.id
    context.room.state.notice = notice(
      isGift ? 'gift' : 'event',
      isGift ? '선물이 도착했어요' : '주문을 받았어요',
      isGift ? `${context.user.nickname}님이 ${recipient.nickname}님에게 ${product.name}을 쐈어요.` : `${context.user.nickname}님이 ${product.name}을 주문했어요.`,
      recipient.id,
    )
    if (isGift) {
      emitNoticeToUser(context.room, recipient.id, context.room.state.notice)
      announceMc(context.room, 'gift')
    }
    broadcast(context.room)
    ack?.({ ok: true, state: context.room.state })
  })

  socket.on('host:rally', (payloadOrAck?: unknown, possibleAck?: (result: Ack) => void) => {
    const ack = callbackFrom(payloadOrAck, possibleAck)
    const room = getHostRoom(socket)
    if (!room) return fail(socket, ack, '호스트 세션을 확인해 주세요.')
    const now = Date.now()
    const invested = room.state.users.reduce((total, user) => total + (user.position?.amount ?? 0), 0)
    const cooldown = room.state.settings.rallyCooldownSeconds * 1_000
    if (invested < room.state.settings.rallyThreshold) return fail(socket, ack, `RALLY는 ${room.state.settings.rallyThreshold} 크레딧부터 열려요.`)
    if (room.state.lastRallyAt && now - room.state.lastRallyAt < cooldown) return fail(socket, ack, '잠시 뒤에 다시 RALLY를 열 수 있어요.')

    room.state.lastRallyAt = now
    room.state.rallyActiveUntil = now + RALLY_DURATION_MS
    room.state.notice = notice('rally', 'RALLY MOMENT', '모두의 참여가 하나로 모였어요!')
    announceMc(room, 'rally')
    broadcast(room)
    ack?.({ ok: true, state: room.state })
  })

  socket.on('host:round-next', async (payloadOrAck?: unknown, possibleAck?: (result: Ack) => void) => {
    const ack = callbackFrom(payloadOrAck, possibleAck)
    const room = getHostRoom(socket)
    if (!room) return fail(socket, ack, '호스트 세션을 확인해 주세요.')
    await finishRound(room, true)
    ack?.({ ok: true, state: room.state })
  })

  socket.on('host:settings', (payload: Partial<PartySettings>, ack?: (result: Ack) => void) => {
    const room = getHostRoom(socket)
    if (!room) return fail(socket, ack, '호스트 세션을 확인해 주세요.')
    const wasAutoRoundEnabled = room.state.settings.autoRoundEnabled
    room.state.settings = mergeSettings(room.state.settings, payload)
    if (!wasAutoRoundEnabled && room.state.settings.autoRoundEnabled) room.state.roundStartedAt = Date.now()
    room.state.notice = notice(
      'event',
      '라운드 설정 변경',
      room.state.settings.autoRoundEnabled
        ? `${room.state.settings.roundSeconds}초마다 다음 종목으로 넘어가요.`
        : '자동 종목 전환을 껐어요.',
    )
    broadcast(room)
    ack?.({ ok: true, state: room.state })
  })

  socket.on('host:event-create', (payload: { title?: unknown; reward?: unknown }, ack?: (result: Ack) => void) => {
    const room = getHostRoom(socket)
    if (!room) return fail(socket, ack, '호스트 세션을 확인해 주세요.')
    const title = cleanTitle(payload?.title)
    const reward = wholeNumber(payload?.reward, 1, 1_000)
    if (!title || !reward) return fail(socket, ack, '이벤트 이름과 보상을 확인해 주세요.')

    room.state.events.unshift({ id: `event_${randomUUID()}`, title, reward, active: true, createdAt: Date.now(), completedUserIds: [] })
    room.state.notice = notice('event', '새 파티 미션', `${title} · ${reward} 크레딧`)
    broadcast(room)
    ack?.({ ok: true, state: room.state })
  })

  socket.on('host:event-reward', (payload: { eventId?: unknown; userId?: unknown }, ack?: (result: Ack) => void) => {
    const room = getHostRoom(socket)
    if (!room) return fail(socket, ack, '호스트 세션을 확인해 주세요.')
    const event = room.state.events.find((item) => item.id === String(payload?.eventId ?? ''))
    const user = findUser(room, String(payload?.userId ?? ''))
    if (!event || !event.active || !user) return fail(socket, ack, '이벤트 또는 참가자를 확인해 주세요.')
    if (event.completedUserIds.includes(user.id)) return fail(socket, ack, '이미 보상을 지급했어요.')

    event.completedUserIds.push(user.id)
    user.credit += event.reward
    room.state.notice = notice('event', '미션 완료', `${user.nickname}님에게 ${event.reward} 크레딧을 드렸어요.`, user.id)
    emitNoticeToUser(room, user.id, room.state.notice)
    broadcast(room)
    ack?.({ ok: true, state: room.state })
  })

  socket.on('host:order-served', (payload: { orderId?: unknown }, ack?: (result: Ack) => void) => {
    const room = getHostRoom(socket)
    if (!room) return fail(socket, ack, '호스트 세션을 확인해 주세요.')
    const order = room.state.orders.find((item) => item.id === String(payload?.orderId ?? ''))
    if (!order) return fail(socket, ack, '주문을 찾을 수 없어요.')
    order.served = true
    room.state.notice = notice('event', '서빙 완료', '주문한 상품을 전달했어요.', order.recipientId)
    emitNoticeToUser(room, order.recipientId, room.state.notice)
    broadcast(room)
    ack?.({ ok: true, state: room.state })
  })

  socket.on('disconnect', () => sessions.delete(socket.id))
}

async function createRoom(hostName: string, requestedSettings?: Partial<PartySettings>): Promise<Room> {
  const roomCode = newRoomCode()
  const now = Date.now()
  const selected = MARKET_POOL[randomInt(MARKET_POOL.length)]
  const market = await resolveInitialMarket(selected)
  const room: Room = {
    hostId: `host_${randomUUID()}`,
    userIdByPhone: new Map(),
    lastMcAt: 0,
    mcPending: false,
    isTransitioning: false,
    state: {
      roomCode,
      createdAt: now,
      hostName,
      market,
      round: 1,
      roundStartedAt: now,
      settings: mergeSettings(defaultSettings(), requestedSettings),
      users: [],
      events: DEFAULT_EVENTS.map((event) => ({
        id: `event_${randomUUID()}`,
        title: event.title,
        reward: event.reward,
        active: true,
        createdAt: now,
        completedUserIds: [],
      })),
      products: PRODUCTS.map((product) => ({ ...product })),
      orders: [],
      mcLine: pick(MC_FALLBACKS.roundStart),
      notice: notice('round', 'Rally 시작', `${market.name} 라운드가 열렸어요.`),
    },
  }
  rooms.set(roomCode, room)
  activeRoomCode = roomCode
  void hydrateMarketHistory(room, market.symbol)
  void refreshMarket(room)
  return room
}

function activeRoom() {
  const room = activeRoomCode ? rooms.get(activeRoomCode) : undefined
  if (!room) activeRoomCode = undefined
  return room
}

function joinGuest(socket: Socket, room: Room, payload: Omit<JoinPayload, 'roomCode'>, ack?: (result: Ack) => void) {
  const phone = normalizePhone(payload?.phone)
  const nickname = cleanName(payload?.nickname, '')
  if (!phone || !nickname) return fail(socket, ack, '전화번호와 닉네임을 확인해 주세요.')

  let userId = room.userIdByPhone.get(phone)
  let user = userId ? findUser(room, userId) : undefined
  if (!user) {
    userId = `guest_${randomUUID()}`
    user = {
      id: userId,
      phone: '비공개',
      nickname,
      credit: 200,
      pnl: 0,
      joinedAt: Date.now(),
    }
    room.userIdByPhone.set(phone, user.id)
    room.state.users.push(user)
    announceMc(room, 'roundStart')
  } else {
    user.nickname = nickname
  }

  const session: Session = { roomCode: room.state.roomCode, userId: user.id, phone, nickname: user.nickname, isHost: false }
  attachSession(socket, session)
  room.state.notice = notice('event', '새 참가자', `${user.nickname}님이 함께해요.`)
  broadcast(room)
  ack?.({ ok: true, state: room.state, session })
}

function attachSession(socket: Socket, session: Session) {
  const previous = sessions.get(socket.id)
  if (previous && previous.roomCode !== session.roomCode) socket.leave(previous.roomCode)
  sessions.set(socket.id, session)
  socket.join(session.roomCode)
}

function getHostRoom(socket: Socket) {
  const session = sessions.get(socket.id)
  if (!session?.isHost) return undefined
  const room = rooms.get(session.roomCode)
  return room?.hostId === session.userId ? room : undefined
}

function getGuestContext(socket: Socket, requestedUserId: unknown): { room: Room; user: PartyUser } | undefined {
  const session = sessions.get(socket.id)
  if (!session || session.isHost || (requestedUserId && String(requestedUserId) !== session.userId)) return undefined
  const room = rooms.get(session.roomCode)
  const user = room && findUser(room, session.userId)
  return room && user ? { room, user } : undefined
}

function closePosition(
  socket: Socket,
  payload: { userId?: unknown; amount?: unknown; closeAll?: unknown },
  ack?: (result: Ack) => void,
) {
  const context = getGuestContext(socket, payload?.userId)
  if (!context) return fail(socket, ack, '참가자 세션을 확인해 주세요.')
  const position = context.user.position
  if (!position) return fail(socket, ack, '정산할 포지션이 없어요.')

  const closeAll = payload.closeAll === true || payload.amount === undefined
  const amount = closeAll ? position.amount : wholeNumber(payload.amount, 1, position.amount)
  if (!amount) return fail(socket, ack, '정산할 크레딧을 확인해 주세요.')

  const settlement = Math.max(0, Math.round(amount * (context.room.state.market.price / position.entryPrice)))
  const profit = settlement - amount
  const isFullClose = amount === position.amount
  context.user.credit += settlement
  if (isFullClose) {
    context.user.position = undefined
    context.user.pnl = 0
  } else {
    position.amount -= amount
    refreshPnls(context.room)
  }

  const item = notice(
    'settlement',
    isFullClose ? '포지션 정산' : '일부 정산',
    `${amount} 크레딧 매도 · 정산 ${settlement} 크레딧 (${profit >= 0 ? '+' : ''}${profit})`,
    context.user.id,
  )
  context.room.state.notice = item
  emitNoticeToUser(context.room, context.user.id, item)
  broadcast(context.room)
  ack?.({ ok: true, state: context.room.state })
}

function findUser(room: Room | undefined, userId: string | undefined) {
  return userId ? room?.state.users.find((user) => user.id === userId) : undefined
}

async function finishRound(room: Room, forcedByHost: boolean) {
  if (room.isTransitioning) return
  room.isTransitioning = true
  try {
  const settled = room.state.users
    .filter((user) => user.position)
    .map((user) => {
      const position = user.position as Position
      const settlement = Math.max(0, Math.round(position.amount * (room.state.market.price / position.entryPrice)))
      const profit = settlement - position.amount
      user.credit += settlement
      user.pnl = 0
      user.position = undefined
      const personalNotice = notice('settlement', '라운드 정산', `${profit >= 0 ? '+' : ''}${profit} 크레딧 · 정산 ${settlement} 크레딧`, user.id)
      emitNoticeToUser(room, user.id, personalNotice)
      return { user, profit }
    })

  const previousName = room.state.market.name
  await chooseNextMarket(room)
  room.state.round += 1
  room.state.roundStartedAt = Date.now()
  room.state.rallyActiveUntil = undefined
  room.state.lastRallyAt = undefined
  room.state.notice = notice('round', forcedByHost ? '다음 라운드' : '라운드 종료', `${previousName} 정산 완료 · ${room.state.market.name} 라운드 시작`)
  if (settled.length === 0) room.state.notice.body = `${previousName} 라운드 종료 · ${room.state.market.name} 시작`
  announceMc(room, 'roundEnd')
  broadcast(room)
  void refreshMarket(room)
  } finally {
    room.isTransitioning = false
  }
}

async function chooseNextMarket(room: Room) {
  const previousSymbol = room.state.market.symbol
  const candidates = MARKET_POOL.filter((market) => market.symbol !== previousSymbol)
  const selected = candidates[randomInt(candidates.length)]
  room.state.market = await resolveInitialMarket(selected)
  void hydrateMarketHistory(room, selected.symbol)
}

async function pollMarkets() {
  await Promise.all([...rooms.values()].map((room) => refreshMarket(room)))
}

async function refreshMarket(room: Room) {
  const market = room.state.market
  const updated = await pollMarketPrice(market)
  if (!updated) return
  refreshPnls(room)

  if (Math.abs(market.changeRate) >= 0.45) announceMc(room, 'priceMove')
  broadcast(room)
}

function connectUpbitTickerStream() {
  if (upbitTickerSocket && (upbitTickerSocket.readyState === WebSocket.OPEN || upbitTickerSocket.readyState === WebSocket.CONNECTING)) return

  try {
    const socket = new WebSocket(UPBIT_TICKER_WEBSOCKET_ENDPOINT)
    upbitTickerSocket = socket
    socket.on('open', () => {
      upbitReconnectDelayMs = 500
      try {
        socket.send(JSON.stringify([
          { ticket: `rally-${randomUUID()}` },
          { type: 'ticker', codes: MARKET_POOL.map((market) => market.symbol) },
          { format: 'SIMPLE' },
        ]))
      } catch {
        socket.terminate()
      }
    })
    socket.on('message', (data) => consumeUpbitTickerMessage(data))
    socket.on('error', () => undefined)
    socket.on('close', () => {
      if (upbitTickerSocket !== socket) return
      upbitTickerSocket = undefined
      scheduleUpbitStreamReconnect()
    })
  } catch {
    scheduleUpbitStreamReconnect()
  }
}

function scheduleUpbitStreamReconnect() {
  if (upbitReconnectTimer) return
  const delay = upbitReconnectDelayMs
  upbitReconnectDelayMs = Math.min(upbitReconnectDelayMs * 2, STREAM_RECONNECT_MAX_MS)
  upbitReconnectTimer = setTimeout(() => {
    upbitReconnectTimer = undefined
    connectUpbitTickerStream()
  }, delay)
  upbitReconnectTimer.unref()
}

function isUpbitStreamStale() {
  return lastUpbitStreamMessageAt === 0 || Date.now() - lastUpbitStreamMessageAt > STREAM_STALE_MS
}

function consumeUpbitTickerMessage(data: RawData) {
  const ticker = parseUpbitTicker(data)
  if (!ticker) return
  lastUpbitStreamMessageAt = Date.now()
  latestUpbitPrices.set(ticker.symbol, ticker.price)

  for (const room of rooms.values()) {
    if (room.state.market.symbol !== ticker.symbol) continue
    const market = room.state.market
    applyMarketPrice(market, ticker.price, 'upbit')
    refreshPnls(room)
    if (Math.abs(market.changeRate) >= 0.45) announceMc(room, 'priceMove')
    broadcast(room)
  }
}

export function parseUpbitTicker(data: RawData | string) {
  try {
    const message = JSON.parse(upbitMessageText(data)) as { code?: unknown; cd?: unknown; trade_price?: unknown; tp?: unknown }
    const symbol = String(message.code ?? message.cd ?? '').toUpperCase()
    const price = Number(message.trade_price ?? message.tp)
    if (!MARKET_POOL.some((market) => market.symbol === symbol) || !Number.isFinite(price) || price <= 0) return undefined
    return { symbol, price }
  } catch {
    return undefined
  }
}

function upbitMessageText(data: RawData | string) {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

export async function pollMarketPrice(market: Market, request: typeof fetch = fetch) {
  try {
    const price = await fetchUpbitTickerPrice(market.symbol, request)
    if (price === undefined) return false
    latestUpbitPrices.set(market.symbol, price)
    applyMarketPrice(market, price, 'upbit')
    return true
  } catch {
    return false
  }
}

export async function fetchUpbitTickerPrice(symbol: string, request: typeof fetch = fetch) {
  try {
    const response = await request(`${UPBIT_TICKER_ENDPOINT}?markets=${encodeURIComponent(symbol)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2_400),
    })
    if (!response.ok) return undefined
    const payload = (await response.json()) as Array<{ trade_price?: unknown }>
    const price = Number(payload[0]?.trade_price)
    return Number.isFinite(price) && price > 0 ? roundPrice(price) : undefined
  } catch {
    return undefined
  }
}

async function hydrateMarketHistory(room: Room, marketSymbol: string) {
  try {
    const response = await fetch(
      `${UPBIT_MINUTE_CANDLES_ENDPOINT}?market=${encodeURIComponent(marketSymbol)}&count=${INITIAL_HISTORY_POINTS}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3_000) },
    )
    if (!response.ok) throw new Error('upbit candle response unavailable')
    const payload = (await response.json()) as Array<{ trade_price?: unknown }>
    const closes = payload
      .map((candle) => roundPrice(Number(candle.trade_price)))
      .filter((price) => Number.isFinite(price) && price > 0)
      .reverse()
      .slice(-INITIAL_HISTORY_POINTS)
    if (closes.length < 8 || room.state.market.symbol !== marketSymbol) return

    const market = room.state.market
    const priorClose = closes.at(-2) ?? closes[0]
    if (market.source !== 'upbit') {
      market.previousPrice = priorClose
      market.price = closes.at(-1) ?? market.price
      market.changeRate = priorClose ? ((market.price - priorClose) / priorClose) * 100 : 0
      market.source = 'upbit'
    }
    market.history = [...closes.slice(-(INITIAL_HISTORY_POINTS - 1)), market.price].slice(-INITIAL_HISTORY_POINTS)
    refreshPnls(room)
    broadcast(room)
  } catch {
    // Keep the stable DEMO market untouched until public data becomes available.
  }
}

function applyMarketPrice(market: Market, incomingPrice: number, source: Market['source']) {
  const price = roundPrice(incomingPrice)
  const previousPrice = market.price
  market.previousPrice = previousPrice
  market.price = price
  market.changeRate = previousPrice ? ((price - previousPrice) / previousPrice) * 100 : 0
  market.source = source
  market.history = [...market.history, price].slice(-MAX_PRICE_HISTORY)
}

function refreshPnls(room: Room) {
  for (const user of room.state.users) {
    if (!user.position) continue
    user.pnl = Math.round(user.position.amount * ((room.state.market.price / user.position.entryPrice) - 1))
  }
}

function announceMc(room: Room, trigger: McTrigger) {
  const now = Date.now()
  const fallback = pick(MC_FALLBACKS[trigger])
  room.state.mcLine = fallback
  room.state.notice = notice('mc', 'Rally MC', fallback)

  if (!process.env.GEMINI_API_KEY || room.mcPending || now - room.lastMcAt < 8_000) return
  room.lastMcAt = now
  room.mcPending = true
  void generateMcLine(room, trigger, fallback).finally(() => {
    room.mcPending = false
  })
}

async function generateMcLine(room: Room, trigger: McTrigger, fallback: string) {
  try {
    const prompt = [
      '당신은 클럽 파티의 짧은 한국어 MC입니다.',
      '투자 조언, 수익 권유, 위험 경고를 하지 마세요.',
      '한 문장, 34자 이내로 분위기만 살리세요.',
      `상황: ${trigger}; 현재 종목: ${room.state.market.name}; 참가자: ${room.state.users.length}명.`,
    ].join(' ')
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY ?? '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 1, maxOutputTokens: 48 } }),
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return
    const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const line = cleanMcLine(body.candidates?.[0]?.content?.parts?.[0]?.text)
    if (!line) return
    room.state.mcLine = line
    room.state.notice = notice('mc', 'Rally MC', line)
    broadcast(room)
  } catch {
    room.state.mcLine = fallback
  }
}

function emitNoticeToUser(room: Room, userId: string, item: PartyNotice | undefined) {
  if (!item) return
  for (const [socketId, session] of sessions) {
    if (session.roomCode === room.state.roomCode && session.userId === userId) io.to(socketId).emit('party:notice', item)
  }
}

function broadcast(room: Room) {
  io.to(room.state.roomCode).emit('party:state', room.state)
}

function fail(socket: Socket, ack: ((result: Ack) => void) | undefined, message: string) {
  socket.emit('party:error', message)
  ack?.({ ok: false, error: message })
}

function fallbackMarket(symbol: string, name: string, fallbackPrice: number): Market {
  const initial = roundPrice(fallbackPrice)
  return {
    symbol,
    name,
    price: initial,
    previousPrice: initial,
    changeRate: 0,
    history: Array.from({ length: INITIAL_HISTORY_POINTS }, () => initial),
    source: 'fallback',
  }
}

export function marketFromActualPrice(symbol: string, name: string, price: number): Market {
  const actual = roundPrice(price)
  return {
    symbol,
    name,
    price: actual,
    previousPrice: actual,
    changeRate: 0,
    history: Array.from({ length: INITIAL_HISTORY_POINTS }, () => actual),
    source: 'upbit',
  }
}

async function resolveInitialMarket(selection: typeof MARKET_POOL[number]) {
  const cachedPrice = latestUpbitPrices.get(selection.symbol)
  if (cachedPrice !== undefined) return marketFromActualPrice(selection.symbol, selection.name, cachedPrice)

  const primedPrice = await fetchUpbitTickerPrice(selection.symbol)
  if (primedPrice !== undefined) {
    latestUpbitPrices.set(selection.symbol, primedPrice)
    return marketFromActualPrice(selection.symbol, selection.name, primedPrice)
  }
  return fallbackMarket(selection.symbol, selection.name, selection.fallbackPrice)
}

function mergeSettings(current: PartySettings, patch?: Partial<PartySettings>): PartySettings {
  return {
    roundSeconds: wholeNumber(patch?.roundSeconds, 20, 3_600) ?? current.roundSeconds,
    autoRoundEnabled: typeof patch?.autoRoundEnabled === 'boolean' ? patch.autoRoundEnabled : current.autoRoundEnabled,
    rallyThreshold: wholeNumber(patch?.rallyThreshold, 10, 50_000) ?? current.rallyThreshold,
    rallyCooldownSeconds: wholeNumber(patch?.rallyCooldownSeconds, 8, 1_800) ?? current.rallyCooldownSeconds,
  }
}

function defaultSettings(): PartySettings {
  return { roundSeconds: 600, autoRoundEnabled: false, rallyThreshold: 300, rallyCooldownSeconds: 75 }
}

function newRoomCode() {
  let code = ''
  do {
    code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('')
  } while (rooms.has(code))
  return code
}

function notice(type: PartyNotice['type'], title: string, body: string, targetUserId?: string): PartyNotice {
  return { id: `notice_${randomUUID()}`, type, title, body, createdAt: Date.now(), targetUserId }
}

function cleanName(value: unknown, fallback: string) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 18)
  return name || fallback
}

function cleanTitle(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 48)
}

function cleanMcLine(value: unknown) {
  const line = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 54)
  return line.length >= 4 ? line : undefined
}

function normalizePhone(value: unknown) {
  const phone = String(value ?? '').replace(/\D/g, '')
  return phone.length >= 9 && phone.length <= 14 ? phone : undefined
}

function wholeNumber(value: unknown, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  const number = Math.floor(parsed)
  return number >= min && number <= max ? number : undefined
}

function numberFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback
}

function roundPrice(value: number) {
  if (value >= 1_000) return Math.round(value)
  if (value >= 1) return Math.round(value * 100) / 100
  return Math.round(value * 100_000) / 100_000
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]
}

function callbackFrom(value: unknown, fallback?: (result: Ack) => void) {
  return typeof value === 'function' ? value as (result: Ack) => void : fallback
}

function hasHostPassword(value: unknown) {
  return typeof value === 'string' && value === HOST_PASSWORD
}
