import { io, type Socket } from 'socket.io-client'
import type { PartyState, Session } from '../types'

export interface SocketResponse<T> {
  ok: boolean
  data?: T
  error?: string
  state?: PartyState
  session?: Session
}

export interface BootstrapResponse {
  state: PartyState
  session: Session
}

export const socket: Socket = io({ autoConnect: false, transports: ['websocket', 'polling'] })

export function emitWithAck<T>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, payload, (error: Error | null, response: SocketResponse<T>) => {
      if (error) return reject(new Error('연결이 늦어지고 있어요. 다시 눌러주세요.'))
      if (!response?.ok) return reject(new Error(response?.error ?? '요청을 처리하지 못했어요.'))
      const normalized = response.data ?? (response.state && response.session
        ? { state: response.state, session: response.session }
        : response.state ?? {})
      resolve(normalized as T)
    })
  })
}
