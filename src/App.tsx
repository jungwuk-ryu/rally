import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowRight, Users, X } from 'lucide-react'
import { HostView } from './components/HostView'
import { GuestView } from './components/GuestView'
import { emitWithAck, socket, type BootstrapResponse } from './lib/realtime'
import type { JoinPayload, PartyNotice, PartySettings, PartyState, Session } from './types'

const SESSION_KEY = 'rally-session-v1'

function readStoredSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null
  } catch {
    return null
  }
}

function Lobby({ onHost, onJoin }: { onHost: () => void; onJoin: () => void }) {
  return <main className="lobby">
    <header className="lobby__header">
      <div className="lobby__mark" aria-label="Rally">Rally<span>.</span></div>
      <span className="lobby__status"><i aria-hidden="true" />ONE PARTY</span>
    </header>
    <section className="lobby__body">
      <p className="lobby__eyebrow">LIVE CLUB MARKET</p>
      <h1>오늘의 파티,<br /><em>같이</em> 올라타요.</h1>
      <p>한 화면의 시세를 보며 여러 휴대폰이 같은 라운드를 즐겨요.</p>
      <div className="lobby__actions">
        <button className="lobby__button lobby__button--primary" onClick={onHost}>파티 열기 <ArrowRight size={16} /></button>
        <button className="lobby__button lobby__button--subtle" onClick={onJoin}><Users size={16} /> 파티 입장</button>
      </div>
    </section>
    <div className="lobby__footer" aria-hidden="true">
      <span>RALLY / PARTY MARKET</span>
      <span>01 — READY</span>
    </div>
  </main>
}

function HostAccessCard({
  intent,
  onAccess,
  onBack,
}: {
  intent: 'create' | 'mirror'
  onAccess: (password: string) => Promise<string | null>
  onBack: () => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const isCreate = intent === 'create'

  return <main className="entry-page">
    <section className="join-card host-access-card">
      <div className="entry-page__bar"><div className="lobby__mark">Rally<span>.</span></div><span>HOST ACCESS</span></div>
      <div className="entry-page__intro">
        <p className="entry-page__eyebrow">PRIVATE HOST VIEW</p>
        <h1>{isCreate ? <>호스트로<br />시작하기</> : <>호스트 화면<br />연결하기</>}</h1>
        <p>{isCreate ? '파티를 열거나 진행 중인 화면에 연결해요.' : '진행 중인 Rally 호스트 화면에 연결해요.'}</p>
      </div>
      <form onSubmit={async (event) => {
        event.preventDefault()
        if (!password.trim()) return setError('호스트 비밀번호를 입력해 주세요.')
        setError('')
        setPending(true)
        const accessError = await onAccess(password)
        setPending(false)
        if (accessError) setError(accessError)
      }}>
        <label>호스트 비밀번호
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            placeholder="6자리 비밀번호"
            maxLength={24}
            aria-invalid={Boolean(error)}
            autoFocus
          />
        </label>
        {error && <p className="join-card__error" role="alert">{error}</p>}
        <button type="submit" disabled={pending}>{pending ? '연결 중' : isCreate ? '호스트 화면 열기' : '호스트 화면 연결'}</button>
        <button className="host-access-card__back" type="button" onClick={onBack}>돌아가기</button>
      </form>
    </section>
  </main>
}

function JoinCard({ onJoin }: { onJoin: (payload: Pick<JoinPayload, 'phone' | 'nickname'>) => void }) {
  const [phone, setPhone] = useState('010')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')

  return <main className="entry-page">
    <section className="join-card">
      <div className="entry-page__bar"><div className="lobby__mark">Rally<span>.</span></div><span>GUEST ENTRY</span></div>
      <div className="entry-page__intro">
        <p className="entry-page__eyebrow">ONE SCREEN, TOGETHER</p>
        <h1>파티에<br />합류하기</h1>
        <p>전화번호는 같은 세션을 찾는 데만 써요.</p>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault()
        if (!phone.trim() || !nickname.trim()) return setError('전화번호와 닉네임을 모두 입력해 주세요.')
        setError('')
        onJoin({ phone: phone.trim(), nickname: nickname.trim().slice(0, 12) })
      }}>
        <label>전화번호<input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" aria-invalid={Boolean(error)} /></label>
        <label>닉네임<input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="예: 소연" maxLength={12} aria-invalid={Boolean(error)} /></label>
        {error && <p className="join-card__error" role="alert">{error}</p>}
        <button type="submit">입장하기 <ArrowRight size={16} /></button>
      </form>
    </section>
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

  useEffect(() => {
    socket.connect()
    socket.on('party:state', setParty)
    socket.on('party:error', (error: string) => setMessage(error))
    socket.on('party:notice', (notice: PartyNotice) => {
      setParty(current => current ? { ...current, notice } : current)
    })
    return () => { socket.off('party:state'); socket.off('party:error'); socket.off('party:notice'); socket.disconnect() }
  }, [])

  const applyBootstrap = useCallback((bootstrap: BootstrapResponse) => {
    setParty(bootstrap.state)
    setSession(bootstrap.session)
    localStorage.setItem(SESSION_KEY, JSON.stringify(bootstrap.session))
    setView(bootstrap.session.isHost ? 'host' : 'guest')
  }, [])

  const enterHost = useCallback(async (password: string) => {
    try {
      let bootstrap: BootstrapResponse
      if (hostIntent === 'create') {
        try {
          bootstrap = await emitWithAck<BootstrapResponse>('host:create', { hostName: 'Rally Host', password })
        } catch {
          bootstrap = await emitWithAck<BootstrapResponse>('host:join-active', { password })
        }
      } else {
        const stored = readStoredSession()
        bootstrap = stored?.isHost
          ? await emitWithAck<BootstrapResponse>('host:resume', { roomCode: stored.roomCode, userId: stored.userId, password })
          : await emitWithAck<BootstrapResponse>('host:join-active', { password })
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
    const stored = readStoredSession()
    if (party || view !== 'guest' || !stored) return

    if (stored && view === 'guest') {
      emitWithAck<BootstrapResponse>('party:resume', { roomCode: stored.roomCode, phone: stored.phone })
        .then(applyBootstrap)
        .catch(() => setView('join'))
    }
  }, [applyBootstrap, party, view])

  const action = useCallback(async (event: string, payload: object = {}) => {
    try {
      await emitWithAck(event, payload)
      setMessage('')
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '요청을 처리하지 못했어요.')
      return false
    }
  }, [])

  if (view === 'host' && party) return <><HostView party={party} session={session ?? undefined} now={Date.now()} onTriggerRally={() => action('host:rally')} onNextRound={() => action('host:round-next')} onUpdateSettings={(settings: Partial<PartySettings>) => action('host:settings', settings)} onCreateEvent={(title, reward) => action('host:event-create', { title, reward })} onRewardEvent={(eventId, userId) => action('host:event-reward', { eventId, userId })} onServeOrder={(orderId) => action('host:order-served', { orderId })} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
  if (view === 'guest' && party && session) return <><GuestView party={party} session={session} onInvest={(amount) => action('position:open', { userId: session.userId, amount })} onAddPosition={(amount) => action('position:open', { userId: session.userId, amount })} onClosePosition={(amount) => action('position:close', { userId: session.userId, amount })} onTopUp={(amount) => action('credit:topup', { userId: session.userId, amount })} onOrder={(productId, recipientId) => action('order:create', { userId: session.userId, productId, recipientId })} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
  if (view === 'host') return <><HostAccessCard intent={hostIntent} onAccess={enterHost} onBack={() => setView('lobby')} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
  if (view === 'join') return <><JoinCard onJoin={joinParty} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
  return <><Lobby onHost={openHost} onJoin={() => setView('join')} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
}
