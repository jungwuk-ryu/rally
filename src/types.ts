export type PriceSource = 'upbit' | 'fallback'

export interface Market {
  symbol: string
  name: string
  price: number
  previousPrice: number
  changeRate: number
  history: number[]
  source: PriceSource
}

export interface Position {
  amount: number
  entryPrice: number
  openedAt: number
}

export interface PartyUser {
  id: string
  phone: string
  nickname: string
  credit: number
  position?: Position
  pnl: number
  joinedAt: number
}

export interface PartyEvent {
  id: string
  title: string
  reward: number
  active: boolean
  createdAt: number
  completedUserIds: string[]
}

export interface Product {
  id: string
  name: string
  description: string
  price: number
  emoji: string
  accent: string
}

export interface PartyOrder {
  id: string
  productId: string
  buyerId: string
  recipientId: string
  served: boolean
  createdAt: number
}

export interface PartySettings {
  roundSeconds: number
  rallyThreshold: number
  rallyCooldownSeconds: number
}

export interface PartyState {
  roomCode: string
  createdAt: number
  hostName: string
  market: Market
  round: number
  roundStartedAt: number
  settings: PartySettings
  users: PartyUser[]
  events: PartyEvent[]
  products: Product[]
  orders: PartyOrder[]
  mcLine: string
  rallyActiveUntil?: number
  lastRallyAt?: number
  notice?: PartyNotice
}

export interface PartyNotice {
  id: string
  type: 'round' | 'rally' | 'gift' | 'event' | 'settlement' | 'mc'
  title: string
  body: string
  createdAt: number
  targetUserId?: string
}

export interface Session {
  roomCode: string
  userId: string
  phone: string
  nickname: string
  isHost: boolean
}

export interface JoinPayload {
  roomCode: string
  phone: string
  nickname: string
}
