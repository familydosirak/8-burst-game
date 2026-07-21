# 8 Burst - 뒤쪽 조준 및 빠른 정지 적용판

## 주요 변경

- 발사 공의 아래쪽을 눌러 90도를 넘는 뒤쪽 각도로 발사 가능
- 최대 각도: 180도
- 발사 위치를 바닥에서 조금 위로 이동
- 기존 `frictionAir: 0.018` 유지
- 속도가 1.35 아래가 되면 추가 감속
- 속도가 0.12 아래가 되면 즉시 정지
- 정지 판정 프레임을 10프레임으로 단축

## 조정 가능한 값

`game.js` 상단 설정 영역:

```js
const MAX_AIM_ANGLE_DEGREES = 180;

const LOW_SPEED_THRESHOLD = 1.35;
const LOW_SPEED_DAMPING = 0.84;
const SNAP_STOP_SPEED = 0.12;
```

더 빨리 멈추게 하려면:

```js
const LOW_SPEED_THRESHOLD = 1.8;
const LOW_SPEED_DAMPING = 0.78;
```

## 실행

```bash
python -m http.server 8000
```

브라우저에서 `http://localhost:8000` 접속.
