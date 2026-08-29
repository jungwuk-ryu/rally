import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Gift,
  PackageCheck,
  Send,
  Sparkles,
  Tag,
  Trophy,
  X,
} from 'lucide-react'
import type { PartyNotice, PartyState, PartyUser, Session } from '../types'
import './GuestView.css'

export type GuestTab = 'invest' | 'products' | 'ranking'

export interface GuestViewProps {
  party: PartyState
  session: Session
  /** 현재 라운드 포지션을 엽니다. */
  onInvest?: (amount: number) => void
  /** @deprecated onInvest를 사용합니다. 통합 중인 호출부 호환용입니다. */
  onOpenPosition?: (amount: number) => void
  onTopUp: (amount: number) => void
  onOrder: (productId: string, recipientId: string) => void
  onTabChange?: (tab: GuestTab) => void
}

interface GuestToast {
  id: string
  icon: 'gift' | 'event' | 'round' | 'rally' | 'settlement' | 'default'
  title: string
  body?: string
}

const TOKEN_ICONS: Record<string, string> = {
  BTC: '₿',
  ETH: 'Ξ',
  XRP: '✕',
  SOL: '≋',
  DOGE: 'Ð',
}

const TOP_UP_VALUES = [100, 200, 500]
const INVEST_VALUES = [10, 30, 50, 100]

const formatCredit = (credit: number) => new Intl.NumberFormat('ko-KR').format(Math.max(0, Math.round(credit)))
const formatPrice = (price: number) => `₩ ${new Intl.NumberFormat('ko-KR').format(Math.round(price))}`

function getTokenIcon(symbol: string) {
  return TOKEN_ICONS[symbol.replace('KRW-', '')] ?? '◈'
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60)
  const seconds = Math.max(0, totalSeconds) % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function chartPoints(history: number[]) {
  const values = history.length > 1 ? history : [0, 0]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  return values
    .map((value, index) => {
      const x = 4 + (index / (values.length - 1)) * 92
      const y = 88 - ((value - min) / range) * 67
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

function noticeIcon(type: PartyNotice['type']): GuestToast['icon'] {
  if (type === 'gift') return 'gift'
  if (type === 'event') return 'event'
  if (type === 'round') return 'round'
  if (type === 'rally') return 'rally'
  if (type === 'settlement') return 'settlement'
  return 'default'
}

function ToastIcon({ kind }: { kind: GuestToast['icon'] }) {
  if (kind === 'gift') return <Gift aria-hidden="true" />
  if (kind === 'event') return <Sparkles aria-hidden="true" />
  if (kind === 'round' || kind === 'settlement') return <PackageCheck aria-hidden="true" />
  if (kind === 'rally') return <span className="guest-toast__rally">R</span>
  return <Check aria-hidden="true" />
}

function MarketChart({ history }: { history: number[] }) {
  const points = useMemo(() => chartPoints(history), [history])

  return (
    <svg className="guest-market__chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="가격 흐름">
      <defs>
        <linearGradient id="guestChartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.34" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="guest-market__grid" d="M 4 23 H 96 M 4 55 H 96 M 4 87 H 96" />
      <polygon className="guest-market__area" points={`4,88 ${points} 96,88`} />
      <polyline className="guest-market__line" points={points} />
      <circle className="guest-market__last-point" cx={points.split(' ').at(-1)?.split(',')[0]} cy={points.split(' ').at(-1)?.split(',')[1]} r="2.25" />
    </svg>
  )
}

function ProductPicker({
  product,
  guests,
  currentUser,
  onClose,
  onOrder,
}: {
  product: PartyState['products'][number]
  guests: PartyUser[]
  currentUser: PartyUser
  onClose: () => void
  onOrder: (recipientId: string) => void
}) {
  const [recipientId, setRecipientId] = useState(currentUser.id)
  const recipient = guests.find((guest) => guest.id === recipientId) ?? currentUser
  const canOrder = currentUser.credit >= product.price

  return (
    <motion.div
      className="guest-sheet__backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
    >
      <motion.section
        className="guest-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gift-sheet-title"
        initial={{ y: 56, opacity: 0.7 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 56, opacity: 0.7 }}
        transition={{ type: 'spring', stiffness: 330, damping: 29 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="guest-sheet__handle" />
        <button className="guest-icon-button guest-sheet__close" type="button" onClick={onClose} aria-label="닫기">
          <X size={18} />
        </button>
        <div className="guest-sheet__product">
          <span className="guest-product__emoji" style={{ background: product.accent }} aria-hidden="true">
            {product.emoji}
          </span>
          <div>
            <p>{product.name}</p>
            <strong>{formatCredit(product.price)} 크레딧</strong>
          </div>
        </div>
        <div className="guest-sheet__section-title">
          <span>누구에게 보낼까요?</span>
          <small>내게도 보낼 수 있어요</small>
        </div>
        <div className="guest-recipient-list">
          {guests.map((guest) => {
            const selected = guest.id === recipientId
            const isMe = guest.id === currentUser.id
            return (
              <button
                className={`guest-recipient ${selected ? 'is-selected' : ''}`}
                key={guest.id}
                type="button"
                onClick={() => setRecipientId(guest.id)}
              >
                <span className="guest-recipient__avatar">{guest.nickname.slice(0, 1)}</span>
                <span>{isMe ? '나' : guest.nickname}</span>
                {selected ? <Check size={17} aria-label="선택됨" /> : null}
              </button>
            )
          })}
        </div>
        <button
          className="guest-primary-button guest-sheet__submit"
          type="button"
          disabled={!canOrder}
          onClick={() => onOrder(recipient.id)}
        >
          <Send size={18} aria-hidden="true" />
          {canOrder ? `${recipient.id === currentUser.id ? '나에게' : `${recipient.nickname}님에게`} 보내기` : '크레딧이 부족해요'}
        </button>
      </motion.section>
    </motion.div>
  )
}

function TopUpSheet({ onClose, onTopUp }: { onClose: () => void; onTopUp: (amount: number) => void }) {
  const [amount, setAmount] = useState(200)

  return (
    <motion.div
      className="guest-sheet__backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
    >
      <motion.section
        className="guest-sheet guest-topup-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="topup-sheet-title"
        initial={{ y: 56, opacity: 0.7 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 56, opacity: 0.7 }}
        transition={{ type: 'spring', stiffness: 330, damping: 29 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="guest-sheet__handle" />
        <button className="guest-icon-button guest-sheet__close" type="button" onClick={onClose} aria-label="닫기">
          <X size={18} />
        </button>
        <div className="guest-topup-sheet__icon" aria-hidden="true">
          <CircleDollarSign size={27} />
        </div>
        <h2 id="topup-sheet-title">크레딧 추가</h2>
        <p>파티에서 쓸 크레딧을 더해요.</p>
        <div className="guest-topup-values">
          {TOP_UP_VALUES.map((value) => (
            <button
              className={amount === value ? 'is-selected' : ''}
              key={value}
              type="button"
              onClick={() => setAmount(value)}
            >
              +{formatCredit(value)}
            </button>
          ))}
        </div>
        <button className="guest-primary-button guest-sheet__submit" type="button" onClick={() => onTopUp(amount)}>
          {formatCredit(amount)} 크레딧 추가
        </button>
      </motion.section>
    </motion.div>
  )
}

export function GuestView({ party, session, onInvest, onOpenPosition, onTopUp, onOrder, onTabChange }: GuestViewProps) {
  const [tab, setTab] = useState<GuestTab>('invest')
  const [amount, setAmount] = useState('50')
  const [topUpOpen, setTopUpOpen] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [toast, setToast] = useState<GuestToast | null>(null)
  const [now, setNow] = useState(Date.now())
  const lastRound = useRef(party.round)

  const currentUser = party.users.find((user) => user.id === session.userId)
  const selectedProduct = party.products.find((product) => product.id === selectedProductId)
  const guests = useMemo(
    () => [...party.users].sort((first, second) => first.joinedAt - second.joinedAt),
    [party.users],
  )

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const notice = party.notice
    const isForCurrentUser = !notice?.targetUserId || notice.targetUserId === session.userId
    if (!notice || !isForCurrentUser) return

    setToast({ id: notice.id, icon: noticeIcon(notice.type), title: notice.title, body: notice.body })
  }, [party.notice, session.userId])

  useEffect(() => {
    if (lastRound.current === party.round) return
    lastRound.current = party.round
    setToast({
      id: `round-${party.round}`,
      icon: 'round',
      title: '새 라운드가 시작됐어요',
      body: `${party.market.name}로 함께 달려요`,
    })
  }, [party.market.name, party.round])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  if (!currentUser) {
    return (
      <main className="rally-guest rally-guest--empty">
        <div>
          <span className="rally-guest__wordmark">Rally</span>
          <h1>파티 정보를 불러오는 중이에요</h1>
        </div>
      </main>
    )
  }

  const amountNumber = Math.floor(Number(amount))
  const validAmount = Number.isFinite(amountNumber) && amountNumber > 0 && amountNumber <= currentUser.credit
  const hasPosition = Boolean(currentUser.position)
  const pnlRate = currentUser.position
    ? ((party.market.price - currentUser.position.entryPrice) / currentUser.position.entryPrice) * 100
    : 0
  const projectedCredit = currentUser.position ? currentUser.position.amount * (1 + pnlRate / 100) : 0
  const remainingSeconds = party.settings.roundSeconds - Math.floor((now - party.roundStartedAt) / 1000)
  const rankRows = [...party.users].sort((first, second) => second.credit + second.pnl - (first.credit + first.pnl))
  const currentRank = rankRows.findIndex((user) => user.id === currentUser.id) + 1
  const activeEvents = party.events.filter((event) => event.active && !event.completedUserIds.includes(currentUser.id))
  const rallyIsLive = Boolean(party.rallyActiveUntil && party.rallyActiveUntil > now)

  const changeText = `${party.market.changeRate >= 0 ? '+' : ''}${party.market.changeRate.toFixed(2)}%`
  const openPosition = onInvest ?? onOpenPosition
  const selectTab = (nextTab: GuestTab) => {
    setTab(nextTab)
    onTabChange?.(nextTab)
  }
  const submitInvest = () => {
    if (!validAmount) {
      setToast({ id: 'credit-warning', icon: 'default', title: '투자할 크레딧을 확인해요' })
      return
    }
    openPosition?.(amountNumber)
    setToast({ id: `invest-${Date.now()}`, icon: 'default', title: `${formatCredit(amountNumber)} 크레딧을 담았어요` })
  }
  const finishTopUp = (value: number) => {
    onTopUp(value)
    setTopUpOpen(false)
    setToast({ id: `topup-${Date.now()}`, icon: 'default', title: `${formatCredit(value)} 크레딧을 더했어요` })
  }
  const finishOrder = (productId: string, recipientId: string) => {
    const product = party.products.find((item) => item.id === productId)
    const recipient = party.users.find((user) => user.id === recipientId)
    onOrder(productId, recipientId)
    setSelectedProductId(null)
    setToast({
      id: `order-${Date.now()}`,
      icon: 'gift',
      title: recipientId === currentUser.id ? `${product?.name ?? '상품'}을 주문했어요` : `${recipient?.nickname ?? '친구'}님에게 보냈어요`,
    })
  }

  return (
    <main className="rally-guest">
      <section className="rally-guest__shell" aria-label="Rally 파티">
        <header className="rally-guest__header">
          <span className="rally-guest__wordmark">Rally</span>
          <div className="rally-guest__room" title={`방 코드 ${party.roomCode}`}>
            <span>{party.roomCode}</span>
            <ChevronDown size={18} aria-hidden="true" />
          </div>
          <button className="guest-credit" type="button" onClick={() => setTopUpOpen(true)} aria-label="크레딧 추가">
            <span className="guest-credit__coin">C</span>
            <strong>{formatCredit(currentUser.credit)}</strong>
            <span>크레딧</span>
          </button>
        </header>

        <motion.section
          className={`guest-market ${party.market.changeRate < 0 ? 'is-down' : ''}`}
          aria-label={`현재 종목 ${party.market.name}`}
          animate={{ scale: [1, 1.006, 1] }}
          transition={{ duration: 0.72, ease: 'easeOut' }}
          key={`${party.market.symbol}-${party.market.price}`}
        >
          <div className="guest-market__texture" aria-hidden="true" />
          <div className="guest-market__topline">
            <span className="guest-market__token">{getTokenIcon(party.market.symbol)}</span>
            <div>
              <span className="guest-market__name">{party.market.name}</span>
              <span className="guest-market__symbol">{party.market.symbol}</span>
            </div>
            <span className="guest-market__timer">{formatTime(remainingSeconds)}</span>
          </div>
          <div className="guest-market__price-row">
            <strong>{formatPrice(party.market.price)}</strong>
            <span className={`guest-market__change ${party.market.changeRate < 0 ? 'is-down' : ''}`}>
              <ArrowUpRight size={16} aria-hidden="true" />
              {changeText}
            </span>
          </div>
          <MarketChart history={party.market.history} />
        </motion.section>

        <AnimatePresence mode="wait">
          {tab === 'invest' ? (
            <motion.div key="invest" className="guest-tab-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <section className="guest-position" aria-label="내 투자">
                <div className="guest-position__amount">
                  <span>내 투자</span>
                  <strong>{hasPosition ? `${formatCredit(currentUser.position?.amount ?? 0)} 크레딧` : '아직 없어요'}</strong>
                </div>
                <div className="guest-position__details">
                  <div>
                    <span className="guest-detail__icon"><Tag size={15} /></span>
                    <span>진입가</span>
                    <strong>{hasPosition ? formatPrice(currentUser.position?.entryPrice ?? 0) : '—'}</strong>
                  </div>
                  <div>
                    <span className="guest-detail__icon"><CalendarDays size={15} /></span>
                    <span>예상 정산</span>
                    <strong className={pnlRate >= 0 ? 'is-profit' : 'is-loss'}>{hasPosition ? `${formatCredit(projectedCredit)} C · ${pnlRate >= 0 ? '+' : ''}${pnlRate.toFixed(1)}%` : '—'}</strong>
                  </div>
                </div>
              </section>

              {!hasPosition ? (
                <section className="guest-invest-panel" aria-labelledby="guest-invest-heading">
                  <div>
                    <h1 id="guest-invest-heading">같이 뛰어들어요</h1>
                    <p>이번 라운드는 {formatTime(remainingSeconds)} 남았어요</p>
                  </div>
                  <div className="guest-invest-panel__controls">
                    <label>
                      <span className="sr-only">투자할 크레딧</span>
                      <input
                        inputMode="numeric"
                        type="number"
                        min="1"
                        max={currentUser.credit}
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                      />
                      <span>크레딧</span>
                    </label>
                    <div className="guest-invest-panel__quick-values">
                      {INVEST_VALUES.map((value) => (
                        <button key={value} type="button" onClick={() => setAmount(String(Math.min(value, currentUser.credit)))}>
                          +{value}
                        </button>
                      ))}
                      <button type="button" onClick={() => setAmount(String(Math.floor(currentUser.credit)))}>전부</button>
                    </div>
                    <button className="guest-primary-button" type="button" onClick={submitInvest} disabled={!validAmount}>
                      투자하기
                    </button>
                  </div>
                </section>
              ) : null}

              {activeEvents.length > 0 ? (
                <section className="guest-events" aria-labelledby="guest-events-heading">
                  <div className="guest-section-heading">
                    <div>
                      <h2 id="guest-events-heading">진행 중인 이벤트</h2>
                      <p>호스트가 확인하면 보상이 들어와요</p>
                    </div>
                    <Sparkles size={21} aria-hidden="true" />
                  </div>
                  {activeEvents.map((event) => (
                    <article className="guest-event" key={event.id}>
                      <span className="guest-event__sparkle" aria-hidden="true">✦</span>
                      <div>
                        <strong>{event.title}</strong>
                        <span>완료 보상 +{formatCredit(event.reward)} C</span>
                      </div>
                    </article>
                  ))}
                </section>
              ) : null}
            </motion.div>
          ) : null}

          {tab === 'products' ? (
            <motion.div key="products" className="guest-tab-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <section className="guest-products" aria-labelledby="guest-products-heading">
                <div className="guest-section-heading guest-section-heading--products">
                  <div>
                    <h1 id="guest-products-heading">상품</h1>
                    <p>크레딧으로 마음을 전해요</p>
                  </div>
                  <Gift size={23} aria-hidden="true" />
                </div>
                <div className="guest-product-list">
                  {party.products.map((product) => (
                    <article className="guest-product" key={product.id}>
                      <div className="guest-product__visual" style={{ background: product.accent }} aria-hidden="true">
                        {product.emoji}
                      </div>
                      <div className="guest-product__info">
                        <div>
                          <h2>{product.name}</h2>
                          <p>{product.description}</p>
                        </div>
                        <strong>{formatCredit(product.price)} C</strong>
                      </div>
                      <button className="guest-product__send" type="button" onClick={() => setSelectedProductId(product.id)}>
                        <Send size={16} aria-hidden="true" />
                        보내기
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            </motion.div>
          ) : null}

          {tab === 'ranking' ? (
            <motion.div key="ranking" className="guest-tab-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <section className="guest-ranking" aria-labelledby="guest-ranking-heading">
                <div className="guest-ranking__hero">
                  <span>내 순위</span>
                  <strong>{currentRank}<small>위</small></strong>
                  <p>{formatCredit(currentUser.credit + currentUser.pnl)} 크레딧</p>
                  <Trophy size={28} aria-hidden="true" />
                </div>
                <h1 id="guest-ranking-heading">지금 순위</h1>
                <ol className="guest-ranking__list">
                  {rankRows.map((user, index) => {
                    const isCurrentUser = user.id === currentUser.id
                    return (
                      <li className={isCurrentUser ? 'is-me' : ''} key={user.id}>
                        <span className={`guest-ranking__number rank-${index + 1}`}>{index + 1}</span>
                        <span className="guest-ranking__avatar">{user.nickname.slice(0, 1)}</span>
                        <strong>{isCurrentUser ? '나' : user.nickname}</strong>
                        <span>{formatCredit(user.credit + user.pnl)} C</span>
                      </li>
                    )
                  })}
                </ol>
              </section>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>

      <nav className="guest-tabs" aria-label="손님 메뉴">
        <button className={tab === 'invest' ? 'is-active' : ''} type="button" onClick={() => selectTab('invest')}>
          <ArrowUpRight size={24} aria-hidden="true" />
          <span>투자</span>
        </button>
        <button className={tab === 'products' ? 'is-active' : ''} type="button" onClick={() => selectTab('products')}>
          <Gift size={24} aria-hidden="true" />
          <span>상품</span>
        </button>
        <button className={tab === 'ranking' ? 'is-active' : ''} type="button" onClick={() => selectTab('ranking')}>
          <Trophy size={24} aria-hidden="true" />
          <span>순위</span>
        </button>
      </nav>

      <AnimatePresence>
        {toast ? (
          <motion.div
            className="guest-toast"
            role="status"
            initial={{ opacity: 0, y: 24, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 24, x: '-50%' }}
          >
            <span className={`guest-toast__icon is-${toast.icon}`}><ToastIcon kind={toast.icon} /></span>
            <div>
              <strong>{toast.title}</strong>
              {toast.body ? <span>{toast.body}</span> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {rallyIsLive ? (
          <motion.div className="guest-rally-moment" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.span animate={{ scale: [0.9, 1.12, 1], rotate: [-2, 2, 0] }} transition={{ duration: 0.7 }}>RALLY</motion.span>
            <p>지금, 함께 달려요</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {selectedProduct && currentUser ? (
          <ProductPicker
            product={selectedProduct}
            guests={guests}
            currentUser={currentUser}
            onClose={() => setSelectedProductId(null)}
            onOrder={(recipientId) => finishOrder(selectedProduct.id, recipientId)}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {topUpOpen ? <TopUpSheet onClose={() => setTopUpOpen(false)} onTopUp={finishTopUp} /> : null}
      </AnimatePresence>
    </main>
  )
}
