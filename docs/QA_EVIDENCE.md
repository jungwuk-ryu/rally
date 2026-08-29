# Rally 시연 검증 기록

검증일: 2026-08-29

## 공개 서비스

- `rally.service`: active
- `http://127.0.0.1:8829/api/health`: 정상 응답
- `https://hackthebeat.jungwuk.com`: HTTP 200

## 브라우저 시연

### 호스트

- 공개 URL에서 파티를 생성했다.
- 1440×900에서 가로 overflow 없이 호스트 화면을 확인했다.
- QR/방 코드 `DATF9N`, 업비트 가격 표기, AI MC, Rally 활성 조건, 오른쪽 순위 레일을 확인했다.

### 손님

- `/join/DATF9N`으로 접속해 방 코드가 자동 입력된 가입 화면을 확인했다.
- `소연`으로 입장한 뒤 390×844에서 `scrollWidth = 390`으로 가로 overflow가 없음을 확인했다.
- 50 크레딧 투자 후 호스트 순위 레일에 `소연`, `50 투자`이 같은 방 상태로 반영되는 것을 확인했다.

## 실시간·fallback

- Socket.IO 검증에서 방 생성, 입장, 충전, 투자, 주문, Rally, 이벤트 보상, 다음 라운드 정산을 실행했다.
- 실행 중인 방은 업비트 ticker가 들어오면 `market.source = upbit`으로 표시됐다.
- 새 방 생성 직후에는 `market.source = fallback`과 준비된 AI MC 문구가 확인됐다. Gemini API 키가 없어도 파티가 계속 동작한다.

## 빌드

- `npm run build` 통과
- `npm run lint` 통과
