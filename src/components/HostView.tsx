import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Check,
  ChevronRight,
  Crown,
  ListOrdered,
  Mic,
  PartyPopper,
  Play,
  Settings2,
  Sparkles,
  TimerReset,
  Volume2,
  X,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type {
  PartyNotice,
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
  onUpdateSettings?: (settings: Partial<PartySettings>) => void | Promise<boolean | void>
  onCreateEvent?: (title: string, reward: number) => void
  onRewardEvent?: (eventId: string, userId: string) => void
  onServeOrder?: (orderId: string) => void
}

const avatarPalette = ['#e9e2d4', '#f4b49d', '#c6d9c8', '#e9b96b', '#d9d3c6', '#e77e61']

type AudioMode = 'idle' | 'requesting' | 'listening' | 'fallback'
type ImpactKind = 'buy' | 'add' | 'sell' | 'surge' | 'drop'
type SyncStatus = 'live' | 'saving' | 'saved' | 'received'

interface HostImpact {
  kind: ImpactKind
  eyebrow: string
  title: string
  detail: string
  strength: number
}

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

function getLeaderboardValue(user: PartyUser) {
  return user.credit + (user.position ? user.position.amount + user.pnl : 0)
}

function userEmoji(index: number) {
  return ['✦', '●', '♟', '♥', '✳', '☽', '◉', '✺'][index % 8]
}

function getNoticeImpact(notice: PartyNotice): HostImpact | null {
  const message = `${notice.title} ${notice.body}`

  if (/(매도|청산|정리)/.test(message)) {
    return { kind: 'sell', eyebrow: 'POSITION OUT', title: '매도 정리', detail: notice.body, strength: 0.86 }
  }
  if (/(추가\s*(매수|참여|투자)|더\s*(매수|참여|투자))/.test(message)) {
    return { kind: 'add', eyebrow: 'MORE IN', title: '추가 매수', detail: notice.body, strength: 0.9 }
  }
  if (/(매수|참여|투자|포지션)/.test(message)) {
    return { kind: 'buy', eyebrow: 'POSITION IN', title: '매수 체결', detail: notice.body, strength: 0.78 }
  }

  return null
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
  const [audioMode, setAudioMode] = useState<AudioMode>('idle')
  const [audioEnergy, setAudioEnergy] = useState(0)
  const [impact, setImpact] = useState<(HostImpact & { id: number }) | null>(null)
  const [autoRoundOverride, setAutoRoundOverride] = useState<boolean | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('live')
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const audioFrameRef = useRef<number | null>(null)
  const lastAudioSampleRef = useRef(0)
  const impactTimeoutRef = useRef<number | null>(null)
  const syncTimeoutRef = useRef<number | null>(null)
  const impactSequenceRef = useRef(0)
  const lastNoticeIdRef = useRef(party.notice?.id)
  const lastMarketRef = useRef({ symbol: party.market.symbol, price: party.market.price })
  const lastSettingsSignatureRef = useRef(`${party.settings.roundSeconds}:${party.settings.autoRoundEnabled ?? ''}`)
  const localSettingWriteRef = useRef(false)

  const stopAudio = useCallback((nextMode: Exclude<AudioMode, 'requesting' | 'listening'> = 'idle') => {
    if (audioFrameRef.current !== null) {
      window.cancelAnimationFrame(audioFrameRef.current)
      audioFrameRef.current = null
    }
    audioStreamRef.current?.getTracks().forEach((track) => track.stop())
    audioStreamRef.current = null
    const activeContext = audioContextRef.current
    audioContextRef.current = null
    if (activeContext && activeContext.state !== 'closed') {
      void activeContext.close().catch(() => undefined)
    }
    setAudioEnergy(nextMode === 'fallback' ? 0.34 : 0)
    setAudioMode(nextMode)
  }, [])

  const toggleAudio = useCallback(async () => {
    if (audioMode === 'listening') {
      stopAudio()
      return
    }
    if (audioMode === 'requesting') return

    const AudioContextConstructor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextConstructor) {
      stopAudio('fallback')
      return
    }

    setAudioMode('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      const context = new AudioContextConstructor()
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.76
      context.createMediaStreamSource(stream).connect(analyser)
      await context.resume()

      audioStreamRef.current = stream
      audioContextRef.current = context
      lastAudioSampleRef.current = 0
      const samples = new Uint8Array(analyser.fftSize)
      const readEnergy = (timestamp: number) => {
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) {
          const normalized = (sample - 128) / 128
          sum += normalized * normalized
        }
        const rawEnergy = Math.min(1, Math.sqrt(sum / samples.length) * 6.2)
        if (timestamp - lastAudioSampleRef.current > 42) {
          lastAudioSampleRef.current = timestamp
          setAudioEnergy((current) => current * 0.58 + rawEnergy * 0.42)
        }
        audioFrameRef.current = window.requestAnimationFrame(readEnergy)
      }
      setAudioMode('listening')
      audioFrameRef.current = window.requestAnimationFrame(readEnergy)
    } catch {
      stopAudio('fallback')
    }
  }, [audioMode, stopAudio])

  const triggerImpact = useCallback((nextImpact: HostImpact) => {
    if (impactTimeoutRef.current !== null) window.clearTimeout(impactTimeoutRef.current)
    setImpact({ ...nextImpact, id: ++impactSequenceRef.current })
    impactTimeoutRef.current = window.setTimeout(() => setImpact(null), 2_450)
  }, [])

  const showSyncStatus = useCallback((nextStatus: SyncStatus, duration = 2_700) => {
    if (syncTimeoutRef.current !== null) window.clearTimeout(syncTimeoutRef.current)
    setSyncStatus(nextStatus)
    if (nextStatus !== 'live') {
      syncTimeoutRef.current = window.setTimeout(() => setSyncStatus('live'), duration)
    }
  }, [])

  useEffect(() => () => {
    if (impactTimeoutRef.current !== null) window.clearTimeout(impactTimeoutRef.current)
    if (syncTimeoutRef.current !== null) window.clearTimeout(syncTimeoutRef.current)
    stopAudio()
  }, [stopAudio])

  useEffect(() => {
    const nextNotice = party.notice
    if (!nextNotice || nextNotice.id === lastNoticeIdRef.current) return
    lastNoticeIdRef.current = nextNotice.id
    const nextImpact = getNoticeImpact(nextNotice)
    if (nextImpact) triggerImpact(nextImpact)
  }, [party.notice, triggerImpact])

  useEffect(() => {
    const previous = lastMarketRef.current
    const marketChanged = previous.symbol !== party.market.symbol
    const percentage = previous.price > 0 ? ((party.market.price - previous.price) / previous.price) * 100 : 0
    lastMarketRef.current = { symbol: party.market.symbol, price: party.market.price }
    if (marketChanged || Math.abs(percentage) < 0.28 || Math.abs(percentage) > 20) return

    const isSurge = percentage > 0
    triggerImpact({
      kind: isSurge ? 'surge' : 'drop',
      eyebrow: isSurge ? 'MARKET SURGE' : 'MARKET DIP',
      title: isSurge ? '가격 급등' : '가격 급락',
      detail: `${isSurge ? '+' : ''}${percentage.toFixed(2)}% 빠르게 움직였어요.`,
      strength: Math.min(1, 0.58 + Math.abs(percentage) / 1.4),
    })
  }, [party.market.price, party.market.symbol, triggerImpact])

  useEffect(() => {
    setDuration(String(Math.round(party.settings.roundSeconds / 60)))
  }, [party.settings.roundSeconds])

  useEffect(() => {
    if (typeof party.settings.autoRoundEnabled === 'boolean') setAutoRoundOverride(null)
  }, [party.settings.autoRoundEnabled])

  const settingsSignature = `${party.settings.roundSeconds}:${party.settings.autoRoundEnabled ?? ''}`

  useEffect(() => {
    if (lastSettingsSignatureRef.current === settingsSignature) return
    lastSettingsSignatureRef.current = settingsSignature
    showSyncStatus(localSettingWriteRef.current ? 'saved' : 'received')
    localSettingWriteRef.current = false
  }, [settingsSignature, showSyncStatus])

  const autoRoundEnabled = autoRoundOverride ?? party.settings.autoRoundEnabled ?? true
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
        .sort((a, b) => getLeaderboardValue(b) - getLeaderboardValue(a))
        .slice(0, 8),
    [party.users],
  )
  const chartData = useMemo(() => {
    const history = party.market.history.filter((value) => Number.isFinite(value) && value > 0)
    if (history.at(-1) !== party.market.price) history.push(party.market.price)
    return history.map((value, index) => ({ index, value }))
  }, [party.market.history, party.market.price])
  const chartRange = useMemo(() => {
    const values = chartData.map((point) => point.value)
    const highest = values.length ? Math.max(...values) : party.market.price
    const lowest = values.length ? Math.min(...values) : party.market.price
    const padding = Math.max((highest - lowest) * 0.12, Math.abs(highest) * 0.002, 0.0001)
    const opening = values[0] ?? party.market.price
    const current = values.at(-1) ?? party.market.price
    const traceChange = opening > 0 ? ((current - opening) / opening) * 100 : party.market.changeRate
    return {
      highest,
      lowest,
      domain: [lowest - padding, highest + padding] as [number, number],
      traceChange,
    }
  }, [chartData, party.market.changeRate, party.market.price])
  const currentChartPoint = chartData.at(-1)
  const currentPointTop = Math.min(
    89,
    Math.max(11, ((chartRange.domain[1] - (currentChartPoint?.value ?? party.market.price)) / (chartRange.domain[1] - chartRange.domain[0])) * 100),
  )
  const signal = party.market.changeRate >= 0 ? 'up' : 'down'
  const joinPath = `/join/${encodeURIComponent(party.roomCode)}`
  const inviteUrl = typeof window === 'undefined'
    ? joinPath
    : `${window.location.origin}${joinPath}`
  const activeEvents = party.events.filter((event) => event.active)
  const pendingOrders = party.orders.filter((order) => !order.served)
  const audioLabel = audioMode === 'requesting'
    ? '연결 중'
    : audioMode === 'listening'
      ? '사운드 ON'
      : audioMode === 'fallback'
        ? '펄스'
        : '사운드'
  const syncLabel = syncStatus === 'saving'
    ? '설정 저장 중'
    : syncStatus === 'saved'
      ? '설정 저장됨'
      : syncStatus === 'received'
        ? '다른 화면에서 변경됨'
        : '다른 화면과 동기화'
  const hostStyle = {
    '--audio-energy': audioEnergy.toFixed(3),
    '--impact-energy': impact?.strength.toFixed(3) ?? '0',
  } as CSSProperties

  const publishSettings = useCallback(async (settings: Partial<PartySettings>) => {
    if (!onUpdateSettings) return false
    localSettingWriteRef.current = true
    showSyncStatus('saving', 4_000)

    try {
      const result = await onUpdateSettings(settings)
      if (result === false) {
        localSettingWriteRef.current = false
        showSyncStatus('live')
        return false
      }
      showSyncStatus('saved')
      return true
    } catch {
      localSettingWriteRef.current = false
      showSyncStatus('live')
      return false
    }
  }, [onUpdateSettings, showSyncStatus])

  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const minutes = Number(duration)
    if (Number.isFinite(minutes) && minutes >= 1) {
      void publishSettings({ roundSeconds: Math.round(minutes * 60) })
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
    <main
      className={`rally-host rally-host--${signal}${audioMode !== 'idle' ? ' rally-host--audio-active' : ''}${audioMode === 'fallback' ? ' rally-host--fallback' : ''}${impact ? ` rally-host--impact-${impact.kind}` : ''}`}
      style={hostStyle}
      aria-label="Rally 호스트 화면"
    >
      <div className="rally-host__grain" aria-hidden="true" />
      <div className="rally-host__audio-wash" aria-hidden="true" />
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

      {audioMode === 'fallback' && !reduceMotion && (
        <motion.div
          className="rally-host__fallback-pulse"
          aria-hidden="true"
          animate={{ opacity: [0.12, 0.36, 0.12], scale: [0.92, 1.08, 0.92] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <header className="rally-host__topbar">
        <div className="rally-host__top-status">
          <div className="rally-host__round">
            <span>ROUND {String(party.round).padStart(2, '0')}</span>
            <span className="rally-host__round-dot" />
            {autoRoundEnabled ? (
              <span>{formatTimer(remainingSeconds)}</span>
            ) : (
              <span className="rally-host__manual-round"><b>MANUAL</b> 수동 진행</span>
            )}
          </div>
          <div className={`rally-host__sync is-${syncStatus}`} role="status" aria-live="polite">
            <span className="rally-host__sync-dot" aria-hidden="true" />
            <span className="rally-host__sync-word">LIVE SYNC</span>
            <small>{syncLabel}</small>
          </div>
        </div>
        <div className="rally-host__top-controls">
          <button
            className={`rally-host__audio-trigger${audioMode === 'listening' ? ' is-listening' : ''}${audioMode === 'fallback' ? ' is-fallback' : ''}`}
            type="button"
            onClick={toggleAudio}
            disabled={audioMode === 'requesting'}
            aria-pressed={audioMode === 'listening'}
            aria-label={audioMode === 'listening' ? '사운드 반응 끄기' : '마이크로 사운드 반응 켜기'}
          >
            {audioMode === 'listening' ? <Volume2 size={16} strokeWidth={1.7} /> : <Mic size={16} strokeWidth={1.7} />}
            <span>{audioLabel}</span>
          </button>
          <button
            className="rally-host__settings-trigger"
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="호스트 설정 열기"
          >
            <Settings2 size={16} strokeWidth={1.7} />
            <span>설정</span>
          </button>
        </div>
      </header>

      <section className={`rally-host__stage${impact ? ' has-impact' : ''}`} aria-live="polite">
        <motion.h1
          className={`rally-host__wordmark${impact ? ' is-impact' : ''}`}
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
          <div className={`rally-host__price-row${impact?.kind === 'surge' || impact?.kind === 'drop' ? ' is-impact' : ''}`}>
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
          <div className="rally-host__chart-meta" aria-label="최근 가격 범위">
            <span><b>HIGH</b>{formatPrice(chartRange.highest)}</span>
            <span><b>LOW</b>{formatPrice(chartRange.lowest)}</span>
            <span className={chartRange.traceChange >= 0 ? 'is-up' : 'is-down'}>
              <b>TRACE</b>{chartRange.traceChange >= 0 ? '+' : ''}{chartRange.traceChange.toFixed(2)}%
            </span>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 24, right: 2, bottom: 2, left: 2 }}>
              <defs>
                <linearGradient id="rally-chart-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={signal === 'up' ? '#ea2804' : '#bd3a2d'} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={signal === 'up' ? '#f0ede5' : '#e6d9d5'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(252, 252, 252, 0.15)" strokeDasharray="2 8" vertical={false} />
              <XAxis dataKey="index" type="number" hide />
              <YAxis domain={chartRange.domain} hide />
              <Area
                type="monotone"
                dataKey="value"
                stroke={signal === 'up' ? '#ea2804' : '#dd796b'}
                strokeWidth={1.7}
                fill="url(#rally-chart-fill)"
                isAnimationActive={!reduceMotion}
                animationDuration={560}
                dot={false}
                activeDot={false}
              />
              {currentChartPoint && (
                <ReferenceDot
                  x={currentChartPoint.index}
                  y={currentChartPoint.value}
                  r={4.5}
                  fill="#fcfcfc"
                  stroke={signal === 'up' ? '#ea2804' : '#bd3a2d'}
                  strokeWidth={2}
                  isFront
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
          <span className={`rally-host__chart-current rally-host__chart-current--${signal}`} style={{ top: `${currentPointTop}%` }} aria-hidden="true">
            <i />
            <small>NOW</small>
          </span>
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
            const rankValue = getLeaderboardValue(user)
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
          bgColor="#f9f7f3"
          fgColor="#202020"
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
        {impact && (
          <motion.div
            className={`rally-host__impact rally-host__impact--${impact.kind}`}
            role="status"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.24 }}
          >
            <motion.div
              className="rally-host__impact-bloom"
              animate={reduceMotion ? undefined : { scale: [0.72, 1.42], opacity: [0.82, 0] }}
              transition={{ duration: 1.12, ease: 'easeOut' }}
            />
            <motion.div
              className="rally-host__impact-copy"
              initial={reduceMotion ? false : { y: 26, scale: 0.9, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            >
              <span>{impact.eyebrow}</span>
              <strong>{impact.title}</strong>
              <p>{impact.detail}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                  <div className={`rally-host__dialog-sync is-${syncStatus}`} aria-label={`동기화 상태: ${syncLabel}`}>
                    <span className="rally-host__sync-dot" aria-hidden="true" />
                    <span className="rally-host__sync-word">LIVE SYNC</span>
                    <small>{syncLabel}</small>
                  </div>
                </div>
                <button type="button" onClick={() => setSettingsOpen(false)} aria-label="설정 닫기">
                  <X size={19} />
                </button>
              </header>

              <div className="rally-host__dialog-scroll">
                <form className="rally-host__round-form" onSubmit={submitSettings}>
                  <div className="rally-host__auto-round">
                    <div>
                      <strong>자동 전환</strong>
                      <small>{autoRoundEnabled ? '시간이 끝나면 다음 종목으로 넘어가요.' : '호스트가 다음 라운드를 직접 시작해요.'}</small>
                    </div>
                    <label className="rally-host__switch" aria-label="자동 전환">
                      <input
                        type="checkbox"
                        checked={autoRoundEnabled}
                        onChange={(input) => {
                          const nextAutoRoundEnabled = input.target.checked
                          setAutoRoundOverride(nextAutoRoundEnabled)
                          void publishSettings({ autoRoundEnabled: nextAutoRoundEnabled }).then((saved) => {
                            if (!saved) setAutoRoundOverride(null)
                          })
                        }}
                      />
                      <span aria-hidden="true" />
                    </label>
                  </div>
                  <label htmlFor="round-minutes">라운드 시간</label>
                  <div>
                    <input
                      id="round-minutes"
                      type="number"
                      min="1"
                      max="60"
                      inputMode="numeric"
                      value={duration}
                      disabled={!autoRoundEnabled}
                      onChange={(event) => setDuration(event.target.value)}
                    />
                    <span>분</span>
                    <button type="submit" disabled={!autoRoundEnabled}>적용</button>
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
