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

function JoinCard({ onJoin }: { onJoin: (payload: Pick<JoinPayload, 'phone' | 'nickname'>) => void }) {
  const [phone, setPhone] = useState('010')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')

  return <main className="join-card">
    <div className="lobby__mark" style={{ color: '#11152c', fontSize: 42 }}>Rally</div>
    <h1>파티에 합류하기</h1>
    <p>전화번호는 같은 세션을 찾는 데만 써요.</p>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (!phone.trim() || !nickname.trim()) return setError('전화번호와 닉네임을 모두 입력해 주세요.')
      setError('')
      onJoin({ phone: phone.trim(), nickname: nickname.trim().slice(0, 12) })
    }}>
      <label>전화번호<input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" /></label>
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

  const createParty = useCallback(async () => {
    try { applyBootstrap(await emitWithAck<BootstrapResponse>('host:create', { hostName: 'Rally Host' })) }
    catch (error) { setMessage(error instanceof Error ? error.message : '방을 만들지 못했어요.') }
  }, [applyBootstrap])

  const joinParty = useCallback(async (payload: Pick<JoinPayload, 'phone' | 'nickname'>) => {
    try { applyBootstrap(await emitWithAck<BootstrapResponse>('party:join-default', payload)) }
    catch (error) { setMessage(error instanceof Error ? error.message : '입장하지 못했어요.') }
  }, [applyBootstrap])

  useEffect(() => {
    const stored = readStoredSession()
    if (!stored || (view !== 'host' && view !== 'guest')) return
    emitWithAck<BootstrapResponse>('party:join', stored).then(applyBootstrap).catch(() => setView(stored.isHost ? 'host' : 'join'))
  // Only restore once from the route selected when the application loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  if (view === 'host') return <><Lobby onHost={createParty} onJoin={() => setView('join')} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
  if (view === 'join') return <><JoinCard onJoin={joinParty} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
  return <><Lobby onHost={createParty} onJoin={() => setView('join')} /><AppErrorNotice message={message} onDismiss={() => setMessage('')} /></>
}
