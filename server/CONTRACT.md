# Rally 실시간 계약

Socket.IO는 현재 페이지와 같은 origin에서 연결한다. 모든 상태 변경은 해당 방에 `party:state`를 다시 보낸다. 연결당 과도한 요청 제한은 두지 않는다. 각 이벤트의 callback은 선택 사항이며, 실패하면 `{ ok: false, error }`를 돌려준다.

## 연결과 세션

| Client event | Payload | 결과 |
| --- | --- | --- |
| `host:create` | `{ hostName, settings? }` | 방을 만들고 callback으로 `{ ok, state, session }` 반환 |
| `host:resume` | `{ roomCode, userId }` | 호스트 화면 새로고침 뒤, 이전 callback `session`으로 복구 |
| `party:join` | `{ roomCode, phone, nickname }` | 전화번호가 같은 손님이면 기존 크레딧과 포지션을 복구 |
| `party:resume` | `{ roomCode, phone }` | 화면 새로고침 뒤 기존 손님 세션 복구 |

`Session`은 `roomCode`, `userId`, `phone`, `nickname`, `isHost`를 가진다. 손님이 받은 `userId`는 아래 본인 액션의 payload에 넣는다.

## 손님 액션

| Client event | Payload | 설명 |
| --- | --- | --- |
| `position:open` | `{ userId, amount }` | 보유 크레딧으로 현재 종목에 롱 포지션을 추가 |
| `credit:topup` | `{ userId, amount }` | 해커톤용 가상 크레딧 충전 |
| `order:create` | `{ userId, productId, recipientId }` | 상품 주문 또는 같은 방 손님에게 선물 |

본인 `userId`와 현재 socket 세션이 맞아야 한다. 주문의 `recipientId`를 자기 ID로 보내면 본인 주문이다.

## 호스트 액션

| Client event | Payload | 설명 |
| --- | --- | --- |
| `host:rally` | 없음 | 투자 합계가 기준 이상이고 쿨다운이 끝났을 때 Rally Moment 시작 |
| `host:round-next` | 없음 | 현재 포지션을 정산하고 다음 종목 라운드 시작 |
| `host:settings` | `Partial<PartySettings>` | `roundSeconds`, `rallyThreshold`, `rallyCooldownSeconds` 변경 |
| `host:event-create` | `{ title, reward }` | 파티 미션 추가 |
| `host:event-reward` | `{ eventId, userId }` | 선택 손님에게 한 번만 미션 보상 지급 |
| `host:order-served` | `{ orderId }` | 주문 서빙 완료 처리 |

호스트 이벤트는 방을 만든 socket 세션만 실행할 수 있다.

## Server event

| Server event | Payload | 용도 |
| --- | --- | --- |
| `party:state` | `PartyState` | 입장, 가격, 포지션, 순위, 이벤트, 주문, Rally 상태의 단일 스냅샷 |
| `party:notice` | `PartyNotice` | 해당 손님에게만 보내는 선물·정산·서빙 팝업. 전역 공지는 `party:state.notice`에도 포함 |
| `party:error` | `string` | 액션 실패 문구 |

`PartyState.market.source`가 `upbit`면 업비트 ticker를 받고 있는 상태다. 연결 실패 시 `fallback`으로 자연스러운 데모 가격을 계속 보낸다. `PartyState.rallyActiveUntil`이 현재 시각보다 미래면 Rally Moment 연출을 보여준다.

## HTTP

`GET /api/health`는 `{ ok, service, rooms, uptimeSeconds }`를 반환한다. 운영 모드에서는 Vite `dist`를 같은 8829 포트에서 제공한다.
