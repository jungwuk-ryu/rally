import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, Users, X } from 'lucide-react'
import { HostView } from './components/HostView'
import { GuestView } from './components/GuestView'
import { emitWithAck, socket, type BootstrapResponse } from './lib/realtime'
import type { JoinPayload, PartyNotice, PartySettings, PartyState, Session } from './types'

const SESSION_KEY = 'rally-session-v1'

function createGuestPhone() {
  return `010${crypto.getRandomValues(new Uint32Array(1))[0].toString().slice(-8).padStart(8, '0')}`
}

function readStoredSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null
  } catch {
    return null
  }
}

function Lobby({ onHost, onJoin }: { onHost: () => void; onJoin: () => void }) {
  return <main className="lobby">
    <div className="lobby__mark">Rally</div>
    <section className="lobby__body">
      <h1>오늘의 파티,<br />같이 올라타요.</h1>
      <p>한 화면의 시세를 보며 여러 휴대폰이 같은 라운드를 즐겨요.</p>
      <div className="lobby__actions">
        <button className="lobby__button lobby__button--primary" onClick={onHost}>파티 열기 <ArrowRight size={16} /></button>
        <button className="lobby__button lobby__button--subtle" onClick={onJoin}><Users size={16} /> 파티 입장</button>
      </div>
    </section>
  </main>
}

function HostConnectingCard({ onBack }: { onBack: () => void }) {
  return <main className="join-card host-access-card">
    <div className="lobby__mark" style={{ color: '#11152c', fontSize: 42 }}>Rally</div>
    <h1>호스트 화면 연결 중</h1>
    <p>진행 중인 파티에 바로 연결하고 있어요.</p>
    <button className="host-access-card__back" type="button" onClick={onBack}>돌아가기</button>
  </main>
}

function JoinCard({ onJoin }: { onJoin: (payload: Pick<JoinPayload, 'phone' | 'nickname'>) => void }) {
  const [phone, setPhone] = useState(createGuestPhone)
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')

  return <main className="join-card join-card--guest">
    <div className="lobby__mark" style={{ color: '#11152c', fontSize: 42 }}>Rally</div>
    <h1>파티에 합류하기</h1>
    <p>전화번호는 같은 세션을 찾는 데만 써요.</p>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (!phone.trim() || !nickname.trim()) return setError('전화번호와 닉네임을 모두 입력해 주세요.')
      setError('')
      onJoin({ phone: phone.trim(), nickname: nickname.trim().slice(0, 12) })
    }}>
      <label>전화번호<input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" /></label>
      <label>닉네임<input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="예: 소연" maxLength={12} /></label>
      {error && <p className="join-card__error">{error}</p>}
      <button type="submit">입장하기</button>
    </form>
  </main>
}

function AppErrorNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  if (!message) return null
  return <div className="app-error-toast" role="alert">
    <AlertCircle size={18} aria-hidden="true" />
    <span>{message}</span>
    <button type="button" onClick={onDismiss} aria-label="오류 메시지 닫기"><X size={16} /></button>
  </div>
}

export default function App() {
  const path = window.location.pathname
  const isJoinRoute = useMemo(() => /^\/join(?:\/[^/]+)?$/.test(path), [path])
  const [party, setParty] = useState<PartyState | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [view, setView] = useState<'lobby' | 'join' | 'host' | 'guest'>(path === '/host' ? 'host' : isJoinRoute ? 'join' : 'lobby')
  const [hostIntent, setHostIntent] = useState<'create' | 'mirror'>(path === '/host' ? 'mirror' : 'create')
  const [message, setMessage] = useState('')
  const hasConnectedRef = useRef(false)

  const applyBootstrap = useCallback((bootstrap: BootstrapResponse) => {
    setParty(bootstrap.state)
    setSession(bootstrap.session)
    localStorage.setItem(SESSION_KEY, JSON.stringify(bootstrap.session))
    setView(bootstrap.session.isHost ? 'host' : 'guest')
  }, [])

  const restoreStoredSession = useCallback(async () => {
    const stored = readStoredSession()
    if (!stored) return null
    const bootstrap = stored.isHost
      ? await emitWithAck<BootstrapResponse>('host:join-active', {})
      : await emitWithAck<BootstrapResponse>('party:join-default', { phone: stored.phone, nickname: stored.nickname })
    applyBootstrap(bootstrap)
    return bootstrap
  }, [applyBootstrap])

  useEffect(() => {
    socket.connect()
    socket.on('party:state', setParty)
    socket.on('party:error', (error: string) => setMessage(error))
    socket.on('party:notice', (notice: PartyNotice) => {
      setParty(current => current ? { ...current, notice } : current)
    })
    const restoreAfterReconnect = () => {
      if (!hasConnectedRef.current) {
        hasConnectedRef.current = true
        return
      }
      void restoreStoredSession().then(() => setMessage('')).catch(() => undefined)
    }
    socket.on('connect', restoreAfterReconnect)
    return () => {
      socket.off('party:state'); socket.off('party:error'); socket.off('party:notice'); socket.off('connect', restoreAfterReconnect); socket.disconnect()
    }
  }, [restoreStoredSession])

  const enterHost = useCallback(async () => {
    try {
      let bootstrap: BootstrapResponse
      if (hostIntent === 'create') {
        try {
          bootstrap = await emitWithAck<BootstrapResponse>('host:create', { hostName: 'Rally Host' })
        } catch {
          bootstrap = await emitWithAck<BootstrapResponse>('host:join-active', {})
        }
      } else {
        bootstrap = await emitWithAck<BootstrapResponse>('host:join-active', {})
      }
      applyBootstrap(bootstrap)
      return null
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '호스트 화면에 연결하지 못했어요.'
      setMessage(nextMessage)
      return nextMessage
    }
  }, [applyBootstrap, hostIntent])

  const openHost = useCallback(() => {
    setHostIntent('create')
    setView('host')
  }, [])

  const joinParty = useCallback(async (payload: Pick<JoinPayload, 'phone' | 'nickname'>) => {
    try { applyBootstrap(await emitWithAck<BootstrapResponse>('party:join-default', payload)) }
    catch (error) { setMessage(error instanceof Error ? error.message : '입장하지 못했어요.') }
  }, [applyBootstrap])

  useEffect(() => {
    if (view !== 'host' || party) return
    void enterHost()
  }, [enterHost, party, view])

  useEffect(() => {
    const stored = readStoredSession()
    if (party || view !== 'guest' || !stored || stored.isHost) return
    void restoreStoredSession().catch(() => setView('join'))
  }, [party, restoreStoredSession, view])

  const action = useCallback(async (event: string, payload: object = {}) => {
    try {
      await emitWithAck(event, payload)
      setMessage('')
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '요청을 처리하지 못했어요.'
      if (/세션을 (?:확인|찾지)/.test(errorMessage)) {
        try {
          const bootstrap = await restoreStoredSession()
          if (bootstrap) {
            const retryPayload = 'userId' in payload
              ? { ...payload, userId: bootstrap.session.userId }
              : payload
            await emitWithAck(event, retryPayload)
            setMessage('')
            return true
          }
        } catch {
          // 기존 오류를 그대로 안내합니다.
        }
      }
      setMessage(errorMessage)
      return false
    }
  }, [restoreStoredSession])

  if (view === 'host' && party) return <><HostView party={party} session={session ?? undefined} now={Date.now()} onTriggerRally={() => action('host:rally')} onNextRound={() => action('host:round-next')} onUpdateSettings={(settings: Partial<PartySettings>) => action('host:settings', settings)} onCreateEvent={(title, reward) => action('host:event-create', { title, reward })} onRewardEvent={(eventId, userId) => action('host:event-reward', { eventId, userId })} onServeOrder={(orderId) => action('host:order-served', { orderId })} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
  if (view === 'guest' && party && session) return <><GuestView party={party} session={session} onInvest={(amount) => action('position:open', { userId: session.userId, amount })} onAddPosition={(amount) => action('position:open', { userId: session.userId, amount })} onClosePosition={(amount) => action('position:close', { userId: session.userId, amount })} onTopUp={(amount) => action('credit:topup', { userId: session.userId, amount })} onOrder={(productId, recipientId) => action('order:create', { userId: session.userId, productId, recipientId })} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
  if (view === 'host') return <><HostConnectingCard onBack={() => setView('lobby')} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
  if (view === 'join') return <><JoinCard onJoin={joinParty} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
  return <><Lobby onHost={openHost} onJoin={() => setView('join')} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
}
