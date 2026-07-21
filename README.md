# 8 Burst + Firebase 주간 랭킹

게임 오버 시 닉네임 입력 모달이 열리고, 이번 주 개인 최고 점수를 Firestore에 저장합니다.
주차별 컬렉션을 사용하므로 매주 월요일 한국 시간 기준으로 새 랭킹이 자동 시작됩니다.

## 파일

- `index.html`: 게임/랭킹/닉네임 모달 화면
- `style.css`: 화면 디자인
- `game.js`: 게임 및 랭킹 UI 연결
- `firebase-ranking.js`: 익명 로그인, 점수 등록, 랭킹 조회
- `firebase-config.js`: Firebase 웹 앱 설정값
- `firestore.rules`: Firestore 보안 규칙

## Firebase 설정

1. Firebase 콘솔에서 프로젝트와 웹 앱을 만듭니다.
2. Authentication > Sign-in method에서 **Anonymous(익명)** 로그인을 활성화합니다.
3. Firestore Database를 생성합니다.
4. 웹 앱의 `firebaseConfig` 값을 `firebase-config.js`에 붙여 넣습니다.
5. `firestore.rules` 내용을 Firestore > Rules에 붙여 넣고 게시합니다.
6. GitHub Pages에 모든 파일을 함께 올립니다.

## 주간 랭킹 구조

```text
weeklyRankings/{2026-W30}/scores/{anonymousUid}
```

실제 데이터를 삭제하지 않고 현재 주차만 조회하므로, 매주 자동 초기화처럼 동작합니다.
같은 브라우저의 익명 사용자에게는 해당 주의 최고 점수만 저장됩니다.

## 로컬 실행

ES Module을 사용하므로 파일을 직접 더블클릭하지 말고 로컬 서버로 실행하세요.

```bash
python -m http.server 8000
```

브라우저에서 `http://localhost:8000`으로 접속합니다.


## 검은 구슬 설정

`game.js` 상단에서 다음 값을 수정할 수 있습니다.

```js
// 몇 턴마다 검은 구슬 한 개를 추가할지
const BLACK_BALL_INTERVAL = 25;

// 검은 구슬 한 개의 과부하 수치
const BLACK_BALL_OVERLOAD = 5;
```

검은 구슬은 숫자가 표시되지 않고 합이 8인 충돌에도 터지지 않습니다.
물리 충돌 및 폭발로 밀리는 효과는 그대로 적용됩니다.
