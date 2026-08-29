import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Check,
  ChevronRight,
  Crown,
  ListOrdered,
  PartyPopper,
  Play,
  Settings2,
  Sparkles,
  TimerReset,
  X,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import type {
  PartyOrder,
  PartySettings,
  PartyState,
  PartyUser,
  Session,
} from '../types'
import './HostView.css'

export interface HostViewProps {
  party: PartyState
  session?: Session
  /** 테스트나 서버 시계 동기화용 현재 시각입니다. 생략하면 브라우저 시계를 사용합니다. */
  now?: number
  onTriggerRally?: () => void
  onNextRound?: () => void
  onUpdateSettings?: (settings: Partial<PartySettings>) => void
  onCreateEvent?: (title: string, reward: number) => void
  onRewardEvent?: (eventId: string, userId: string) => void
  onServeOrder?: (orderId: string) => void
}

const avatarPalette = ['#d2a8ff', '#8ab4ff', '#ffb8cd', '#7be6bc', '#ffcb82', '#b9b1ff']

function useCurrentTime(override?: number) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (override !== undefined) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [override])

  return override ?? now
}

function formatCredits(value: number) {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(value)))
}

function formatPrice(value: number) {
  const digits = value >= 100 ? 0 : value >= 1 ? 2 : 4
  return new Intl.NumberFormat('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

function formatTimer(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`
}

function getUserReturn(user: PartyUser, price: number) {
  if (!user.position || user.position.entryPrice <= 0) return 0
  return ((price - user.position.entryPrice) / user.position.entryPrice) * 100
}

function getLeaderboardValue(user: PartyUser, price: number) {
  if (!user.position) return user.credit + user.pnl
  return user.credit + user.pnl + user.position.amount * (price / user.position.entryPrice)
}

function userEmoji(index: number) {
  return ['✦', '●', '♟', '♥', '✳', '☽', '◉', '✺'][index % 8]
}

export function HostView({
  party,
  now: nowOverride,
  onTriggerRally,
  onNextRound,
  onUpdateSettings,
  onCreateEvent,
  onRewardEvent,
  onServeOrder,
}: HostViewProps) {
  const now = useCurrentTime(nowOverride)
  const reduceMotion = useReducedMotion()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [duration, setDuration] = useState(String(Math.round(party.settings.roundSeconds / 60)))
  const [eventTitle, setEventTitle] = useState('')
  const [eventReward, setEventReward] = useState('30')
  const [selectedUsers, setSelectedUsers] = useState<Record<string, string>>({})

  useEffect(() => {
    setDuration(String(Math.round(party.settings.roundSeconds / 60)))
  }, [party.settings.roundSeconds])

  const remainingSeconds = party.settings.roundSeconds - (now - party.roundStartedAt) / 1_000
  const investedCredits = party.users.reduce((total, user) => total + (user.position?.amount ?? 0), 0)
  const cooldownLeft = party.lastRallyAt
    ? Math.max(0, party.settings.rallyCooldownSeconds - (now - party.lastRallyAt) / 1_000)
    : 0
  const canRally = investedCredits >= party.settings.rallyThreshold && cooldownLeft <= 0
  const rallyHint = canRally
    ? '지금 터뜨리기'
    : cooldownLeft > 0
      ? `${Math.ceil(cooldownLeft)}초 뒤 다시 가능`
      : `${formatCredits(Math.max(0, party.settings.rallyThreshold - investedCredits))} 더 모이면 시작`

  const leaderboard = useMemo(
    () =>
      [...party.users]
        .sort((a, b) => getLeaderboardValue(b, party.market.price) - getLeaderboardValue(a, party.market.price))
        .slice(0, 8),
    [party.market.price, party.users],
  )
  const chartData = useMemo(
    () => party.market.history.map((value, index) => ({ index, value })),
    [party.market.history],
  )
  const signal = party.market.changeRate >= 0 ? 'up' : 'down'
  const joinPath = `/join/${encodeURIComponent(party.roomCode)}`
  const inviteUrl = typeof window === 'undefined'
    ? joinPath
    : `${window.location.origin}${joinPath}`
  const activeEvents = party.events.filter((event) => event.active)
  const pendingOrders = party.orders.filter((order) => !order.served)

  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const minutes = Number(duration)
    if (Number.isFinite(minutes) && minutes >= 1) {
      onUpdateSettings?.({ roundSeconds: Math.round(minutes * 60) })
    }
  }

  function submitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const reward = Number(eventReward)
    const title = eventTitle.trim()
    if (!title || !Number.isFinite(reward) || reward <= 0) return
    onCreateEvent?.(title, Math.round(reward))
    setEventTitle('')
    setEventReward('30')
  }

  function getOrderText(order: PartyOrder) {
    const product = party.products.find((item) => item.id === order.productId)
    const buyer = party.users.find((user) => user.id === order.buyerId)
    const recipient = party.users.find((user) => user.id === order.recipientId)
    if (buyer?.id === recipient?.id) return `${buyer?.nickname ?? '손님'} · ${product?.name ?? '상품'}`
    return `${buyer?.nickname ?? '손님'} → ${recipient?.nickname ?? '손님'} · ${product?.name ?? '상품'}`
  }

  return (
    <main className={`rally-host rally-host--${signal}`} aria-label="Rally 호스트 화면">
      <div className="rally-host__grain" aria-hidden="true" />
      <motion.div
        className="rally-host__aurora rally-host__aurora--violet"
        aria-hidden="true"
        animate={reduceMotion ? undefined : { x: [0, 24, -10, 0], y: [0, -12, 8, 0], scale: [1, 1.08, 0.98, 1] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="rally-host__aurora rally-host__aurora--rose"
        aria-hidden="true"
        animate={reduceMotion ? undefined : { x: [0, -20, 12, 0], y: [0, 10, -5, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />

      <header className="rally-host__topbar">
        <div className="rally-host__round">
          <span>ROUND {String(party.round).padStart(2, '0')}</span>
          <span className="rally-host__round-dot" />
          <span>{formatTimer(remainingSeconds)}</span>
        </div>
        <button
          className="rally-host__settings-trigger"
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="호스트 설정 열기"
        >
          <Settings2 size={16} strokeWidth={1.7} />
          <span>설정</span>
        </button>
      </header>

      <section className="rally-host__stage" aria-live="polite">
        <motion.h1
          className="rally-host__wordmark"
          initial={reduceMotion ? false : { opacity: 0, y: 26, rotate: -1.6 }}
          animate={{ opacity: 1, y: 0, rotate: -1.6 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          Rally
        </motion.h1>

        <div className="rally-host__market">
          <div className="rally-host__market-head">
            <span className="rally-host__market-name">{party.market.name}</span>
            <span className={`rally-host__source${party.market.source === 'fallback' ? ' rally-host__source--fallback' : ''}`}>
              {party.market.source === 'fallback' ? 'DEMO' : 'UPBIT'}
            </span>
          </div>
          <div className="rally-host__price-row">
            <span className="rally-host__currency">₩</span>
            <motion.strong
              key={party.market.price}
              className="rally-host__price"
              initial={reduceMotion ? false : { opacity: 0.3, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {formatPrice(party.market.price)}
            </motion.strong>
            <span className={`rally-host__change rally-host__change--${signal}`}>
              {party.market.changeRate >= 0 ? '+' : ''}{party.market.changeRate.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="rally-host__chart" aria-label={`${party.market.name} 가격 추이`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 24, right: 2, bottom: 2, left: 2 }}>
              <defs>
                <linearGradient id="rally-chart-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={signal === 'up' ? '#d2a8ff' : '#ff90aa'} stopOpacity={0.26} />
                  <stop offset="100%" stopColor={signal === 'up' ? '#8f6cff' : '#ff607b'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={signal === 'up' ? '#d7b4ff' : '#ff9aae'}
                strokeWidth={1.7}
                fill="url(#rally-chart-fill)"
                isAnimationActive={!reduceMotion}
                animationDuration={560}
                dot={false}
                activeDot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
          <span className="rally-host__chart-glint" aria-hidden="true" />
        </div>
      </section>

      <aside className="rally-host__leaderboard" aria-label="실시간 순위">
        <div className="rally-host__leaderboard-title">
          <ListOrdered size={15} strokeWidth={1.7} />
          <span>LIVE RANK</span>
          <span className="rally-host__participant-count">{party.users.length}</span>
        </div>
        <ol className="rally-host__rank-list">
          {leaderboard.map((user, index) => {
            const returnRate = getUserReturn(user, party.market.price)
            const rankValue = getLeaderboardValue(user, party.market.price)
            return (
              <li className="rally-host__rank" key={user.id}>
                <span className={`rally-host__rank-number${index === 0 ? ' rally-host__rank-number--first' : ''}`}>
                  {index === 0 ? <Crown size={15} fill="currentColor" strokeWidth={1.4} /> : index + 1}
                </span>
                <span
                  className="rally-host__avatar"
                  style={{ background: avatarPalette[index % avatarPalette.length] }}
                  aria-hidden="true"
                >
                  {userEmoji(index)}
                </span>
                <span className="rally-host__rank-person">
                  <span>{user.nickname}</span>
                  <small>{user.position ? `${formatCredits(user.position.amount)} 투자` : '관전 중'}</small>
                </span>
                <span className="rally-host__rank-value">
                  <strong>{formatCredits(rankValue)}</strong>
                  <small className={returnRate >= 0 ? 'is-up' : 'is-down'}>
                    {user.position ? `${returnRate >= 0 ? '+' : ''}${returnRate.toFixed(1)}%` : '—'}
                  </small>
                </span>
              </li>
            )
          })}
        </ol>
      </aside>

      <section className="rally-host__join-card" aria-label="파티 참여 정보">
        <QRCodeSVG
          value={inviteUrl}
          size={76}
          level="M"
          includeMargin={false}
          bgColor="#fbf8ff"
          fgColor="#120c15"
          className="rally-host__qr"
        />
        <div className="rally-host__join-copy">
          <span>파티 참여하기</span>
          <strong><span className="rally-host__join-people">●</span> {party.users.length}명</strong>
          <small>방 코드</small>
          <b>{party.roomCode}</b>
        </div>
        <div className="rally-host__join-divider" />
        <button
          className={`rally-host__rally-trigger${canRally ? ' is-ready' : ''}`}
          type="button"
          disabled={!canRally}
          onClick={onTriggerRally}
          aria-label={`Rally Moment ${rallyHint}`}
        >
          <PartyPopper size={17} strokeWidth={1.75} />
          <span>RALLY</span>
          <small>{rallyHint}</small>
        </button>
      </section>

      <footer className="rally-host__mc" aria-live="polite">
        <span className="rally-host__mc-label"><Sparkles size={13} /> AI MC</span>
        <p>{party.mcLine || '지금 우리, 같은 파도 위에 있어요.'}</p>
      </footer>

      <AnimatePresence>
        {party.rallyActiveUntil && party.rallyActiveUntil > now && (
          <motion.div
            className="rally-host__moment"
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.35 }}
          >
            <motion.div
              className="rally-host__moment-rings"
              animate={reduceMotion ? undefined : { scale: [0.72, 1.48], opacity: [0.9, 0] }}
              transition={{ duration: 1.35, repeat: Infinity, ease: 'easeOut' }}
            />
            <motion.div
              className="rally-host__moment-copy"
              initial={reduceMotion ? false : { scale: 0.72, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 240, damping: 18 }}
            >
              <PartyPopper size={28} />
              <strong>RALLY MOMENT!</strong>
              <span>지금 이 순간, 함께 뛰어요.</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            className="rally-host__dialog-backdrop"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setSettingsOpen(false)}
          >
            <motion.section
              className="rally-host__dialog"
              role="dialog"
              aria-modal="true"
              aria-label="호스트 설정"
              initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="rally-host__dialog-head">
                <div>
                  <span>HOST CONTROL</span>
                  <h2>파티 설정</h2>
                </div>
                <button type="button" onClick={() => setSettingsOpen(false)} aria-label="설정 닫기">
                  <X size={19} />
                </button>
              </header>

              <div className="rally-host__dialog-scroll">
                <form className="rally-host__round-form" onSubmit={submitSettings}>
                  <label htmlFor="round-minutes">라운드 시간</label>
                  <div>
                    <input
                      id="round-minutes"
                      type="number"
                      min="1"
                      max="60"
                      inputMode="numeric"
                      value={duration}
                      onChange={(event) => setDuration(event.target.value)}
                    />
                    <span>분</span>
                    <button type="submit">적용</button>
                  </div>
                </form>

                <button className="rally-host__next-round" type="button" onClick={onNextRound}>
                  <span><TimerReset size={17} /> 다음 라운드</span>
                  <ChevronRight size={17} />
                </button>

                <section className="rally-host__control-section">
                  <div className="rally-host__section-head">
                    <span>진행 이벤트</span>
                    <small>{activeEvents.length}개</small>
                  </div>
                  <form className="rally-host__event-form" onSubmit={submitEvent}>
                    <input
                      aria-label="이벤트 이름"
                      placeholder="예: 처음 보는 사람과 건배하기"
                      value={eventTitle}
                      onChange={(event) => setEventTitle(event.target.value)}
                    />
                    <input
                      aria-label="보상 크레딧"
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={eventReward}
                      onChange={(event) => setEventReward(event.target.value)}
                    />
                    <button type="submit" aria-label="이벤트 만들기"><Play size={14} fill="currentColor" /></button>
                  </form>
                  <div className="rally-host__event-list">
                    {activeEvents.length === 0 ? (
                      <p className="rally-host__empty">아직 진행 중인 이벤트가 없어요.</p>
                    ) : activeEvents.map((event) => {
                      const selectedUserId = selectedUsers[event.id] ?? party.users[0]?.id ?? ''
                      return (
                        <div className="rally-host__event-row" key={event.id}>
                          <div>
                            <strong>{event.title}</strong>
                            <span>+{formatCredits(event.reward)} 크레딧</span>
                          </div>
                          <select
                            aria-label={`${event.title} 완료 손님 선택`}
                            value={selectedUserId}
                            onChange={(input) => setSelectedUsers((current) => ({ ...current, [event.id]: input.target.value }))}
                          >
                            {party.users.map((user) => <option key={user.id} value={user.id}>{user.nickname}</option>)}
                          </select>
                          <button
                            type="button"
                            disabled={!selectedUserId}
                            onClick={() => onRewardEvent?.(event.id, selectedUserId)}
                          >
                            <Check size={14} /> 완료
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="rally-host__control-section">
                  <div className="rally-host__section-head">
                    <span>주문</span>
                    <small>{pendingOrders.length}건 대기</small>
                  </div>
                  <div className="rally-host__order-list">
                    {pendingOrders.length === 0 ? (
                      <p className="rally-host__empty">대기 중인 주문이 없어요.</p>
                    ) : pendingOrders.map((order) => (
                      <div className="rally-host__order-row" key={order.id}>
                        <span>{getOrderText(order)}</span>
                        <button type="button" onClick={() => onServeOrder?.(order.id)}>서빙 완료</button>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}

export default HostView
