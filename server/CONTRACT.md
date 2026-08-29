# Rally 실시간 계약

Socket.IO는 현재 페이지와 같은 origin에서 연결한다. 모든 상태 변경은 해당 방에 `party:state`를 다시 보낸다. 연결당 과도한 요청 제한은 두지 않는다. 각 이벤트의 callback은 선택 사항이며, 실패하면 `{ ok: false, error }`를 돌려준다.

## 연결과 세션

| Client event | Payload | 결과 |
| --- | --- | --- |
| `host:create` | `{ hostName, settings?, password }` | 비밀번호를 확인한 뒤, 활성 파티가 없을 때만 방을 만들고 callback으로 `{ ok, state, session }` 반환 |
| `host:resume` | `{ roomCode, userId, password }` | 비밀번호를 확인한 뒤 호스트 화면 새로고침 세션 복구 |
| `host:join-active` | `{ password }` | 비밀번호를 확인한 뒤 현재 활성 파티에 호스트 미러 화면으로 연결. 같은 상태와 설정 제어 권한을 받음 |
| `party:join` | `{ roomCode, phone, nickname }` | 전화번호가 같은 손님이면 기존 크레딧과 포지션을 복구 |
| `party:join-default` | `{ phone, nickname }` | 현재 열려 있는 단일 파티에 방 코드 없이 입장 |
| `party:resume` | `{ roomCode, phone }` | 화면 새로고침 뒤 기존 손님 세션 복구 |

`Session`은 `roomCode`, `userId`, `phone`, `nickname`, `isHost`를 가진다. 손님이 받은 `userId`는 아래 본인 액션의 payload에 넣는다.

동시에 활성화할 수 있는 파티는 하나다. 이미 파티가 열려 있을 때 `host:create`는 `이미 진행 중인 Rally 파티가 있어요. 손님으로 참여해 주세요.` 오류를 반환한다. 기존 QR은 `party:join`을 계속 사용한다.

## 손님 액션

| Client event | Payload | 설명 |
| --- | --- | --- |
| `position:open` | `{ userId, amount }` | 보유 크레딧으로 롱 포지션을 열거나 추가 매수. 추가 매수 시 진입가는 가중평균으로 갱신 |
| `position:close` | `{ userId, amount?, closeAll? }` | 현재가로 일부 또는 전량 정산. `amount`를 생략하거나 `closeAll: true`면 전량 정산 |
| `credit:topup` | `{ userId, amount }` | 해커톤용 가상 크레딧 충전 |
| `order:create` | `{ userId, productId, recipientId }` | 상품 주문 또는 같은 방 손님에게 선물 |

본인 `userId`와 현재 socket 세션이 맞아야 한다. 주문의 `recipientId`를 자기 ID로 보내면 본인 주문이다.

## 호스트 액션

| Client event | Payload | 설명 |
| --- | --- | --- |
| `host:rally` | 없음 | 투자 합계가 기준 이상이고 쿨다운이 끝났을 때 Rally Moment 시작 |
| `host:round-next` | 없음 | 현재 포지션을 정산하고 다음 종목 라운드 시작 |
| `host:settings` | `Partial<PartySettings>` | `roundSeconds`, `autoRoundEnabled`, `rallyThreshold`, `rallyCooldownSeconds` 변경 |
| `host:event-create` | `{ title, reward }` | 파티 미션 추가 |
| `host:event-reward` | `{ eventId, userId }` | 선택 손님에게 한 번만 미션 보상 지급 |
| `host:order-served` | `{ orderId }` | 주문 서빙 완료 처리 |

호스트 비밀번호의 기본값은 `123456`이며 서버 환경변수 `HOST_PASSWORD`로 바꿀 수 있다. 호스트 이벤트는 방을 만든 socket 세션 또는 `host:join-active`로 연결한 호스트 미러 세션만 실행할 수 있다.

## Server event

| Server event | Payload | 용도 |
| --- | --- | --- |
| `party:state` | `PartyState` | 입장, 가격, 포지션, 순위, 이벤트, 주문, Rally 상태의 단일 스냅샷 |
| `party:notice` | `PartyNotice` | 해당 손님에게만 보내는 선물·정산·서빙 팝업. 전역 공지는 `party:state.notice`에도 포함 |
| `party:error` | `string` | 액션 실패 문구 |

새 파티와 새 종목은 업비트 공개 1분 캔들의 최근 약 40개 종가를 `PartyState.market.history`에 먼저 채운다. 이후 3초 ticker 가격을 계속 덧붙인다. 캔들 또는 ticker 호출이 실패하면 자연스러운 fallback 이력과 가격 흐름으로 계속 진행한다. `PartyState.market.source`가 `upbit`면 업비트 공개 데이터를 받고 있는 상태다. `PartyState.rallyActiveUntil`이 현재 시각보다 미래면 Rally Moment 연출을 보여준다.

`PartySettings.autoRoundEnabled`의 기본값은 `false`다. 켜면 기본 600초를 기준으로 포지션을 정산하고 직전 종목을 제외한 다음 종목으로 자동 전환한다. 꺼진 상태에서는 호스트의 `host:round-next`만 라운드를 넘긴다.

## HTTP

`GET /api/health`는 `{ ok, service, rooms, uptimeSeconds }`를 반환한다. 운영 모드에서는 Vite `dist`를 같은 8829 포트에서 제공한다.

## 환경변수

업비트 ticker는 인증 없이 공개 REST endpoint를 호출한다. `UPBIT_ACCESS_KEY`, `UPBIT_SECRET_KEY`는 서버 환경에만 둘 수 있는 선택 값이며 현재 공개 ticker 요청과 health 응답, Socket.IO 상태에는 사용하거나 노출하지 않는다. 브라우저에 전달되는 `VITE_` 접두사의 업비트 키는 사용하지 않는다.
