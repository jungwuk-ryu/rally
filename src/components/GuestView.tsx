import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  Gift,
  LockKeyhole,
  LoaderCircle,
  Minus,
  PackageCheck,
  Plus,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  Tag,
  Trophy,
  X,
} from 'lucide-react'
import type { PartyNotice, PartyState, PartyUser, Session } from '../types'
import './GuestView.css'

export type GuestTab = 'invest' | 'products' | 'ranking'
type PositionAction = 'add' | 'close'
type GuestAction = (amount: number) => Promise<boolean> | boolean

export interface GuestViewProps {
  party: PartyState
  session: Session
  /** 단일 파티 흐름에서는 방 코드 대신 짧은 상태 라벨만 보여 줍니다. */
  partyLabel?: string
  /** 방 코드가 필요한 초대 흐름에서만 켭니다. 기본값은 false입니다. */
  showRoomCode?: boolean
  /** 현재 라운드 포지션을 엽니다. */
  onInvest?: GuestAction
  /** @deprecated onInvest를 사용합니다. 통합 중인 호출부 호환용입니다. */
  onOpenPosition?: GuestAction
  /** 보유 포지션에 현재 가격으로 크레딧을 더합니다. */
  onAddPosition?: GuestAction
  /** 포지션에서 요청 크레딧만큼 정리합니다. */
  onClosePosition?: GuestAction
  onTopUp: GuestAction
  onOrder: (productId: string, recipientId: string) => Promise<boolean> | boolean
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
const CREDIT_VALUE_WON = 10
const TOP_UP_CARDS = [
  { id: 'rally-card', title: 'Rally 카드', detail: '•••• 2407', tone: 'violet' },
  { id: 'party-card', title: '파티 카드', detail: '•••• 8841', tone: 'blue' },
] as const
const INVEST_VALUES = [10, 30, 50, 100]
const PRODUCT_MEDIA: Record<string, string> = {
  highball: '/products/highball.png',
  beer: '/products/beer.png',
  shot: '/products/shot.png',
  snack: '/products/snack.png',
}
const PRODUCT_CATEGORIES = [
  { id: 'all', label: '전체' },
  { id: 'drink', label: '주류' },
  { id: 'food', label: '안주' },
] as const

type ProductCategory = typeof PRODUCT_CATEGORIES[number]['id']

const formatCredit = (credit: number) => new Intl.NumberFormat('ko-KR').format(Math.max(0, Math.round(credit)))
const formatPrice = (price: number) => `₩ ${new Intl.NumberFormat('ko-KR').format(Math.round(price))}`
const formatWon = (value: number) => `₩${new Intl.NumberFormat('ko-KR').format(value)}`
const totalAssets = (user: PartyUser) => user.credit + (user.position ? user.position.amount + user.pnl : 0)

function getTokenIcon(symbol: string) {
  return TOKEN_ICONS[symbol.replace('KRW-', '')] ?? '◈'
}

function productImage(productId: string) {
  return PRODUCT_MEDIA[productId] ?? '/products/highball.png'
}

function productCategory(productId: string): Exclude<ProductCategory, 'all'> {
  return productId === 'snack' ? 'food' : 'drink'
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
  onOrder: (recipientId: string) => Promise<boolean>
}) {
  const [recipientId, setRecipientId] = useState(currentUser.id)
  const [submitting, setSubmitting] = useState(false)
  const recipient = guests.find((guest) => guest.id === recipientId) ?? currentUser
  const canOrder = currentUser.credit >= product.price

  const submitOrder = async () => {
    if (!canOrder || submitting) return
    setSubmitting(true)
    await onOrder(recipient.id)
    setSubmitting(false)
  }

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
          <img className="guest-sheet__product-image" src={productImage(product.id)} alt="" />
          <div>
            <p>{product.name}</p>
            <strong>{formatCredit(product.price)} 크레딧</strong>
          </div>
        </div>
        <div className="guest-sheet__section-title">
          <span>누구에게 드릴까요?</span>
          <small>나에게 주문하거나 파티 친구에게 선물할 수 있어요</small>
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
          disabled={!canOrder || submitting}
          onClick={() => void submitOrder()}
        >
          <ShoppingBag size={18} aria-hidden="true" />
          {submitting ? '결제 중이에요' : canOrder ? `결제하기 · ${formatCredit(product.price)} C` : '크레딧이 부족해요'}
        </button>
        {!canOrder ? <p className="guest-sheet__credit-warning" role="alert">{formatCredit(product.price)} C가 필요해요. 지금은 {formatCredit(currentUser.credit)} C를 쓸 수 있어요.</p> : null}
      </motion.section>
    </motion.div>
  )
}

type TopUpStep = 'select' | 'confirm' | 'authorizing' | 'success'

function TopUpSheet({ onClose, onTopUp }: { onClose: () => void; onTopUp: (amount: number) => Promise<boolean> }) {
  const [amount, setAmount] = useState(200)
  const [cardId, setCardId] = useState<(typeof TOP_UP_CARDS)[number]['id']>(TOP_UP_CARDS[0].id)
  const [step, setStep] = useState<TopUpStep>('select')
  const [failure, setFailure] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const selectedCard = TOP_UP_CARDS.find((card) => card.id === cardId) ?? TOP_UP_CARDS[0]
  const paymentAmount = amount * CREDIT_VALUE_WON
  const isAuthorizing = step === 'authorizing'

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  const closeSheet = () => {
    if (!isAuthorizing) onClose()
  }

  const chooseAmount = (nextAmount: number) => {
    if (isAuthorizing) return
    setAmount(nextAmount)
    setFailure(null)
  }

  const continueToConfirm = () => {
    setFailure(null)
    setStep('confirm')
  }

  const approve = async () => {
    if (isAuthorizing) return

    setFailure(null)
    setStep('authorizing')
    const [completed] = await Promise.all([
      Promise.resolve(onTopUp(amount)).catch(() => false),
      new Promise<void>((resolve) => window.setTimeout(resolve, 940)),
    ])

    if (!mountedRef.current) return
    if (completed) {
      setStep('success')
      return
    }

    setStep('confirm')
    setFailure('승인이 되지 않았어요. 잠시 후 다시 시도해요.')
  }

  return (
    <motion.div
      className="guest-sheet__backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={closeSheet}
    >
      <motion.section
        className={`guest-sheet guest-topup-sheet is-${step}`}
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
        {!isAuthorizing ? (
          <button className="guest-icon-button guest-sheet__close" type="button" onClick={closeSheet} aria-label="닫기">
            <X size={18} />
          </button>
        ) : null}

        <AnimatePresence mode="wait" initial={false}>
          {step === 'select' ? (
            <motion.div
              className="guest-topup-flow"
              key="select"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
            >
              <div className="guest-topup-sheet__icon" aria-hidden="true">
                <CircleDollarSign size={27} />
              </div>
              <h2 id="topup-sheet-title">크레딧 충전</h2>
              <p>원하는 금액과 결제 수단을 골라요.</p>

              <div className="guest-topup-values" aria-label="충전 금액">
                {TOP_UP_VALUES.map((value) => (
                  <button
                    className={amount === value ? 'is-selected' : ''}
                    key={value}
                    type="button"
                    onClick={() => chooseAmount(value)}
                  >
                    <strong>+{formatCredit(value)} C</strong>
                    <small>{formatWon(value * CREDIT_VALUE_WON)}</small>
                  </button>
                ))}
              </div>

              <div className="guest-topup-payment-heading">
                <span>결제 수단</span>
                <small>가상 결제</small>
              </div>
              <div className="guest-topup-cards" role="radiogroup" aria-label="결제 수단">
                {TOP_UP_CARDS.map((card) => {
                  const selected = card.id === cardId
                  return (
                    <button
                      aria-checked={selected}
                      className={`guest-topup-card ${selected ? 'is-selected' : ''}`}
                      key={card.id}
                      role="radio"
                      type="button"
                      onClick={() => {
                        setCardId(card.id)
                        setFailure(null)
                      }}
                    >
                      <span className={`guest-topup-card__mark is-${card.tone}`}><CreditCard size={18} /></span>
                      <span><strong>{card.title}</strong><small>{card.detail}</small></span>
                      <span className="guest-topup-card__check" aria-hidden="true">{selected ? <Check size={14} /> : null}</span>
                    </button>
                  )
                })}
              </div>

              <button className="guest-primary-button guest-sheet__submit" type="button" onClick={continueToConfirm}>
                결제 확인
              </button>
              <p className="guest-topup-sheet__notice"><LockKeyhole size={13} aria-hidden="true" /> 실제로 청구되지 않는 시연용 결제예요.</p>
            </motion.div>
          ) : null}

          {step === 'confirm' ? (
            <motion.div
              className="guest-topup-flow"
              key="confirm"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
            >
              <button className="guest-topup-back" type="button" onClick={() => setStep('select')}>
                <ChevronLeft size={18} aria-hidden="true" /> 수정
              </button>
              <div className="guest-topup-sheet__icon is-confirm" aria-hidden="true">
                <CreditCard size={27} />
              </div>
              <h2 id="topup-sheet-title">결제 확인</h2>
              <p>아래 내용을 확인해요.</p>

              <dl className="guest-topup-receipt">
                <div><dt>충전 크레딧</dt><dd>+{formatCredit(amount)} C</dd></div>
                <div><dt>결제 수단</dt><dd>{selectedCard.title} {selectedCard.detail}</dd></div>
                <div><dt>결제 금액</dt><dd>{formatWon(paymentAmount)}</dd></div>
              </dl>
              {failure ? <p className="guest-topup-error" role="alert">{failure}</p> : null}
              <button className="guest-primary-button guest-sheet__submit" type="button" onClick={() => void approve()}>
                {formatWon(paymentAmount)} 결제 승인
              </button>
              <p className="guest-topup-sheet__notice"><LockKeyhole size={13} aria-hidden="true" /> 실제로 청구되지 않는 시연용 결제예요.</p>
            </motion.div>
          ) : null}

          {step === 'authorizing' ? (
            <motion.div
              className="guest-topup-flow guest-topup-flow--status"
              key="authorizing"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
            >
              <div className="guest-topup-authorizing" aria-hidden="true">
                <span className="guest-topup-authorizing__ring" />
                <LoaderCircle size={31} />
              </div>
              <h2 id="topup-sheet-title">결제 승인 중</h2>
              <p>{selectedCard.title}로 안전하게 확인하고 있어요.</p>
              <span className="guest-topup-status-amount">{formatWon(paymentAmount)}</span>
            </motion.div>
          ) : null}

          {step === 'success' ? (
            <motion.div
              className="guest-topup-flow guest-topup-flow--status"
              key="success"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
            >
              <motion.div
                className="guest-topup-success"
                initial={{ scale: 0.55 }}
                animate={{ scale: [0.55, 1.08, 1] }}
                transition={{ duration: 0.42, ease: 'easeOut' }}
                aria-hidden="true"
              >
                <Check size={32} />
              </motion.div>
              <h2 id="topup-sheet-title">충전 완료</h2>
              <strong className="guest-topup-success__amount">+{formatCredit(amount)} C</strong>
              <p>파티 크레딧에 바로 반영됐어요.</p>
              <button className="guest-primary-button guest-sheet__submit" type="button" onClick={onClose}>완료</button>
              <p className="guest-topup-sheet__notice"><LockKeyhole size={13} aria-hidden="true" /> 시연용 결제예요. 실제로 청구되지 않았어요.</p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.section>
    </motion.div>
  )
}

function PositionActionSheet({
  action,
  availableCredit,
  positionAmount,
  onClose,
  onSubmit,
}: {
  action: PositionAction
  availableCredit: number
  positionAmount: number
  onClose: () => void
  onSubmit: (amount: number) => Promise<boolean>
}) {
  const maxAmount = Math.max(0, Math.floor(action === 'add' ? availableCredit : positionAmount))
  const [amount, setAmount] = useState(() => String(Math.min(action === 'add' ? 50 : maxAmount, maxAmount)))
  const [submitting, setSubmitting] = useState(false)
  const amountNumber = Math.floor(Number(amount))
  const validAmount = Number.isFinite(amountNumber) && amountNumber > 0 && amountNumber <= maxAmount
  const closePresets = [25, 50, 75].map((ratio) => ({
    label: `${ratio}%`,
    value: Math.max(1, Math.floor(maxAmount * (ratio / 100))),
  }))
  const presets = action === 'add'
    ? INVEST_VALUES.filter((value) => value <= maxAmount).map((value) => ({ label: `+${value}`, value }))
    : closePresets

  const submit = async (nextAmount = amountNumber) => {
    if (submitting || !Number.isFinite(nextAmount) || nextAmount < 1 || nextAmount > maxAmount) return
    setSubmitting(true)
    const completed = await onSubmit(nextAmount)
    setSubmitting(false)
    if (completed) onClose()
  }

  const title = action === 'add' ? '추가 투자' : '포지션 정리'
  const description = action === 'add'
    ? `보유 크레딧 ${formatCredit(availableCredit)} C`
    : `현재 투자 ${formatCredit(positionAmount)} C`

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
        className="guest-sheet guest-position-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="position-sheet-title"
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
        <div className={`guest-position-sheet__icon is-${action}`} aria-hidden="true">
          {action === 'add' ? <Plus size={26} /> : <Minus size={26} />}
        </div>
        <h2 id="position-sheet-title">{title}</h2>
        <p>{description}</p>
        <label className="guest-position-sheet__input">
          <span>{action === 'add' ? '더할 크레딧' : '정리할 크레딧'}</span>
          <div>
            <input
              inputMode="numeric"
              type="number"
              min="1"
              max={maxAmount}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <strong>C</strong>
          </div>
        </label>
        <div className="guest-position-sheet__presets">
          {presets.map((preset) => (
            <button key={preset.label} type="button" onClick={() => setAmount(String(preset.value))}>
              {preset.label}
            </button>
          ))}
          <button type="button" onClick={() => setAmount(String(maxAmount))}>전부</button>
        </div>
        {action === 'close' ? (
          <button
            className="guest-position-sheet__all"
            type="button"
            disabled={!maxAmount || submitting}
            onClick={() => void submit(maxAmount)}
          >
            전량 매도
          </button>
        ) : null}
        <button
          className="guest-primary-button guest-sheet__submit"
          type="button"
          disabled={!validAmount || submitting}
          onClick={() => void submit()}
        >
          {submitting ? '처리 중이에요' : action === 'add' ? '추가 투자하기' : '일부 매도하기'}
        </button>
      </motion.section>
    </motion.div>
  )
}

export function GuestView({
  party,
  session,
  partyLabel = '파티 진행 중',
  showRoomCode = false,
  onInvest,
  onOpenPosition,
  onAddPosition,
  onClosePosition,
  onTopUp,
  onOrder,
  onTabChange,
}: GuestViewProps) {
  const [tab, setTab] = useState<GuestTab>('invest')
  const [amount, setAmount] = useState('50')
  const [topUpOpen, setTopUpOpen] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [selectedProductCategory, setSelectedProductCategory] = useState<ProductCategory>('all')
  const [positionAction, setPositionAction] = useState<PositionAction | null>(null)
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
  const roundStatus = party.settings.autoRoundEnabled ? formatTime(remainingSeconds) : '수동 진행'
  const rankRows = [...party.users].sort((first, second) => totalAssets(second) - totalAssets(first))
  const currentRank = rankRows.findIndex((user) => user.id === currentUser.id) + 1
  const activeEvents = party.events.filter((event) => event.active && !event.completedUserIds.includes(currentUser.id))
  const rallyIsLive = Boolean(party.rallyActiveUntil && party.rallyActiveUntil > now)

  const changeText = `${party.market.changeRate >= 0 ? '+' : ''}${party.market.changeRate.toFixed(2)}%`
  const openPosition = onInvest ?? onOpenPosition
  const addPosition = onAddPosition ?? openPosition
  const selectTab = (nextTab: GuestTab) => {
    setTab(nextTab)
    onTabChange?.(nextTab)
  }
  const submitInvest = async () => {
    if (!validAmount) {
      setToast({ id: 'credit-warning', icon: 'default', title: '투자할 크레딧을 확인해요' })
      return
    }
    const completed = await Promise.resolve(openPosition?.(amountNumber) ?? false)
    if (!completed) return
    setToast({ id: `invest-${Date.now()}`, icon: 'default', title: `${formatCredit(amountNumber)} 크레딧을 담았어요` })
  }
  const finishPositionAction = async (action: PositionAction, nextAmount: number) => {
    const callback = action === 'add' ? addPosition : onClosePosition
    const completed = await Promise.resolve(callback?.(nextAmount) ?? false)
    if (!completed) return false
    setToast({
      id: `${action}-${Date.now()}`,
      icon: 'default',
      title: action === 'add' ? `${formatCredit(nextAmount)} 크레딧을 더했어요` : `${formatCredit(nextAmount)} 크레딧을 정리했어요`,
    })
    return true
  }
  const finishTopUp = async (value: number) => {
    const completed = await Promise.resolve(onTopUp(value))
    if (!completed) return false
    setToast({ id: `topup-${Date.now()}`, icon: 'default', title: `${formatCredit(value)} 크레딧을 더했어요` })
    return true
  }
  const finishOrder = async (productId: string, recipientId: string) => {
    const product = party.products.find((item) => item.id === productId)
    const recipient = party.users.find((user) => user.id === recipientId)
    const completed = await Promise.resolve(onOrder(productId, recipientId))
    if (!completed) return false
    setSelectedProductId(null)
    setToast({
      id: `order-${Date.now()}`,
      icon: 'gift',
      title: recipientId === currentUser.id ? `${product?.name ?? '상품'}을 주문했어요` : `${recipient?.nickname ?? '친구'}님에게 보냈어요`,
      body: `${formatCredit(product?.price ?? 0)} C를 사용했어요. 주문이 접수됐어요.`,
    })
    return true
  }
  const visibleProducts = party.products.filter((product) => selectedProductCategory === 'all' || productCategory(product.id) === selectedProductCategory)
  const personalOrders = party.orders.filter((order) => order.buyerId === currentUser.id || order.recipientId === currentUser.id).slice(0, 3)

  return (
    <main className="rally-guest">
      <section className="rally-guest__shell" aria-label="Rally 파티">
        <header className={`rally-guest__header ${showRoomCode ? '' : 'is-single-party'}`}>
          <span className="rally-guest__wordmark">Rally</span>
          {showRoomCode ? (
            <div className="rally-guest__room" title={`방 코드 ${party.roomCode}`}>
              <span>{party.roomCode}</span>
              <ChevronDown size={18} aria-hidden="true" />
            </div>
          ) : (
            <span className="rally-guest__party-label"><i aria-hidden="true" />{partyLabel}</span>
          )}
          <button className="guest-credit" type="button" onClick={() => setTopUpOpen(true)} aria-label="크레딧 추가">
            <span className="guest-credit__coin">C</span>
            <strong>{formatCredit(currentUser.credit)}</strong>
            <span>크레딧</span>
          </button>
        </header>

        {tab !== 'products' ? (
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
              <span className={`guest-market__timer ${party.settings.autoRoundEnabled ? '' : 'is-manual'}`}>{roundStatus}</span>
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
        ) : null}

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

              {hasPosition ? (
                <section className="guest-position-actions" aria-label="포지션 조작">
                  <button type="button" onClick={() => setPositionAction('add')}>
                    <span className="guest-position-actions__icon is-add"><Plus size={17} /></span>
                    <span><strong>추가 투자</strong><small>보유 {formatCredit(currentUser.credit)} C</small></span>
                  </button>
                  <button type="button" onClick={() => setPositionAction('close')}>
                    <span className="guest-position-actions__icon is-close"><Minus size={17} /></span>
                    <span><strong>매도</strong><small>일부 또는 전량</small></span>
                  </button>
                </section>
              ) : null}

              {!hasPosition ? (
                <section className="guest-invest-panel" aria-labelledby="guest-invest-heading">
                  <div>
                    <h1 id="guest-invest-heading">같이 뛰어들어요</h1>
                    <p>{party.settings.autoRoundEnabled ? `이번 라운드는 ${formatTime(remainingSeconds)} 남았어요` : '호스트가 다음 라운드를 시작해요'}</p>
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
                    <button className="guest-primary-button" type="button" onClick={() => void submitInvest()} disabled={!validAmount}>
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
                      <p>호스트가 확인하면 보상을 받아요</p>
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
            <motion.div key="products" className="guest-tab-content guest-tab-content--products" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <section className="guest-products" aria-labelledby="guest-products-heading">
                <div className="guest-section-heading guest-section-heading--products">
                  <div>
                    <span className="guest-products__eyebrow">RALLY BAR</span>
                    <h1 id="guest-products-heading">상품 주문</h1>
                    <p>크레딧으로 나에게, 친구에게</p>
                  </div>
                  <span className="guest-products__balance"><span>C</span>{formatCredit(currentUser.credit)}</span>
                </div>
                <div className="guest-product-categories" role="tablist" aria-label="상품 종류">
                  {PRODUCT_CATEGORIES.map((category) => (
                    <button
                      className={selectedProductCategory === category.id ? 'is-active' : ''}
                      key={category.id}
                      type="button"
                      role="tab"
                      aria-selected={selectedProductCategory === category.id}
                      onClick={() => setSelectedProductCategory(category.id)}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
                <div className="guest-product-list">
                  {visibleProducts.map((product) => (
                    <button className="guest-product" key={product.id} type="button" onClick={() => setSelectedProductId(product.id)}>
                      <span className="guest-product__visual">
                        <img src={productImage(product.id)} alt="" />
                        {product.id === 'highball' ? <span className="guest-product__badge">추천</span> : null}
                      </span>
                      <span className="guest-product__info">
                        <span className="guest-product__text">
                          <strong>{product.name}</strong>
                          <small>{product.description}</small>
                        </span>
                        <strong>{formatCredit(product.price)} C</strong>
                      </span>
                      <span className="guest-product__choose"><ShoppingBag size={15} aria-hidden="true" /> 고르기</span>
                    </button>
                  ))}
                </div>
                {personalOrders.length > 0 ? (
                  <section className="guest-order-history" aria-labelledby="guest-order-history-heading">
                    <div className="guest-order-history__heading">
                      <h2 id="guest-order-history-heading">내 주문</h2>
                      <ReceiptText size={18} aria-hidden="true" />
                    </div>
                    <ul>
                      {personalOrders.map((order) => {
                        const orderedProduct = party.products.find((product) => product.id === order.productId)
                        const recipient = party.users.find((user) => user.id === order.recipientId)
                        return (
                          <li key={order.id}>
                            <img src={productImage(order.productId)} alt="" />
                            <div>
                              <strong>{orderedProduct?.name ?? '상품'}</strong>
                              <span>{order.buyerId === currentUser.id && order.recipientId !== currentUser.id ? `${recipient?.nickname ?? '친구'}님에게 선물` : '나에게 주문'}</span>
                            </div>
                            <em className={order.served ? 'is-served' : ''}>{order.served ? '서빙 완료' : '주문 접수'}</em>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ) : null}
              </section>
            </motion.div>
          ) : null}

          {tab === 'ranking' ? (
            <motion.div key="ranking" className="guest-tab-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <section className="guest-ranking" aria-labelledby="guest-ranking-heading">
                <div className="guest-ranking__hero">
                  <span>내 순위</span>
                  <strong>{currentRank}<small>위</small></strong>
                  <p>{formatCredit(totalAssets(currentUser))} 크레딧</p>
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
                        <span>{formatCredit(totalAssets(user))} C</span>
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
        {positionAction && currentUser.position ? (
          <PositionActionSheet
            action={positionAction}
            availableCredit={currentUser.credit}
            positionAmount={currentUser.position.amount}
            onClose={() => setPositionAction(null)}
            onSubmit={(nextAmount) => finishPositionAction(positionAction, nextAmount)}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {topUpOpen ? <TopUpSheet onClose={() => setTopUpOpen(false)} onTopUp={finishTopUp} /> : null}
      </AnimatePresence>
    </main>
  )
}
