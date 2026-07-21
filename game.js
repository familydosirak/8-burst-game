import {
  getCurrentWeekId,
  getWeeklyRanking,
  initializeRanking,
  isFirebaseConfigured,
  submitWeeklyScore,
  getCurrentWeekRange
} from "./firebase-ranking.js";

(() => {
  "use strict";

  const { Engine, World, Bodies, Body, Events } = Matter;

  /* =========================================================
   * DOM / CANVAS
   * ======================================================= */

  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });

  const ui = {
    score: document.querySelector("#score"),
    combo: document.querySelector("#combo"),
    best: document.querySelector("#best"),
    turn: document.querySelector("#turn"),
    load: document.querySelector("#load"),
    loadBar: document.querySelector("#loadBar"),
    state: document.querySelector("#state"),
    msg: document.querySelector("#msg"),
    powerText: document.querySelector("#powerText"),
    powerBar: document.querySelector("#powerBar"),
    currentBall: document.querySelector("#currentBall"),
    nextBalls: document.querySelector("#nextBalls"),
    resetButton: document.querySelector("#resetButton"),
    rankingWeek: document.querySelector("#rankingWeek"),
    rankingList: document.querySelector("#rankingList"),
    refreshRankingButton: document.querySelector("#refreshRankingButton"),
    nicknameModal: document.querySelector("#nicknameModal"),
    finalScoreText: document.querySelector("#finalScoreText"),
    nicknameInput: document.querySelector("#nicknameInput"),
    nicknameMessage: document.querySelector("#nicknameMessage"),
    submitRankingButton: document.querySelector("#submitRankingButton"),
    skipRankingButton: document.querySelector("#skipRankingButton")
  };

  /* =========================================================
   * GAME SETTINGS
   * ======================================================= */

  const W = 680;
  const H = 590;
  const TOP = 20;
  const FLOOR = 590;

  const BALL_RADIUS = 18;
  // 화면에 공이 이 개수 이상이면 과부하 상태가 된다.
  const BALL_COUNT_LIMIT = 75;
  
  const SHOOT_X = W / 2;

  // 뒤쪽 발사가 가능하도록 바닥에서 조금 위에 배치한다.
  const LAUNCH_Y = FLOOR - BALL_RADIUS - 62;

  const MIN_POWER = 5;
  const MAX_POWER = 22;
  const CHARGE_SPEED = 13;

  // 180도까지 허용하면 발사 공의 완전한 뒤쪽도 조준할 수 있다.
  const MAX_AIM_ANGLE_DEGREES = 180;

  const BLAST_RADIUS = 123;
  const BLAST_FORCE = 16;

  // 첫 번째 폭발 점수
  const BASE_COMBO_SCORE = 8;

  // 콤보마다 적용되는 점수 배율
  const COMBO_SCORE_MULTIPLIER = 1.7;

  /*
  * 숫자 생성 밸런스
  *
  * 값이 0이면 완전 랜덤.
  * 값이 커질수록 필드에 많은 숫자가 덜 등장한다.
  *
  * 추천 범위: 0.08 ~ 0.2
  */
  const NUMBER_BALANCE_STRENGTH = 0.12;

  /*
  * 아무리 필드에 많이 쌓여도
  * 해당 숫자가 나올 최소 확률 가중치.
  *
  * 너무 낮으면 지나치게 균형 잡힌 숫자만 나온다.
  */
  const MIN_NUMBER_WEIGHT = 0.35;

  /*
   * 검은 구슬 설정
   *
   * BLACK_BALL_INTERVAL:
   *   몇 턴마다 검은 구슬을 한 개 추가할지 설정한다.
   *
   * BLACK_BALL_OVERLOAD:
   *   검은 구슬 한 개가 차지하는 과부하 수치다.
   */
  const BLACK_BALL_INTERVAL = 10;
  const BLACK_BALL_OVERLOAD = 5;
  const BLACK_BALL_COLOR = "#111111";

  /*
   * 기본 마찰(frictionAir)은 그대로 유지한다.
   * 공의 속도가 LOW_SPEED_THRESHOLD보다 느려지면
   * LOW_SPEED_DAMPING을 매 프레임 적용하여 빠르게 정지시킨다.
   */
  const NORMAL_AIR_FRICTION = 0.018;
  const LOW_SPEED_THRESHOLD = 1.35;
  const LOW_SPEED_DAMPING = 0.76;
  const SNAP_STOP_SPEED = 0.08;

  // 턴 종료를 판단하기 위한 설정
  const REQUIRED_QUIET_FRAMES = 10;
  const MAX_SHOT_DURATION_MS = 10000;

  // 폭발 이펙트 성능 제한
  const MAX_PARTICLES = 160;
  const PARTICLES_PER_EXPLOSION = 14;
  const MAX_RINGS = 24;
  const MAX_FLOATING_TEXTS = 16;

  const COLORS = {
    red: "#e53935",
    yellow: "#f6c700",
    green: "#2eaf59",
    blue: "#2878d0"
  };

  /* =========================================================
   * GAME STATE
   * ======================================================= */

  let engine;

  let balls = [];
  let ballByBodyId = new Map();

  let queue = [];
  let currentNumber = 1;

  let score = 0;
  let combo = 0;
  let bestCombo = 0;
  let turn = 0;

  let moving = false;
  let gameOver = false;

  let overload = false;
  let overloadShot = false;

  let shotStartedAt = 0;
  let quietFrames = 0;
  let previousTime = performance.now();

  let shake = 0;
  let flash = 0;

  let particles = [];
  let rings = [];
  let floatingTexts = [];

  let aimAngle = 0;
  let charging = false;
  let chargePower = MIN_POWER;
  let chargeDirection = 1;
  let activePointerId = null;

  // 한 게임 결과에 대해 닉네임 창을 한 번만 연다.
  let rankingModalOpened = false;
  let rankingSubmitting = false;

  /**
   * 필드에 적게 있는 숫자는 조금 더 잘 나오고,
   * 많이 쌓인 숫자는 조금 덜 나오도록 생성한다.
   *
   * 단, 최소 가중치를 유지하므로
   * 많이 쌓인 숫자도 계속 등장할 수 있다.
   */
  function randomNumber() {
    const counts = Array(8).fill(0);

    // 검은 구슬과 발사 준비 공은 숫자 분포에서 제외한다.
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];

      if (
        ball.isBlack ||
        ball.number < 1 ||
        ball.number > 7
      ) {
        continue;
      }

      counts[ball.number]++;
    }

    const weights = [];

    for (let number = 1; number <= 7; number++) {
      /*
      * 공이 많을수록 가중치 감소
      *
      * 예:
      * 0개 → 1.00
      * 2개 → 0.81
      * 5개 → 0.63
      * 10개 → 0.45
      */
      const weight = Math.max(
        MIN_NUMBER_WEIGHT,
        1 / (
          1 +
          counts[number] *
          NUMBER_BALANCE_STRENGTH
        )
      );

      weights.push(weight);
    }

    return pickWeightedNumber(weights);
  }

  /**
   * 전달받은 가중치에 따라 1~7 중 하나를 선택한다.
   */
  function pickWeightedNumber(weights) {
    let totalWeight = 0;

    for (let i = 0; i < weights.length; i++) {
      totalWeight += weights[i];
    }

    let random =
      Math.random() * totalWeight;

    for (let i = 0; i < weights.length; i++) {
      random -= weights[i];

      if (random <= 0) {
        return i + 1;
      }
    }

    return 7;
  }

  function numberColor(number) {
    if (number === 1 || number === 7) {
      return COLORS.red;
    }

    if (number === 2 || number === 6) {
      return COLORS.yellow;
    }

    if (number === 3 || number === 5) {
      return COLORS.green;
    }

    return COLORS.blue;
  }

  function numberTextColor(number) {
    return number === 2 || number === 6 ? "#181818" : "#ffffff";
  }

  /* =========================================================
   * HUD
   * ======================================================= */

  function setStatus(message, badge = "READY") {
    ui.msg.textContent = message;
    ui.state.textContent = badge;

    ui.state.style.background =
      badge === "GAME OVER" || badge === "OVERLOAD"
        ? COLORS.red
        : "var(--accent)";
  }

  /**
   * 현재 필드에 존재하는 공의 개수를 반환한다.
   *
   * 일반 숫자 공과 검은 구슬을 모두 1개로 계산한다.
   */
  function fieldBallCount() {
    return balls.length;
  }

  function updateHud() {
    const load = fieldBallCount();

    const powerPercent = charging
      ? ((chargePower - MIN_POWER) / (MAX_POWER - MIN_POWER)) * 100
      : 0;

    ui.score.textContent = score.toLocaleString();
    ui.combo.textContent = combo;
    ui.best.textContent = bestCombo;
    ui.turn.textContent = turn;

   const ballCount =
    fieldBallCount();

  ui.load.textContent =
    ballCount;

  ui.loadBar.style.width =
    `${Math.min(
      100,
      (
        ballCount /
        BALL_COUNT_LIMIT
      ) * 100
    )}%`;

    ui.loadBar.style.background =
    ballCount >= BALL_COUNT_LIMIT
      ? COLORS.red
      : "var(--accent)";

    ui.powerBar.style.width = `${powerPercent}%`;
    ui.powerText.textContent = charging
      ? chargePower.toFixed(1)
      : "대기";

    ui.currentBall.textContent = currentNumber;
    ui.currentBall.style.background = numberColor(currentNumber);
    ui.currentBall.style.color = numberTextColor(currentNumber);

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < queue.length; i++) {
      const number = queue[i];
      const badge = document.createElement("span");

      badge.className = "badge";
      badge.textContent = number;
      badge.style.background = numberColor(number);
      badge.style.color = numberTextColor(number);

      fragment.appendChild(badge);
    }

    ui.nextBalls.replaceChildren(fragment);
  }

  /* =========================================================
   * PHYSICS OBJECTS
   * ======================================================= */

  function createWalls() {
    World.add(engine.world, [
      Bodies.rectangle(W / 2, 0, W, 40, {
        isStatic: true
      }),

      Bodies.rectangle(W / 2, FLOOR + 20, W, 40, {
        isStatic: true
      }),

      Bodies.rectangle(-20, H / 2, 40, H, {
        isStatic: true
      }),

      Bodies.rectangle(W + 20, H / 2, 40, H, {
        isStatic: true
      })
    ]);
  }

  function addBall(
    x,
    y,
    number,
    velocityX = 0,
    velocityY = 0,
    isShot = false,
    isBlack = false
  ) {
    const body = Bodies.circle(x, y, BALL_RADIUS, {
      restitution: 0.96,
      friction: 0,
      frictionAir: NORMAL_AIR_FRICTION,
      label: "ball"
    });

    Body.setVelocity(body, {
      x: velocityX,
      y: velocityY
    });

    World.add(engine.world, body);

    const ball = {
      body,
      number,
      isShot,
      isBlack
    };

    balls.push(ball);
    ballByBodyId.set(body.id, ball);

    return ball;
  }

  function removeBall(ball) {
    World.remove(engine.world, ball.body);
    ballByBodyId.delete(ball.body.id);

    const index = balls.indexOf(ball);

    if (index !== -1) {
      balls.splice(index, 1);
    }
  }

  /* =========================================================
   * FIELD GENERATION
   * ======================================================= */

  function seedField() {
    [4, 5, 4].forEach((count, row) => {
      const gap = 47;
      const startX = W / 2 - ((count - 1) * gap) / 2;

      for (let i = 0; i < count; i++) {
        addBall(
          startX + i * gap + (row % 2 ? 10 : -10),
          92 + row * 42,
          randomNumber()
        );
      }
    });
  }

  function waveAmountForTurn(currentTurn) {
    // 초반 6개에서 시작하여 6턴마다 한 개씩 증가한다.
    return Math.min(16, 6 + Math.floor(currentTurn / 6));
  }

  /**
   * 현재 턴에 맞는 개수만큼 새로운 숫자 공을 추가한다.
   *
   * 1. 먼저 임의의 위치에 배치를 시도한다.
   * 2. 임의 배치에 실패하면 격자 방식으로 빈자리를 검색한다.
   */
  function addWave() {
    const amount = waveAmountForTurn(turn);
    let created = 0;

    while (created < amount) {
      const position = findWaveSpawnPosition();

      // 화면 위쪽에 더 이상 빈 공간이 없으면 생성 중단
      if (!position) {
        console.warn(
          `공을 배치할 공간이 부족합니다. 요청: ${amount}, 생성: ${created}`
        );

        break;
      }

      addBall(
        position.x,
        position.y,
        randomNumber()
      );

      created++;
    }

    return created;
  }

  /**
   * 새로운 공을 배치할 빈 위치를 찾는다.
   */
  function findWaveSpawnPosition() {
    const minimumDistance =
      BALL_RADIUS * 2 + 6;

    const minimumDistanceSquared =
      minimumDistance * minimumDistance;

    /**
     * 해당 위치에 다른 공이 없는지 확인한다.
     */
    function isPositionClear(x, y) {
      for (let i = 0; i < balls.length; i++) {
        const position =
          balls[i].body.position;

        const dx = position.x - x;
        const dy = position.y - y;

        if (
          dx * dx + dy * dy <
          minimumDistanceSquared
        ) {
          return false;
        }
      }

      return true;
    }

    /*
    * 1차: 임의 위치 검색
    *
    * 기존보다 생성 가능 영역을 아래쪽까지 넓혔다.
    */
    for (let attempt = 0; attempt < 1500; attempt++) {
      const x =
        BALL_RADIUS + 10 +
        Math.random() *
          (
            W -
            (BALL_RADIUS + 10) * 2
          );

      const y =
        TOP +
        BALL_RADIUS +
        15 +
        Math.random() * 250;

      if (isPositionClear(x, y)) {
        return { x, y };
      }
    }

    /*
    * 2차: 격자로 빈자리 검색
    *
    * 랜덤 검색에서 빈자리를 놓치는 경우를 방지한다.
    */
    const gap = minimumDistance;

    for (
      let y = TOP + BALL_RADIUS + 15;
      y <= 330;
      y += gap
    ) {
      for (
        let x = BALL_RADIUS + 10;
        x <= W - BALL_RADIUS - 10;
        x += gap
      ) {
        if (isPositionClear(x, y)) {
          return { x, y };
        }
      }
    }

    // 실제로 공간이 하나도 없는 경우
    return null;
  }

  /**
   * 필드의 빈 위치를 찾아 검은 구슬을 한 개 추가한다.
   *
   * 검은 구슬은 숫자가 없으며 폭발하지 않는다.
   * 물리 충돌과 폭발 충격에는 일반 공처럼 반응한다.
   */
  function addBlackBall() {
    let tries = 0;

    const maxTries = 1000;
    const minimumDistance = BALL_RADIUS * 2 + 9;
    const minimumDistanceSquared =
      minimumDistance * minimumDistance;

    while (tries++ < maxTries) {
      const x =
        BALL_RADIUS +
        15 +
        Math.random() *
          (W - (BALL_RADIUS + 15) * 2);

      const y = 58 + Math.random() * 190;

      let clear = true;

      for (let i = 0; i < balls.length; i++) {
        const position = balls[i].body.position;
        const dx = position.x - x;
        const dy = position.y - y;

        if (
          dx * dx + dy * dy <=
          minimumDistanceSquared
        ) {
          clear = false;
          break;
        }
      }

      if (clear) {
        addBall(
          x,
          y,
          0,
          0,
          0,
          false,
          true
        );

        return true;
      }
    }

    return false;
  }

  /* =========================================================
   * RESET
   * ======================================================= */

  function resetGame() {
    engine = Engine.create({
      gravity: {
        x: 0,
        y: 0
      }
    });

    balls = [];
    ballByBodyId = new Map();

    queue = [
      randomNumber(),
      randomNumber(),
      randomNumber()
    ];

    currentNumber = randomNumber();

    score = 0;
    combo = 0;
    bestCombo = 0;
    turn = 0;

    moving = false;
    gameOver = false;

    overload = false;
    overloadShot = false;

    quietFrames = 0;

    shake = 0;
    flash = 0;

    particles = [];
    rings = [];
    floatingTexts = [];

    aimAngle = 0;

    charging = false;
    chargePower = MIN_POWER;
    chargeDirection = 1;
    activePointerId = null;
    rankingModalOpened = false;
    rankingSubmitting = false;

    closeNicknameModal();
    canvas.classList.remove("charging");

    createWalls();
    seedField();
    bindCollisionEvents();

    setStatus(
      "원하는 방향을 누르고 있다가 힘을 맞춰 놓으세요."
    );

    updateHud();
  }

  /* =========================================================
   * SCORE
   * ======================================================= */

  function addScore() {
    combo++;

    bestCombo = Math.max(
      bestCombo,
      combo
    );

    // 콤보마다 1.5배 증가하고 소수점 이하는 버린다.
    const gained = Math.floor(
      BASE_COMBO_SCORE *
      Math.pow(
        COMBO_SCORE_MULTIPLIER,
        combo - 1
      )
    );

    score += gained;

    updateHud();

    return gained;
  }

  /* =========================================================
   * EXPLOSION
   * ======================================================= */

  function createExplosion(
    x,
    y,
    color,
    gained,
    strength = 1
  ) {
    flash = Math.max(
      flash,
      0.28 * strength
    );

    shake = Math.max(
      shake,
      7 * strength
    );

    if (rings.length < MAX_RINGS) {
      rings.push({
        x,
        y,
        radius: 14,
        life: 0.75,
        color,
        speed: 155 * strength
      });
    }

    if (rings.length < MAX_RINGS) {
      rings.push({
        x,
        y,
        radius: 5,
        life: 0.55,
        color: "#ffffff",
        speed: 95 * strength
      });
    }

    const availableParticleSlots =
      MAX_PARTICLES - particles.length;

    const particleCount = Math.min(
      availableParticleSlots,
      Math.round(
        PARTICLES_PER_EXPLOSION * strength
      )
    );

    for (let i = 0; i < particleCount; i++) {
      const angle =
        Math.random() * Math.PI * 2;

      const speed =
        (70 + Math.random() * 145) *
        strength;

      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 3.5,
        life: 0.42 + Math.random() * 0.28,
        color:
          Math.random() < 0.22
            ? "#ffffff"
            : color
      });
    }

    if (
      floatingTexts.length <
      MAX_FLOATING_TEXTS
    ) {
      floatingTexts.push({
        x,
        y: y - 10,
        text: `+${gained}`,
        life: 0.9,
        color,
        combo: false
      });
    }

    if (
      combo >= 3 &&
      floatingTexts.length <
        MAX_FLOATING_TEXTS
    ) {
      floatingTexts.push({
        x,
        y: y + 24,
        text: `${combo} COMBO!`,
        life: 0.85,
        color: "#ffffff",
        combo: true
      });
    }
  }

  function applyBlast(
    x,
    y,
    ignored = []
  ) {
    const ignoredIds = new Set();

    for (let i = 0; i < ignored.length; i++) {
      ignoredIds.add(
        ignored[i].body.id
      );
    }

    const radiusSquared =
      BLAST_RADIUS * BLAST_RADIUS;

    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];

      if (
        ignoredIds.has(ball.body.id)
      ) {
        continue;
      }

      const dx =
        ball.body.position.x - x;

      const dy =
        ball.body.position.y - y;

      const distanceSquared =
        dx * dx + dy * dy;

      if (
        distanceSquared >= radiusSquared
      ) {
        continue;
      }

      const distance =
        Math.sqrt(distanceSquared) || 1;

      const force =
        BLAST_FORCE *
        (1 - distance / BLAST_RADIUS);

      const velocity =
        ball.body.velocity;

      Body.setVelocity(ball.body, {
        x:
          velocity.x +
          (dx / distance) * force,

        y:
          velocity.y +
          (dy / distance) * force
      });
    }
  }

  /* =========================================================
   * COLLISION
   * ======================================================= */

  function bindCollisionEvents() {
    Events.on(
      engine,
      "collisionStart",
      event => {
        const pairs = event.pairs;

        for (
          let i = 0;
          i < pairs.length;
          i++
        ) {
          const pair = pairs[i];

          const first =
            ballByBodyId.get(
              pair.bodyA.id
            );

          const second =
            ballByBodyId.get(
              pair.bodyB.id
            );

          if (
            !first ||
            !second ||
            first.isBlack ||
            second.isBlack ||
            first.number + second.number !== 8
          ) {
            continue;
          }

          const relativeVelocityX =
            first.body.velocity.x -
            second.body.velocity.x;

          const relativeVelocityY =
            first.body.velocity.y -
            second.body.velocity.y;

          if (
            relativeVelocityX *
              relativeVelocityX +
              relativeVelocityY *
                relativeVelocityY <
            0.1225
          ) {
            continue;
          }

          if (
            first.isShot !== second.isShot
          ) {
            handleShotCollision(
              first,
              second
            );
          } else if (
            !first.isShot &&
            !second.isShot
          ) {
            handleFieldCollision(
              first,
              second
            );
          }
        }
      }
    );
  }

  function handleShotCollision(
    first,
    second
  ) {
    const shotBall =
      first.isShot ? first : second;

    const target =
      first.isShot ? second : first;

    const x =
      target.body.position.x;

    const y =
      target.body.position.y;

    const color =
      numberColor(target.number);

    removeBall(target);

    const gained =
      addScore();

    const velocityX =
      shotBall.body.velocity.x;

    const velocityY =
      shotBall.body.velocity.y;

    const speed =
      Math.hypot(
        velocityX,
        velocityY
      ) || 1;

    const restoredSpeed =
      Math.min(
        21,
        speed * 1.17 + 1.35
      );

    Body.setVelocity(
      shotBall.body,
      {
        x:
          (velocityX / speed) *
          restoredSpeed,

        y:
          (velocityY / speed) *
          restoredSpeed
      }
    );

    createExplosion(
      x,
      y,
      color,
      gained,
      1
    );

    applyBlast(
      x,
      y,
      [shotBall]
    );
  }

  function handleFieldCollision(
    first,
    second
  ) {
    const x =
      (
        first.body.position.x +
        second.body.position.x
      ) / 2;

    const y =
      (
        first.body.position.y +
        second.body.position.y
      ) / 2;

    const color =
      numberColor(first.number);

    removeBall(first);
    removeBall(second);

    const gained =
      addScore();

    createExplosion(
      x,
      y,
      color,
      gained,
      1.25
    );

    applyBlast(x, y);
  }

  /* =========================================================
   * SHOT
   * ======================================================= */

  function advanceQueueImmediately() {
    currentNumber = queue.shift();
    queue.push(randomNumber());
  }

  function launch(power) {
    if (moving || gameOver) {
      return;
    }

    const firedNumber =
      currentNumber;

    combo = 0;
    overloadShot = overload;
    turn++;

    addBall(
      SHOOT_X,
      LAUNCH_Y,
      firedNumber,
      Math.sin(aimAngle) * power,
      -Math.cos(aimAngle) * power,
      true
    );

    // 발사 즉시 준비 공을 다음 숫자로 변경한다.
    advanceQueueImmediately();

    moving = true;
    shotStartedAt =
      performance.now();

    quietFrames = 0;

    setStatus(
      overload
        ? "과부하 해소 샷! 180 아래로 낮추세요."
        : "공이 움직이는 중입니다.",

      overload
        ? "OVERLOAD"
        : "PLAY"
    );

    updateHud();
  }

  /* =========================================================
   * LOW-SPEED BRAKING
   * ======================================================= */

  function applyLowSpeedBraking() {
    for (let i = 0; i < balls.length; i++) {
      const body = balls[i].body;

      const velocityX =
        body.velocity.x;

      const velocityY =
        body.velocity.y;

      const speedSquared =
        velocityX * velocityX +
        velocityY * velocityY;

      if (
        speedSquared <=
        SNAP_STOP_SPEED * SNAP_STOP_SPEED
      ) {
        Body.setVelocity(body, {
          x: 0,
          y: 0
        });

        Body.setAngularVelocity(
          body,
          0
        );

        continue;
      }

      if (
        speedSquared <=
        LOW_SPEED_THRESHOLD *
          LOW_SPEED_THRESHOLD
      ) {
        Body.setVelocity(body, {
          x:
            velocityX *
            LOW_SPEED_DAMPING,

          y:
            velocityY *
            LOW_SPEED_DAMPING
        });

        Body.setAngularVelocity(
          body,
          body.angularVelocity *
            LOW_SPEED_DAMPING
        );
      }
    }
  }

  function areAllBallsStopped() {
    const stopSpeedSquared =
      SNAP_STOP_SPEED *
      SNAP_STOP_SPEED;

    for (let i = 0; i < balls.length; i++) {
      const velocity =
        balls[i].body.velocity;

      if (
        velocity.x * velocity.x +
          velocity.y * velocity.y >
        stopSpeedSquared
      ) {
        return false;
      }
    }

    return true;
  }

  /* =========================================================
   * FIREBASE WEEKLY RANKING
   * ======================================================= */

  function openNicknameModal() {
    if (rankingModalOpened) {
      return;
    }

    rankingModalOpened = true;
    ui.finalScoreText.textContent = `${score.toLocaleString()}점`;
    ui.nicknameMessage.textContent = "";
    ui.nicknameMessage.classList.remove("error");

    const savedNickname = localStorage.getItem("burst8Nickname") || "";
    ui.nicknameInput.value = savedNickname;
    ui.nicknameModal.hidden = false;

    requestAnimationFrame(() => {
      ui.nicknameInput.focus();
      ui.nicknameInput.select();
    });
  }

  function closeNicknameModal() {
    ui.nicknameModal.hidden = true;
    ui.nicknameMessage.textContent = "";
    ui.nicknameMessage.classList.remove("error");
  }

  async function submitGameResult() {
    if (rankingSubmitting) {
      return;
    }

    const nickname = ui.nicknameInput.value.trim();

    if (!nickname) {
      ui.nicknameMessage.textContent = "닉네임을 입력해 주세요.";
      ui.nicknameMessage.classList.add("error");
      ui.nicknameInput.focus();
      return;
    }

    if (!isFirebaseConfigured()) {
      ui.nicknameMessage.textContent =
        "firebase-config.js에 Firebase 설정값을 먼저 입력해 주세요.";
      ui.nicknameMessage.classList.add("error");
      return;
    }

    rankingSubmitting = true;
    ui.submitRankingButton.disabled = true;
    ui.skipRankingButton.disabled = true;
    ui.nicknameMessage.textContent = "랭킹을 등록하는 중입니다...";
    ui.nicknameMessage.classList.remove("error");

    try {
      const result = await submitWeeklyScore({
        nickname,
        score,
        bestCombo,
        turn
      });

      localStorage.setItem("burst8Nickname", nickname);

      ui.nicknameMessage.textContent = result.updated
        ? "이번 주 최고 점수가 등록되었습니다."
        : `기존 최고 점수 ${result.previousScore.toLocaleString()}점이 더 높습니다.`;

      await renderWeeklyRanking();

      window.setTimeout(() => {
        closeNicknameModal();
      }, 900);
    } catch (error) {
      console.error("랭킹 등록 실패:", error);

      ui.nicknameMessage.textContent =
        error?.message === "NICKNAME_REQUIRED"
          ? "닉네임을 입력해 주세요."
          : "랭킹 등록에 실패했습니다. Firebase 설정과 보안 규칙을 확인해 주세요.";

      ui.nicknameMessage.classList.add("error");
    } finally {
      rankingSubmitting = false;
      ui.submitRankingButton.disabled = false;
      ui.skipRankingButton.disabled = false;
    }
  }

  async function renderWeeklyRanking() {
    ui.rankingWeek.textContent = getCurrentWeekRange();

    if (!isFirebaseConfigured()) {
      ui.rankingList.innerHTML =
        '<li class="ranking-empty">firebase-config.js에 프로젝트 설정값을 입력해 주세요.</li>';
      return;
    }

    ui.rankingList.innerHTML =
      '<li class="ranking-empty">랭킹을 불러오는 중입니다...</li>';

    try {
      const result = await getWeeklyRanking(20);
      ui.rankingWeek.textContent = result.weekId;

      if (result.rankings.length === 0) {
        ui.rankingList.innerHTML =
          '<li class="ranking-empty">이번 주에 등록된 점수가 없습니다.</li>';
        return;
      }

      ui.rankingList.replaceChildren(
        ...result.rankings.map(item => {
          const row = document.createElement("li");
          row.className = "ranking-item";

          const rank = document.createElement("span");
          rank.className = "ranking-rank";
          rank.textContent = `${item.rank}위`;

          const player = document.createElement("span");
          player.className = "ranking-name";
          player.textContent = item.nickname;

          const resultBox = document.createElement("span");
          resultBox.className = "ranking-score";
          resultBox.textContent = `${item.score.toLocaleString()}점`;
          resultBox.title = `최고 콤보 ${item.bestCombo} · ${item.turn}턴`;

          row.append(rank, player, resultBox);
          return row;
        })
      );
    } catch (error) {
      console.error("랭킹 조회 실패:", error);
      ui.rankingList.innerHTML =
        '<li class="ranking-empty">랭킹을 불러오지 못했습니다.</li>';
    }
  }

  /* =========================================================
   * TURN END
   * ======================================================= */

  function finishTurn() {
    for (let i = 0; i < balls.length; i++) {
      Body.setVelocity(
        balls[i].body,
        {
          x: 0,
          y: 0
        }
      );

      Body.setAngularVelocity(
        balls[i].body,
        0
      );

      balls[i].isShot = false;
    }

    moving = false;
    quietFrames = 0;

    if (overloadShot) {
      if (
        fieldBallCount() >=
        BALL_COUNT_LIMIT
      ) {
        gameOver = true;

        setStatus(
          `게임 오버 · ${score.toLocaleString()}점`,
          "GAME OVER"
        );

        openNicknameModal();
      } else {
        overload = false;

        setStatus(
          "과부하 해소 성공!",
          "SAVED"
        );
      }
    } else {
      let statusMessage =
        "다음 발사를 준비하세요.";

      let statusBadge = "READY";

      if (turn % 2 === 0) {
        const added = addWave();

        statusMessage =
          `새 숫자 공 ${added}개가 추가되었습니다.`;

        statusBadge = "WAVE";
      }

      /*
       * 설정된 턴마다 검은 구슬을 한 개 추가한다.
       * 예: BLACK_BALL_INTERVAL이 25라면
       * 25, 50, 75턴 종료 시 생성된다.
       */
      if (
        BLACK_BALL_INTERVAL > 0 &&
        turn % BLACK_BALL_INTERVAL === 0
      ) {
        const blackBallAdded =
          addBlackBall();

        if (blackBallAdded) {
          statusMessage +=
            ` 검은 구슬이 추가되었습니다.`;
        }
      }

      setStatus(
        statusMessage,
        statusBadge
      );

      if (
        fieldBallCount() >=
        BALL_COUNT_LIMIT
      ) {
        overload = true;

        setStatus(
          "OVERLOAD! 다음 한 발로 180 아래로 낮추세요.",
          "OVERLOAD"
        );
      }
    }

    updateHud();
  }

  /* =========================================================
   * POINTER / AIM
   * ======================================================= */

  function pointerPosition(event) {
    const rect =
      canvas.getBoundingClientRect();

    return {
      x:
        (
          event.clientX -
          rect.left
        ) *
        W /
        rect.width,

      y:
        (
          event.clientY -
          rect.top
        ) *
        H /
        rect.height
    };
  }

  function updateAim(event) {
    const pointer =
      pointerPosition(event);

    /*
     * Math.max(...)를 사용하지 않는다.
     * 따라서 발사 공보다 아래쪽을 누르면
     * 90도를 넘는 뒤쪽 각도가 정상 계산된다.
     *
     * 0도   : 위
     * 90도  : 오른쪽
     * -90도 : 왼쪽
     * 180도 : 아래
     */
    const rawAngle = Math.atan2(
      pointer.x - SHOOT_X,
      LAUNCH_Y - pointer.y
    );

    const maxAngle =
      (
        MAX_AIM_ANGLE_DEGREES *
        Math.PI
      ) / 180;

    aimAngle = Math.max(
      -maxAngle,
      Math.min(
        maxAngle,
        rawAngle
      )
    );
  }

  function beginCharge(event) {
    if (
      moving ||
      gameOver ||
      charging
    ) {
      return;
    }

    event.preventDefault();

    activePointerId =
      event.pointerId;

    canvas.setPointerCapture(
      event.pointerId
    );

    updateAim(event);

    charging = true;
    chargePower = MIN_POWER;
    chargeDirection = 1;

    canvas.classList.add(
      "charging"
    );

    setStatus(
      "힘을 맞춘 뒤 손을 놓으세요.",
      "CHARGING"
    );

    updateHud();
  }

  function moveCharge(event) {
    if (
      !charging ||
      event.pointerId !==
        activePointerId
    ) {
      return;
    }

    event.preventDefault();
    updateAim(event);
  }

  function releaseCharge(event) {
    if (
      !charging ||
      event.pointerId !==
        activePointerId
    ) {
      return;
    }

    event.preventDefault();

    const releasedPower =
      chargePower;

    charging = false;
    activePointerId = null;

    canvas.classList.remove(
      "charging"
    );

    if (
      canvas.hasPointerCapture(
        event.pointerId
      )
    ) {
      canvas.releasePointerCapture(
        event.pointerId
      );
    }

    ui.powerBar.style.width =
      "0%";

    ui.powerText.textContent =
      releasedPower.toFixed(1);

    launch(releasedPower);
  }

  function cancelCharge(event) {
    if (
      !charging ||
      event.pointerId !==
        activePointerId
    ) {
      return;
    }

    charging = false;
    activePointerId = null;

    canvas.classList.remove(
      "charging"
    );

    setStatus(
      "발사가 취소되었습니다. 다시 눌러주세요."
    );

    updateHud();
  }

  /* =========================================================
   * AIM GUIDE
   * ======================================================= */

  function calculateAimSegments() {
    let x = SHOOT_X;
    let y = LAUNCH_Y;

    let directionX =
      Math.sin(aimAngle);

    let directionY =
      -Math.cos(aimAngle);

    const segments = [];

    for (
      let bounce = 0;
      bounce < 5;
      bounce++
    ) {
      const times = [];

      if (directionX > 0) {
        times.push({
          t:
            (
              W -
              BALL_RADIUS -
              x
            ) / directionX,

          wall: "right"
        });
      }

      if (directionX < 0) {
        times.push({
          t:
            (
              BALL_RADIUS -
              x
            ) / directionX,

          wall: "left"
        });
      }

      if (directionY < 0) {
        times.push({
          t:
            (
              TOP +
              BALL_RADIUS -
              y
            ) / directionY,

          wall: "top"
        });
      }

      if (directionY > 0) {
        times.push({
          t:
            (
              FLOOR -
              BALL_RADIUS -
              y
            ) / directionY,

          wall: "bottom"
        });
      }

      const hit = times
        .filter(item => item.t > 0.001)
        .sort(
          (a, b) => a.t - b.t
        )[0];

      if (!hit) {
        break;
      }

      const nextX =
        x + directionX * hit.t;

      const nextY =
        y + directionY * hit.t;

      segments.push({
        x1: x,
        y1: y,
        x2: nextX,
        y2: nextY
      });

      x = nextX;
      y = nextY;

      if (
        hit.wall === "left" ||
        hit.wall === "right"
      ) {
        directionX *= -1;
      } else {
        directionY *= -1;
      }
    }

    return segments;
  }

  function drawAimGuide() {
    if (moving || gameOver) {
      return;
    }

    const segments =
      calculateAimSegments();

    const intensity = charging
      ? (
          chargePower -
          MIN_POWER
        ) /
        (
          MAX_POWER -
          MIN_POWER
        )
      : 0.35;

    ctx.save();
    ctx.lineCap = "round";

    for (
      let i = 0;
      i < segments.length;
      i++
    ) {
      const segment =
        segments[i];

      ctx.beginPath();

      ctx.moveTo(
        segment.x1,
        segment.y1
      );

      ctx.lineTo(
        segment.x2,
        segment.y2
      );

      if (i === 0) {
        ctx.setLineDash([]);

        ctx.lineWidth =
          4 + intensity * 3;

        ctx.strokeStyle =
          `rgba(255,255,255,${
            0.72 +
            intensity * 0.28
          })`;
      } else {
        ctx.setLineDash([
          10,
          11
        ]);

        ctx.lineWidth = 3;

        ctx.strokeStyle =
          `rgba(255,255,255,${
            Math.max(
              0.18,
              0.58 -
                i * 0.11
            )
          })`;
      }

      ctx.stroke();
    }

    if (charging) {
      const pulseRadius =
        BALL_RADIUS +
        8 +
        intensity * 15;

      ctx.setLineDash([]);

      ctx.beginPath();

      ctx.arc(
        SHOOT_X,
        LAUNCH_Y,
        pulseRadius,
        0,
        Math.PI * 2
      );

      ctx.strokeStyle =
        numberColor(
          currentNumber
        );

      ctx.globalAlpha =
        0.35 +
        intensity * 0.5;

      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.restore();
  }

  /* =========================================================
   * EFFECT UPDATE / DRAW
   * ======================================================= */

  function updateEffects(deltaTime) {
    for (
      let i = particles.length - 1;
      i >= 0;
      i--
    ) {
      const particle =
        particles[i];

      particle.life -=
        deltaTime;

      if (particle.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      particle.x +=
        particle.vx * deltaTime;

      particle.y +=
        particle.vy * deltaTime;

      particle.vx *= 0.96;

      particle.vy =
        particle.vy * 0.96 +
        65 * deltaTime;
    }

    for (
      let i = rings.length - 1;
      i >= 0;
      i--
    ) {
      const ring = rings[i];

      ring.life -= deltaTime;

      if (ring.life <= 0) {
        rings.splice(i, 1);
        continue;
      }

      ring.radius +=
        ring.speed * deltaTime;
    }

    for (
      let i =
        floatingTexts.length - 1;
      i >= 0;
      i--
    ) {
      const text =
        floatingTexts[i];

      text.life -= deltaTime;

      if (text.life <= 0) {
        floatingTexts.splice(
          i,
          1
        );

        continue;
      }

      text.y -=
        38 * deltaTime;
    }

    flash = Math.max(
      0,
      flash - deltaTime * 2.2
    );
  }

  function drawEffects() {
    const colorGroups =
      new Map();

    for (
      let i = 0;
      i < particles.length;
      i++
    ) {
      const particle =
        particles[i];

      if (
        !colorGroups.has(
          particle.color
        )
      ) {
        colorGroups.set(
          particle.color,
          []
        );
      }

      colorGroups
        .get(particle.color)
        .push(particle);
    }

    ctx.save();

    ctx.globalCompositeOperation =
      "lighter";

    for (
      const [color, group]
      of colorGroups
    ) {
      ctx.beginPath();

      for (
        let i = 0;
        i < group.length;
        i++
      ) {
        const particle =
          group[i];

        const alpha =
          Math.max(
            0,
            Math.min(
              1,
              particle.life / 0.7
            )
          );

        const size =
          particle.size *
          Math.max(
            0.35,
            alpha
          );

        ctx.moveTo(
          particle.x + size,
          particle.y
        );

        ctx.arc(
          particle.x,
          particle.y,
          size,
          0,
          Math.PI * 2
        );
      }

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
    }

    for (
      let i = 0;
      i < rings.length;
      i++
    ) {
      const ring = rings[i];

      ctx.globalAlpha =
        Math.max(
          0,
          Math.min(
            1,
            ring.life / 0.75
          )
        );

      ctx.beginPath();

      ctx.arc(
        ring.x,
        ring.y,
        ring.radius,
        0,
        Math.PI * 2
      );

      ctx.lineWidth = 4;
      ctx.strokeStyle = ring.color;
      ctx.stroke();
    }

    ctx.globalCompositeOperation =
      "source-over";

    for (
      let i = 0;
      i < floatingTexts.length;
      i++
    ) {
      const text =
        floatingTexts[i];

      ctx.globalAlpha =
        Math.max(
          0,
          Math.min(
            1,
            text.life / 0.9
          )
        );

      ctx.fillStyle =
        text.color;

      ctx.strokeStyle =
        "rgba(0,0,0,.78)";

      ctx.lineWidth = 5;

      ctx.font = text.combo
        ? "900 27px system-ui"
        : "800 24px system-ui";

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.strokeText(
        text.text,
        text.x,
        text.y
      );

      ctx.fillText(
        text.text,
        text.x,
        text.y
      );
    }

    ctx.restore();
  }

  /* =========================================================
   * BALL DRAWING
   * ======================================================= */

  function drawBall(ball) {
    const position =
      ball.body.position;

    const color = ball.isBlack
      ? BLACK_BALL_COLOR
      : numberColor(ball.number);

    ctx.beginPath();

    ctx.arc(
      position.x,
      position.y,
      BALL_RADIUS,
      0,
      Math.PI * 2
    );

    ctx.fillStyle = color;
    ctx.fill();

    ctx.lineWidth =
      ball.isShot ? 4 : 2.5;

    ctx.strokeStyle =
      ball.isShot
        ? "#ffffff"
        : "rgba(255,255,255,.55)";

    ctx.stroke();

    ctx.beginPath();

    ctx.arc(
      position.x - 6,
      position.y - 7,
      5,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      "rgba(255,255,255,.18)";

    ctx.fill();

    // 검은 구슬에는 숫자를 표시하지 않는다.
    if (!ball.isBlack) {
      ctx.fillStyle =
        numberTextColor(
          ball.number
        );

      ctx.font =
        "900 18px system-ui";

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillText(
        ball.number,
        position.x,
        position.y + 0.5
      );
    }
  }

  function drawReadyBall() {
    ctx.beginPath();

    ctx.arc(
      SHOOT_X,
      LAUNCH_Y,
      BALL_RADIUS,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      numberColor(
        currentNumber
      );

    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    ctx.fillStyle =
      numberTextColor(
        currentNumber
      );

    ctx.font =
      "900 22px system-ui";

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText(
      currentNumber,
      SHOOT_X,
      LAUNCH_Y
    );
  }

  /* =========================================================
   * SCENE DRAWING
   * ======================================================= */

  function drawScene() {
    ctx.setTransform(
      1,
      0,
      0,
      1,
      0,
      0
    );

    ctx.fillStyle = "#151b23";

    ctx.fillRect(
      0,
      0,
      W,
      H
    );

    if (shake > 0.1) {
      ctx.translate(
        (
          Math.random() -
          0.5
        ) * shake,

        (
          Math.random() -
          0.5
        ) * shake
      );

      shake *= 0.84;
    }

    ctx.strokeStyle = "#344054";
    ctx.globalAlpha = 0.17;
    ctx.lineWidth = 1;

    for (
      let gridX = 40;
      gridX < W;
      gridX += 40
    ) {
      ctx.beginPath();

      ctx.moveTo(
        gridX,
        TOP
      );

      ctx.lineTo(
        gridX,
        FLOOR
      );

      ctx.stroke();
    }

    for (
      let gridY = 40;
      gridY < FLOOR;
      gridY += 40
    ) {
      ctx.beginPath();

      ctx.moveTo(
        0,
        gridY
      );

      ctx.lineTo(
        W,
        gridY
      );

      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    drawAimGuide();

    for (
      let i = 0;
      i < balls.length;
      i++
    ) {
      drawBall(balls[i]);
    }

    drawEffects();

    ctx.strokeStyle =
      "rgba(255,255,255,.28)";

    ctx.lineWidth = 2;

    ctx.beginPath();

    ctx.moveTo(
      0,
      FLOOR
    );

    ctx.lineTo(
      W,
      FLOOR
    );

    ctx.stroke();

    drawReadyBall();

    if (flash > 0) {
      ctx.fillStyle =
        `rgba(255,255,255,${flash})`;

      ctx.fillRect(
        0,
        0,
        W,
        H
      );
    }

    if (gameOver) {
      ctx.fillStyle =
        "rgba(0,0,0,.66)";

      ctx.fillRect(
        0,
        0,
        W,
        H
      );

      ctx.fillStyle =
        "#ffffff";

      ctx.font =
        "900 38px system-ui";

      ctx.textAlign =
        "center";

      ctx.fillText(
        "GAME OVER",
        W / 2,
        H / 2 - 20
      );

      ctx.font =
        "700 22px system-ui";

      ctx.fillText(
        `${score.toLocaleString()}점 · 최고 콤보 ${bestCombo}`,
        W / 2,
        H / 2 + 20
      );
    }

    ctx.setTransform(
      1,
      0,
      0,
      1,
      0,
      0
    );
  }

  /* =========================================================
   * GAME LOOP
   * ======================================================= */

  function gameLoop(now) {
    const deltaMilliseconds =
      Math.min(
        34,
        now - previousTime || 16
      );

    const deltaTime =
      deltaMilliseconds / 1000;

    previousTime = now;

    if (
      charging &&
      !moving &&
      !gameOver
    ) {
      chargePower +=
        chargeDirection *
        CHARGE_SPEED *
        deltaTime;

      if (
        chargePower >=
        MAX_POWER
      ) {
        chargePower = MAX_POWER;
        chargeDirection = -1;
      } else if (
        chargePower <=
        MIN_POWER
      ) {
        chargePower = MIN_POWER;
        chargeDirection = 1;
      }

      updateHud();
    }

    if (
      moving &&
      !gameOver
    ) {
      Engine.update(
        engine,
        deltaMilliseconds
      );

      // 기본 마찰 후 느린 공에만 추가 감속을 적용한다.
      applyLowSpeedBraking();

      const allStopped =
        areAllBallsStopped();

      quietFrames = allStopped
        ? quietFrames + 1
        : 0;

      if (
        quietFrames >=
          REQUIRED_QUIET_FRAMES ||
        now - shotStartedAt >=
          MAX_SHOT_DURATION_MS
      ) {
        finishTurn();
      }
    }

    updateEffects(deltaTime);
    drawScene();

    requestAnimationFrame(
      gameLoop
    );
  }

  /* =========================================================
   * EVENTS
   * ======================================================= */

  canvas.addEventListener(
    "pointerdown",
    beginCharge
  );

  canvas.addEventListener(
    "pointermove",
    moveCharge
  );

  canvas.addEventListener(
    "pointerup",
    releaseCharge
  );

  canvas.addEventListener(
    "pointercancel",
    cancelCharge
  );

  ui.resetButton.addEventListener(
    "click",
    resetGame
  );

  ui.refreshRankingButton.addEventListener(
    "click",
    renderWeeklyRanking
  );

  ui.submitRankingButton.addEventListener(
    "click",
    submitGameResult
  );

  ui.skipRankingButton.addEventListener(
    "click",
    closeNicknameModal
  );

  ui.nicknameInput.addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        submitGameResult();
      }
    }
  );

  /* =========================================================
   * START
   * ======================================================= */

  resetGame();
  renderWeeklyRanking();

  if (isFirebaseConfigured()) {
    initializeRanking().catch(error => {
      console.error("Firebase 익명 로그인 실패:", error);
    });
  }

  requestAnimationFrame(
    gameLoop
  );
})();
