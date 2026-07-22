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
    specialBallInfo: document.querySelector("#specialBallInfo"),
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
  const H = 690;
  const TOP = 20;
  const FLOOR = 590;

  const BALL_RADIUS = 18;

  // 화면에 공이 이 개수 이상이면 과부하 상태가 된다.
  const BALL_COUNT_LIMIT = 65;
  
  const SHOOT_X = W / 2;

  /*
   * 발사 구역을 시각적으로 구분할 때 사용하는 기준 너비다.
   * 실제 물리 벽이나 좁은 입구는 만들지 않는다.
   */
  const LAUNCH_GATE_WIDTH = 112;

  /*
   * 기존 호환용 설정이다. 현재 발사 공의 필드 진입에는 시간 제한을 두지 않는다.
   */
  const OUTSIDE_SHOT_TIMEOUT_MS = 2000;

  /*
   * 기존 호환용 설정이다. 외곽벽이 캔버스 전체를 감싸므로 현재는 사용하지 않는다.
   */
  const OUTSIDE_DELETE_MARGIN = 130;

  /*
   * 충돌 카테고리
   *
   * 발사 직후에는 발사한 공만 FLOOR_WALL과 충돌하지 않는다.
   * 기존 필드 공은 항상 바닥 벽에 막혀 발사 구역으로 빠지지 않는다.
   */
  const COLLISION_CATEGORY = {
    BALL: 0x0001,
    FIELD_WALL: 0x0002,
    FLOOR_WALL: 0x0004
  };

  // 발사 공은 실제 플레이 영역 아래쪽, 화면 밖에서 시작한다.
  const LAUNCH_Y =
    FLOOR + BALL_RADIUS + 26;

  /*
   * 발사 공간에 표시되는 다음 공 대기열 설정
   */
  const LAUNCH_QUEUE_RADIUS = 14;
  const LAUNCH_QUEUE_GAP = 10;
  const LAUNCH_QUEUE_START_X =
    SHOOT_X + BALL_RADIUS + 54;

  const MIN_POWER = 1;
  const MAX_POWER = 30;
  const CHARGE_SPEED = 40;

  // 180도까지 허용하면 발사 공의 완전한 뒤쪽도 조준할 수 있다.
  const MAX_AIM_ANGLE_DEGREES = 180;

  const BLAST_RADIUS = 123;
  const BLAST_FORCE = 16;

  // 첫 번째 폭발 점수
  const BASE_COMBO_SCORE = 8;

  // 콤보마다 적용되는 점수 배율
  const COMBO_SCORE_MULTIPLIER = 1.35;

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
   * 특수 발사 공 설정
   *
   * SPECIAL_BALL_CHANCE는 다음 공이 특수공일 전체 확률이다.
   * 0.12는 약 12% 확률을 의미한다.
   */
  const SPECIAL_BALL_CHANCE = 0.18;

  const SPECIAL_BALL_TYPES = [
    "rainbow",
    "ice",
    "cloud",
    "blackHole"
  ];

  // 얼음 폭발 후 미끄러운 상태가 유지되는 턴 수
  const ICE_DURATION_TURNS = 1;
  const ICE_AIR_FRICTION = 0.01;

  // 블랙홀 흡입 및 폭발 설정
  const BLACK_HOLE_SUCTION_RADIUS = 120;
  const BLACK_HOLE_BASE_BLAST_RADIUS = 125;
  const BLACK_HOLE_RADIUS_PER_BALL = 10;
  const BLACK_HOLE_FORCE_PER_BALL = 1.5;

  /*
   * 특수공 연출 시간
   */
  const BLACK_HOLE_EFFECT_DURATION = 0.82;
  const RAINBOW_EFFECT_DURATION = 0.62;

  /*
   * 저속 상태에서 공끼리 겹치거나 붙는 현상 방지 설정
   */
  const BALL_SEPARATION_DISTANCE = BALL_RADIUS * 2 - 0.8;
  const BALL_SEPARATION_PUSH = 0.22;
  const BALL_SEPARATION_SPEED_LIMIT = 0.7;

  /*
   * 발사 공이 숫자 공을 터뜨렸을 때 받는 반동
   */
  const SHOT_EXPLOSION_RECOIL = 9;

  // 구름공은 공을 관통하고 벽에서 한 번만 반사된다.
  const CLOUD_MAX_WALL_BOUNCES = 2;

  /*
   * 검은 구슬 설정
   *
   * BLACK_BALL_INTERVAL:
   *   몇 턴마다 검은 구슬을 한 개 추가할지 설정한다.
   *
   */
  const BLACK_BALL_INTERVAL = 10;
  const BLACK_BALL_COLOR = "#111111";

  /*
   * 기본 마찰(frictionAir)은 그대로 유지한다.
   * 공의 속도가 LOW_SPEED_THRESHOLD보다 느려지면
   * LOW_SPEED_DAMPING을 매 프레임 적용하여 빠르게 정지시킨다.
   */
  const NORMAL_AIR_FRICTION = 0.019;
  const LOW_SPEED_THRESHOLD = 0.8;
  const LOW_SPEED_DAMPING = 0.9;
  const SNAP_STOP_SPEED = 0.035;

  // 턴 종료를 판단하기 위한 설정
  const REQUIRED_QUIET_FRAMES = 10;
  const MAX_SHOT_DURATION_MS = 12000;

  // 폭발 이펙트 성능 제한
  const MAX_PARTICLES = 160;
  const PARTICLES_PER_EXPLOSION = 14;
  const MAX_RINGS = 24;
  /*
   * 무지개공이 여러 공을 동시에 제거해도
   * 각 공의 콤보 텍스트가 모두 보이도록 여유를 늘린다.
   */
  const MAX_FLOATING_TEXTS = 48;

  /*
   * 브라우저 로컬 저장 설정
   */
  const GAME_SAVE_KEY = "burst8GameSave";
  const GAME_SAVE_VERSION = 1;

  const COLORS = {
    red: "#e53935",
    yellow: "#f6c700",
    green: "#2eaf59",
    blue: "#2878d0",
    rainbow: "#d86cff",
    ice: "#73d8ff",
    cloud: "#d9e2ec",
    blackHole: "#6d4aff"
  };

  /* =========================================================
   * GAME STATE
   * ======================================================= */

  let engine;

  /*
   * 화면 아래 발사 입구를 막는 임시 문이다.
   * 대기 중에는 닫혀 있고 발사 순간에만 열린다.
   */
  let launchGate = null;

  /*
   * 현재 화면 밖에서 발사된 공을 추적한다.
   */
  let activeShotBall = null;

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

  /*
   * 특수공 전용 애니메이션
   *
   * rainbowEffects:
   *   같은 숫자 공이 반짝인 뒤 동시에 사라지는 연출
   *
   * blackHoleEffects:
   *   주변 공이 소용돌이치며 중심으로 흡수된 뒤 폭발하는 연출
   */
  let rainbowEffects = [];
  let blackHoleEffects = [];

  let aimAngle = 0;
  let charging = false;
  let chargePower = MIN_POWER;
  let chargeDirection = 1;
  let activePointerId = null;

  // 0보다 크면 필드가 얼어 있는 상태다.
  let iceTurnsRemaining = 0;

  // 한 게임 결과에 대해 닉네임 창을 한 번만 연다.
  let rankingModalOpened = false;
  let rankingSubmitting = false;
  /*
   * 랭킹 새로고침 쿨타임
   *
   * 종료 시각을 localStorage에 저장하므로
   * 페이지를 새로고침해도 남은 쿨타임이 유지된다.
   */
  const RANKING_REFRESH_COOLDOWN_MS = 30 * 1000;
  const RANKING_REFRESH_STORAGE_KEY =
    "burst8RankingRefreshCooldownUntil";

  let rankingRefreshTimer = null;
  let rankingRefreshCooldownUntil =
    Number(
      localStorage.getItem(
        RANKING_REFRESH_STORAGE_KEY
      )
    ) || 0;

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

  /**
   * 발사 큐에 들어갈 값을 생성한다.
   * 일반 숫자 또는 특수공 타입 문자열을 반환한다.
   */
  function randomShotValue() {
    if (Math.random() >= SPECIAL_BALL_CHANCE) {
      return randomNumber();
    }

    const index = Math.floor(
      Math.random() * SPECIAL_BALL_TYPES.length
    );

    return SPECIAL_BALL_TYPES[index];
  }

  function isSpecialShot(value) {
    return typeof value === "string";
  }

  function specialBallSymbol(type) {
    const symbols = {
      rainbow: "🌈",
      ice: "❄",
      cloud: "☁",
      blackHole: "🌀"
    };

    return symbols[type] || "?";
  }

  function specialBallName(type) {
    const names = {
      rainbow: "무지개공",
      ice: "얼음 폭발공",
      cloud: "구름공",
      blackHole: "블랙홀공"
    };

    return names[type] || "특수공";
  }

  function specialBallDescription(type) {
    const descriptions = {
      rainbow:
        "처음 닿은 일반 숫자 공과 같은 색의 공을 맵에서 모두 제거합니다. 예를 들어 1에 닿으면 같은 빨간색인 1과 7이 모두 사라집니다. 폭발과 물리 충격은 발생하지 않습니다.",

      ice:
        "공에 닿는 즉시 폭발하고, 이번 턴 동안 맵 전체가 얼어 공이 더 오래 미끄러집니다.",

      cloud:
        "공을 관통하면서 닿은 일반 숫자 공을 모두 4로 바꿉니다. 벽에 한 번 튕긴 뒤 마지막에 사라질 때 폭발합니다.",

      blackHole:
        "충돌 지점 반경의 일반 숫자 공을 먹습니다. 먹은 공은 모두 콤보가 되고, 먹은 개수에 비례해 폭발 범위와 힘이 커집니다."
    };

    return descriptions[type] || "";
  }

  /**
   * 캔버스 아래 발사 구역에 표시할 짧은 특수공 설명이다.
   * 왼쪽의 제한된 공간에 맞게 두 줄로 나누어 반환한다.
   */
  function specialBallLaunchDescription(type) {
    const descriptions = {
      rainbow: [
        "같은 색의 공을",
        "필드에서 모두 제거"
      ],

      ice: [
        "충돌 즉시 폭발하고",
        "이번 턴 더 오래 미끄러짐"
      ],

      cloud: [
        "닿은 숫자 공을 모두 4로",
        "마지막에 사라지며 폭발"
      ],

      blackHole: [
        "주변 숫자 공을 흡수",
        "먹은 수만큼 강한 폭발"
      ]
    };

    return descriptions[type] || [];
  }

  function setSpecialBallInfo(value) {
    if (!ui.specialBallInfo) {
      return;
    }

    if (!isSpecialShot(value)) {
      ui.specialBallInfo.hidden = true;
      ui.specialBallInfo.replaceChildren();
      return;
    }

    const icon = document.createElement("span");
    icon.className = "special-info-icon";
    icon.textContent = specialBallSymbol(value);

    const textBox = document.createElement("span");
    textBox.className = "special-info-text";

    const title = document.createElement("strong");
    title.textContent = specialBallName(value);

    const description = document.createElement("span");
    description.textContent = specialBallDescription(value);

    textBox.append(title, description);
    ui.specialBallInfo.replaceChildren(icon, textBox);
    ui.specialBallInfo.hidden = false;
  }

  function applyShotBadgeInfo(element, value) {
    element.textContent = shotDisplay(value);
    element.style.background = shotColor(value);
    element.style.color = shotTextColor(value);

    if (isSpecialShot(value)) {
      element.classList.add("special-ball-badge");
      element.dataset.specialType = value;
      element.tabIndex = 0;
      element.title =
        `${specialBallName(value)} - ${specialBallDescription(value)}`;
    } else {
      element.classList.remove("special-ball-badge");
      delete element.dataset.specialType;
      element.removeAttribute("tabindex");
      element.removeAttribute("title");
    }
  }

  function shotDisplay(value) {
    return isSpecialShot(value)
      ? specialBallSymbol(value)
      : value;
  }

  function shotColor(value) {
    if (!isSpecialShot(value)) {
      return numberColor(value);
    }

    return COLORS[value] || COLORS.blue;
  }

  function shotTextColor(value) {
    if (value === "cloud") {
      return "#202936";
    }

    if (isSpecialShot(value)) {
      return "#ffffff";
    }

    return numberTextColor(value);
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

    applyShotBadgeInfo(
      ui.currentBall,
      currentNumber
    );

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < queue.length; i++) {
      const number = queue[i];
      const badge = document.createElement("span");

      badge.className = "badge";
      applyShotBadgeInfo(
        badge,
        number
      );

      fragment.appendChild(badge);
    }

    ui.nextBalls.replaceChildren(fragment);
  }

  /* =========================================================
   * PHYSICS OBJECTS
   * ======================================================= */

  /**
   * 플레이 필드의 전체 바닥 벽을 생성한다.
   *
   * 대기 중에는 바닥 벽이 존재하고,
   * 발사 순간에는 통째로 제거된다.
   */
  function createLaunchGate() {
    if (launchGate) {
      return;
    }

    launchGate = Bodies.rectangle(
      W / 2,
      FLOOR + 20,
      W,
      40,
      {
        isStatic: true,
        label: "wall-bottom",
        collisionFilter: {
          category:
            COLLISION_CATEGORY.FLOOR_WALL,
          mask:
            COLLISION_CATEGORY.BALL
        }
      }
    );

    World.add(
      engine.world,
      launchGate
    );
  }

  /**
   * 발사 순간 플레이 필드의 바닥 벽을 통째로 제거한다.
   *
   * 따라서 발사 구역에는 공을 막는 좌우 벽이나
   * 좁은 입구 벽이 존재하지 않는다.
   */
  function openLaunchGate() {
    /*
     * 바닥 벽은 제거하지 않는다.
     * 발사한 공의 충돌 필터만 잠시 변경하여
     * 그 공만 바닥 벽을 통과하게 한다.
     */
  }

  /**
   * 발사 공이 플레이 필드 안으로 들어온 뒤
   * 전체 바닥 벽을 다시 생성한다.
   */
  function closeLaunchGate() {
    createLaunchGate();
  }

  function createWalls() {
    World.add(engine.world, [
      Bodies.rectangle(
        W / 2,
        0,
        W,
        40,
        {
          isStatic: true,
          label: "wall-top",
          collisionFilter: {
            category:
              COLLISION_CATEGORY.FIELD_WALL,
            mask:
              COLLISION_CATEGORY.BALL
          }
        }
      ),

      /*
       * 좌우 외곽벽은 게임 필드와 발사 구역 전체를 감싼다.
       * 따라서 발사 공도 좌우 바깥으로 나갈 수 없다.
       */
      Bodies.rectangle(
        -20,
        H / 2,
        40,
        H,
        {
          isStatic: true,
          label: "wall-left",
          collisionFilter: {
            category:
              COLLISION_CATEGORY.FIELD_WALL,
            mask:
              COLLISION_CATEGORY.BALL
          }
        }
      ),

      Bodies.rectangle(
        W + 20,
        H / 2,
        40,
        H,
        {
          isStatic: true,
          label: "wall-right",
          collisionFilter: {
            category:
              COLLISION_CATEGORY.FIELD_WALL,
            mask:
              COLLISION_CATEGORY.BALL
          }
        }
      ),

      /*
       * 발사 구역 아래쪽을 막는 캔버스 외곽벽이다.
       * 발사 공도 이 벽에는 항상 충돌하여 위쪽으로 튕길 수 있다.
       */
      Bodies.rectangle(
        W / 2,
        H + 20,
        W,
        40,
        {
          isStatic: true,
          label: "wall-outer-bottom",
          collisionFilter: {
            category:
              COLLISION_CATEGORY.FIELD_WALL,
            mask:
              COLLISION_CATEGORY.BALL
          }
        }
      )
    ]);

    closeLaunchGate();
  }

  function addBall(
    x,
    y,
    number,
    velocityX = 0,
    velocityY = 0,
    isShot = false,
    isBlack = false,
    specialType = null
  ) {
    const body = Bodies.circle(x, y, BALL_RADIUS, {
      restitution: 0.96,
      friction: 0,
      frictionAir:
        iceTurnsRemaining > 0
          ? ICE_AIR_FRICTION
          : NORMAL_AIR_FRICTION,
      isSensor: specialType === "cloud",
      label: specialType ? `special-${specialType}` : "ball",
      collisionFilter: {
        category:
          COLLISION_CATEGORY.BALL,
        mask:
          COLLISION_CATEGORY.BALL |
          COLLISION_CATEGORY.FIELD_WALL |
          COLLISION_CATEGORY.FLOOR_WALL
      }
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
      isBlack,
      specialType,
      wallBounces: 0,
      touchedBodyIds: new Set(),

      /*
       * 화면 밖에서 발사된 공이 플레이 영역에 들어왔는지 기록한다.
       */
      hasEnteredField: !isShot,
      launchedAt: isShot ? performance.now() : 0,
      floorPassUntil: 0
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
    [7, 7, 7, 7, 7, 7].forEach((count, row) => {
      const gap = 70;
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
    /*
     * 매 라운드 공을 추가한다.
     */
    return 8 + Math.floor(currentTurn / 6);
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

      const spawnTop = TOP + BALL_RADIUS + 15;
      const spawnBottom = Math.max(
        spawnTop,
        LAUNCH_Y - BALL_RADIUS - 120
      );

      const y =
        spawnTop +
        Math.random() *
          (spawnBottom - spawnTop);

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
      y <= LAUNCH_Y - BALL_RADIUS - 120;
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
   * SAVE / LOAD
   * ======================================================= */

  /**
   * 현재 게임 상태를 브라우저에 저장한다.
   *
   * 움직임과 특수공 연출이 끝난 안정된 상태를 저장하는 것이 기본이다.
   * 발사 도중 새로고침하면 직전 턴 종료 상태부터 이어진다.
   */
  function saveGameState() {
    if (
      !engine ||
      moving ||
      charging ||
      gameOver ||
      hasActiveSpecialEffect()
    ) {
      return false;
    }

    const savedBalls = balls
      .filter(ball =>
        !ball.specialType &&
        !ball.effectLocked &&
        ball.body.position.y < FLOOR
      )
      .map(ball => ({
        x: ball.body.position.x,
        y: ball.body.position.y,
        number: ball.number,
        isBlack: ball.isBlack
      }));

    const saveData = {
      version: GAME_SAVE_VERSION,
      savedAt: Date.now(),

      score,
      combo,
      bestCombo,
      turn,

      queue: [...queue],
      currentNumber,

      overload,
      iceTurnsRemaining,

      balls: savedBalls
    };

    try {
      localStorage.setItem(
        GAME_SAVE_KEY,
        JSON.stringify(saveData)
      );

      return true;
    } catch (error) {
      console.warn(
        "게임 저장 실패:",
        error
      );

      return false;
    }
  }

  /**
   * 저장된 게임 데이터를 읽고 기본 형식을 검사한다.
   */
  function readSavedGameState() {
    try {
      const raw =
        localStorage.getItem(
          GAME_SAVE_KEY
        );

      if (!raw) {
        return null;
      }

      const saved =
        JSON.parse(raw);

      if (
        saved?.version !==
          GAME_SAVE_VERSION ||
        !Array.isArray(saved.balls) ||
        !Array.isArray(saved.queue) ||
        saved.queue.length !== 3
      ) {
        return null;
      }

      return saved;
    } catch (error) {
      console.warn(
        "저장된 게임 불러오기 실패:",
        error
      );

      return null;
    }
  }

  /**
   * 사용자가 다시 시작을 눌렀을 때 저장 데이터도 함께 삭제한다.
   */
  function clearSavedGameState() {
    try {
      localStorage.removeItem(
        GAME_SAVE_KEY
      );
    } catch (error) {
      console.warn(
        "저장 데이터 삭제 실패:",
        error
      );
    }
  }

  /**
   * 저장된 공과 점수, 대기열을 현재 게임에 복원한다.
   */
  function restoreSavedGameState(saved) {
    score =
      Number.isFinite(saved.score)
        ? saved.score
        : 0;

    combo =
      Number.isFinite(saved.combo)
        ? saved.combo
        : 0;

    bestCombo =
      Number.isFinite(saved.bestCombo)
        ? saved.bestCombo
        : 0;

    turn =
      Number.isFinite(saved.turn)
        ? saved.turn
        : 0;

    queue = [...saved.queue];
    currentNumber =
      saved.currentNumber ?? 1;

    overload =
      Boolean(saved.overload);

    iceTurnsRemaining =
      Number.isFinite(
        saved.iceTurnsRemaining
      )
        ? Math.max(
            0,
            saved.iceTurnsRemaining
          )
        : 0;

    for (
      let i = 0;
      i < saved.balls.length;
      i++
    ) {
      const savedBall =
        saved.balls[i];

      if (
        !Number.isFinite(savedBall.x) ||
        !Number.isFinite(savedBall.y)
      ) {
        continue;
      }

      addBall(
        savedBall.x,
        savedBall.y,
        savedBall.isBlack
          ? 0
          : savedBall.number,
        0,
        0,
        false,
        Boolean(savedBall.isBlack)
      );
    }

    if (iceTurnsRemaining > 0) {
      activateIceFloor();
    }

    setStatus(
      `저장된 게임을 불러왔습니다. ${turn}턴부터 이어서 플레이합니다.`,
      "CONTINUE"
    );
  }

  /* =========================================================
   * RESET
   * ======================================================= */

  function resetGame(
    loadSavedGame = true
  ) {
    engine = Engine.create({
      gravity: {
        x: 0,
        y: 0
      }
    });

    balls = [];
    ballByBodyId = new Map();

    launchGate = null;
    activeShotBall = null;

    const savedGame =
      loadSavedGame
        ? readSavedGameState()
        : null;

    queue = [
      randomShotValue(),
      randomShotValue(),
      randomShotValue()
    ];

    currentNumber = randomShotValue();

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
    rainbowEffects = [];
    blackHoleEffects = [];

    aimAngle = 0;

    charging = false;
    chargePower = MIN_POWER;
    chargeDirection = 1;
    activePointerId = null;
    iceTurnsRemaining = 0;
    rankingModalOpened = false;
    rankingSubmitting = false;

    closeNicknameModal();
    canvas.classList.remove("charging");

    createWalls();
    bindCollisionEvents();

    if (savedGame) {
      restoreSavedGameState(
        savedGame
      );
    } else {
      seedField();

      setStatus(
        "원하는 방향을 누르고 있다가 힘을 맞춰 놓으세요."
      );

      /*
       * 처음 시작한 상태도 저장해 둔다.
       */
      saveGameState();
    }

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
    ignored = [],
    blastRadius = BLAST_RADIUS,
    blastForce = BLAST_FORCE
  ) {
    const ignoredIds = new Set();

    for (let i = 0; i < ignored.length; i++) {
      ignoredIds.add(
        ignored[i].body.id
      );
    }

    const radiusSquared =
      blastRadius * blastRadius;

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
        blastForce *
        (1 - distance / blastRadius);

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
   * SPECIAL BALLS
   * ======================================================= */

  function removeSpecialShot(ball) {
    if (!ball || !ballByBodyId.has(ball.body.id)) {
      return;
    }

    removeBall(ball);
  }

  /**
   * 특수공 애니메이션이 진행 중인지 확인한다.
   * 이 값이 true인 동안에는 턴 종료 판정을 보류한다.
   */
  function hasActiveSpecialEffect() {
    return (
      rainbowEffects.length > 0 ||
      blackHoleEffects.length > 0
    );
  }

  /**
   * 이펙트 대상 공을 물리 충돌에서 잠시 제외한다.
   */
  function lockBallForEffect(ball) {
    if (!ball || ball.effectLocked) {
      return;
    }

    ball.effectLocked = true;
    ball.body.collisionFilter.mask = 0;

    Body.setVelocity(ball.body, {
      x: 0,
      y: 0
    });

    Body.setAngularVelocity(
      ball.body,
      0
    );
  }

  /**
   * 무지개 색상의 작은 반짝임 파티클을 만든다.
   */
  function createRainbowSparkles(x, y, amount = 8) {
    const rainbowColors = [
      "#ff4d6d",
      "#ffb703",
      "#f6ff4a",
      "#35d07f",
      "#45b7ff",
      "#7c6cff",
      "#d86cff"
    ];

    const available =
      MAX_PARTICLES - particles.length;

    const count =
      Math.min(available, amount);

    for (let i = 0; i < count; i++) {
      const angle =
        Math.random() * Math.PI * 2;

      const speed =
        35 + Math.random() * 85;

      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1.8 + Math.random() * 3.2,
        life: 0.35 + Math.random() * 0.25,
        color:
          rainbowColors[
            Math.floor(
              Math.random() *
              rainbowColors.length
            )
          ]
      });
    }
  }

  /**
   * 블랙홀 소용돌이 연출을 시작한다.
   */
  function startBlackHoleEffect(
    x,
    y,
    targets
  ) {
    const effectTargets = [];

    for (let i = 0; i < targets.length; i++) {
      const ball = targets[i];

      if (!ballByBodyId.has(ball.body.id)) {
        continue;
      }

      const dx =
        ball.body.position.x - x;

      const dy =
        ball.body.position.y - y;

      lockBallForEffect(ball);

      effectTargets.push({
        ball,
        startX: ball.body.position.x,
        startY: ball.body.position.y,
        startDistance:
          Math.max(10, Math.hypot(dx, dy)),
        startAngle:
          Math.atan2(dy, dx),
        rotation:
          2.4 +
          Math.random() * 1.5
      });
    }

    blackHoleEffects.push({
      x,
      y,
      elapsed: 0,
      duration:
        BLACK_HOLE_EFFECT_DURATION,
      targets: effectTargets
    });
  }

  function activateIceFloor() {
    iceTurnsRemaining = ICE_DURATION_TURNS;

    /*
     * 얼음 바닥은 일반 공, 검은 공 모두에게 적용된다.
     */
    for (let i = 0; i < balls.length; i++) {
      balls[i].body.frictionAir =
        ICE_AIR_FRICTION;
    }
  }

  function deactivateIceFloor() {
    for (let i = 0; i < balls.length; i++) {
      balls[i].body.frictionAir =
        NORMAL_AIR_FRICTION;
    }
  }

  function triggerRainbowBall(specialBall, targetBall) {
    if (
      !specialBall ||
      !ballByBodyId.has(
        specialBall.body.id
      )
    ) {
      return;
    }

    removeSpecialShot(specialBall);

    if (
      !targetBall ||
      targetBall.isBlack ||
      targetBall.specialType ||
      targetBall.number < 1 ||
      targetBall.number > 7
    ) {
      return;
    }

    const targetNumber =
      targetBall.number;

    const targetColor =
      numberColor(targetNumber);

    /*
     * 무지개공은 같은 숫자가 아니라 같은 색상 그룹을 제거한다.
     * 빨강: 1, 7 / 노랑: 2, 6 / 초록: 3, 5 / 파랑: 4
     */
    const targets =
      balls.filter(ball =>
        !ball.isBlack &&
        !ball.specialType &&
        !ball.effectLocked &&
        ball.number >= 1 &&
        ball.number <= 7 &&
        numberColor(ball.number) === targetColor
      );

    const effectTargets = [];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];

      if (
        !ballByBodyId.has(
          target.body.id
        )
      ) {
        continue;
      }

      lockBallForEffect(target);

      effectTargets.push({
        ball: target,
        x: target.body.position.x,
        y: target.body.position.y,
        phase:
          Math.random() * Math.PI * 2
      });

      createRainbowSparkles(
        target.body.position.x,
        target.body.position.y,
        5
      );
    }

    rainbowEffects.push({
      elapsed: 0,
      duration:
        RAINBOW_EFFECT_DURATION,
      targetNumber,
      targets: effectTargets
    });

    setStatus(
      `${targetNumber}번과 같은 색의 공이 무지개빛으로 사라집니다.`,
      "RAINBOW"
    );
  }

  function triggerIceBall(specialBall, targetBall) {
    if (!targetBall) {
      return;
    }

    const x = targetBall.body.position.x;
    const y = targetBall.body.position.y;

    removeSpecialShot(specialBall);
    activateIceFloor();

    const gained = addScore();

    createExplosion(
      x,
      y,
      COLORS.ice,
      gained,
      1.35
    );

    applyBlast(
      x,
      y,
      [],
      BLAST_RADIUS * 1.1,
      BLAST_FORCE * 0.9
    );

    setStatus(
      `얼음 바닥 활성화 · ${ICE_DURATION_TURNS}턴`,
      "ICE"
    );
  }

  function convertBallToFour(targetBall) {
    if (
      !targetBall ||
      targetBall.isBlack ||
      targetBall.specialType
    ) {
      return;
    }

    targetBall.number = 4;
  }

  /**
   * 구름공이 수명을 다했을 때 마지막 위치에서 폭발한다.
   * 점수나 콤보는 추가하지 않고 주변 공에 물리 충격만 준다.
   */
  function detonateCloudBall(cloudBall) {
    if (
      !cloudBall ||
      !ballByBodyId.has(cloudBall.body.id)
    ) {
      return;
    }

    const x = Math.min(
      W - BALL_RADIUS - 2,
      Math.max(BALL_RADIUS + 2, cloudBall.body.position.x)
    );

    const y = Math.min(
      FLOOR - BALL_RADIUS - 2,
      Math.max(TOP + BALL_RADIUS + 2, cloudBall.body.position.y)
    );

    removeSpecialShot(cloudBall);

    flash = Math.max(flash, 0.3);
    shake = Math.max(shake, 8);

    if (rings.length < MAX_RINGS) {
      rings.push({
        x,
        y,
        radius: 12,
        life: 0.72,
        color: COLORS.cloud,
        speed: 175
      });
    }

    const available =
      MAX_PARTICLES - particles.length;

    const particleCount =
      Math.min(available, 22);

    for (let i = 0; i < particleCount; i++) {
      const angle =
        Math.random() * Math.PI * 2;

      const speed =
        75 + Math.random() * 135;

      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.2 + Math.random() * 3.2,
        life: 0.45 + Math.random() * 0.28,
        color:
          Math.random() < 0.3
            ? "#ffffff"
            : COLORS.cloud
      });
    }

    applyBlast(
      x,
      y,
      [],
      BLAST_RADIUS * 1.05,
      BLAST_FORCE * 0.9
    );

    setStatus(
      "구름공이 사라지며 폭발했습니다.",
      "CLOUD BURST"
    );
  }

  function handleCloudCollision(specialBall, otherBall, otherBody) {
    if (otherBall) {
      if (specialBall.touchedBodyIds.has(otherBall.body.id)) {
        return;
      }

      specialBall.touchedBodyIds.add(otherBall.body.id);
      convertBallToFour(otherBall);
      return;
    }

    if (!otherBody?.label?.startsWith("wall-")) {
      return;
    }

    if (specialBall.wallBounces >= CLOUD_MAX_WALL_BOUNCES) {
      detonateCloudBall(specialBall);
      return;
    }

    specialBall.wallBounces++;

    const velocity = specialBall.body.velocity;
    const label = otherBody.label;

    if (label === "wall-left" || label === "wall-right") {
      Body.setVelocity(specialBall.body, {
        x: -velocity.x,
        y: velocity.y
      });
    } else {
      Body.setVelocity(specialBall.body, {
        x: velocity.x,
        y: -velocity.y
      });
    }

    const position = specialBall.body.position;

    Body.setPosition(specialBall.body, {
      x: Math.min(
        W - BALL_RADIUS - 2,
        Math.max(BALL_RADIUS + 2, position.x)
      ),
      y: Math.min(
        FLOOR - BALL_RADIUS - 2,
        Math.max(TOP + BALL_RADIUS + 2, position.y)
      )
    });
  }

  function triggerBlackHoleBall(
    specialBall,
    targetBall
  ) {
    if (!targetBall) {
      return;
    }

    const x =
      targetBall.body.position.x;

    const y =
      targetBall.body.position.y;

    const radiusSquared =
      BLACK_HOLE_SUCTION_RADIUS *
      BLACK_HOLE_SUCTION_RADIUS;

    const targets =
      balls.filter(ball => {
        if (
          ball === specialBall ||
          ball.isBlack ||
          ball.specialType ||
          ball.effectLocked
        ) {
          return false;
        }

        const dx =
          ball.body.position.x - x;

        const dy =
          ball.body.position.y - y;

        return (
          dx * dx + dy * dy <=
          radiusSquared
        );
      });

    removeSpecialShot(specialBall);

    startBlackHoleEffect(
      x,
      y,
      targets
    );

    setStatus(
      `블랙홀이 공 ${targets.length}개를 흡수합니다.`,
      "BLACK HOLE"
    );
  }

  function handleSpecialCollision(
    specialBall,
    otherBall,
    otherBody
  ) {
    switch (specialBall.specialType) {
      case "rainbow":
        triggerRainbowBall(specialBall, otherBall);
        break;

      case "ice":
        triggerIceBall(specialBall, otherBall);
        break;

      case "cloud":
        handleCloudCollision(
          specialBall,
          otherBall,
          otherBody
        );
        break;

      case "blackHole":
        if (otherBall?.isBlack) {
          removeSpecialShot(specialBall);
          break;
        }

        triggerBlackHoleBall(specialBall, otherBall);
        break;
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

          const specialBall =
            first?.specialType && first.isShot
              ? first
              : second?.specialType && second.isShot
                ? second
                : null;

          if (specialBall) {
            const otherBall =
              specialBall === first
                ? second
                : first;

            const otherBody =
              specialBall.body === pair.bodyA
                ? pair.bodyB
                : pair.bodyA;

            handleSpecialCollision(
              specialBall,
              otherBall,
              otherBody
            );

            continue;
          }

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

    /*
     * 폭발 중심에서 발사 공 방향으로 반동 방향을 구한다.
     */
    let recoilX =
      shotBall.body.position.x - x;

    let recoilY =
      shotBall.body.position.y - y;

    let recoilLength =
      Math.hypot(recoilX, recoilY);

    if (recoilLength < 0.001) {
      const speed =
        Math.hypot(
          shotBall.body.velocity.x,
          shotBall.body.velocity.y
        ) || 1;

      recoilX =
        -shotBall.body.velocity.x /
        speed;

      recoilY =
        -shotBall.body.velocity.y /
        speed;

      recoilLength = 1;
    }

    recoilX /= recoilLength;
    recoilY /= recoilLength;

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
        speed * 1.12 + 1.1
      );

    /*
     * 기존 진행 속도에 폭발 반동을 더해
     * 발사 공도 확실히 튕겨 나가게 한다.
     */
    Body.setVelocity(
      shotBall.body,
      {
        x:
          (velocityX / speed) *
            restoredSpeed +
          recoilX *
            SHOT_EXPLOSION_RECOIL,

        y:
          (velocityY / speed) *
            restoredSpeed +
          recoilY *
            SHOT_EXPLOSION_RECOIL
      }
    );

    createExplosion(
      x,
      y,
      color,
      gained,
      1
    );

    /*
     * 발사 공을 제외한 주변 공에도 폭발 충격을 적용한다.
     * 발사 공의 반동은 위에서 별도로 계산했다.
     */
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
    queue.push(randomShotValue());
  }

  /**
   * 화면 밖 발사 공이 맵 안에 들어왔는지 확인한다.
   *
   * 반환값:
   * - true: 진입 실패로 턴을 즉시 종료함
   * - false: 계속 진행
   */
  function updateOutsideShot(now) {
    if (
      !activeShotBall ||
      !ballByBodyId.has(activeShotBall.body.id)
    ) {
      activeShotBall = null;
      closeLaunchGate();
      return false;
    }

    const position =
      activeShotBall.body.position;


    /*
     * 공 전체가 플레이 영역에 들어오면 즉시
     * 바닥 벽 충돌을 복구한다.
     */
    if (
      !activeShotBall.hasEnteredField &&
      position.y <=
        FLOOR - BALL_RADIUS - 4
    ) {
      activeShotBall.hasEnteredField = true;

      activeShotBall.body.collisionFilter.mask =
        COLLISION_CATEGORY.BALL |
        COLLISION_CATEGORY.FIELD_WALL |
        COLLISION_CATEGORY.FLOOR_WALL;

      closeLaunchGate();
      return false;
    }

    if (activeShotBall.hasEnteredField) {
      return false;
    }

    /*
     * 진입 시간 제한은 두지 않는다.
     * 발사 공은 필드에 들어오기 전까지 구분벽만 계속 통과하며,
     * 캔버스 외곽벽에는 항상 충돌한다.
     */
    return false;
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

    const specialType = isSpecialShot(firedNumber)
      ? firedNumber
      : null;

    /*
     * 발사 직전에 중앙 입구를 열고 화면 밖에서 공을 쏜다.
     */
    openLaunchGate();

    activeShotBall = addBall(
      SHOOT_X,
      LAUNCH_Y,
      specialType ? 0 : firedNumber,
      Math.sin(aimAngle) * power,
      -Math.cos(aimAngle) * power,
      true,
      false,
      specialType
    );

    /*
     * 발사한 공만 필드에 진입하기 전까지 구분벽을 통과한다.
     * 좌우·위·아래 캔버스 외곽벽과 다른 공에는 항상 충돌한다.
     */
    activeShotBall.body.collisionFilter.mask =
      COLLISION_CATEGORY.BALL |
      COLLISION_CATEGORY.FIELD_WALL;


    // 발사 즉시 준비 공을 다음 숫자로 변경한다.
    advanceQueueImmediately();

    moving = true;
    shotStartedAt =
      performance.now();

    quietFrames = 0;

    setStatus(
      overload
        ? "과부하 해소 샷! 65 아래로 낮추세요."
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
    const activeLowSpeedThreshold =
      iceTurnsRemaining > 0
        ? 0.3
        : LOW_SPEED_THRESHOLD;

    const activeDamping =
      iceTurnsRemaining > 0
        ? 0.98
        : LOW_SPEED_DAMPING;

    const activeSnapStopSpeed =
      iceTurnsRemaining > 0
        ? 0.02
        : SNAP_STOP_SPEED;

    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      const body = ball.body;

      const velocityX =
        body.velocity.x;

      const velocityY =
        body.velocity.y;

      const speedSquared =
        velocityX * velocityX +
        velocityY * velocityY;

      const position =
        body.position;

      /*
      * 벽과 맞닿아 있을 때는 강제 정지시키지 않는다.
      * Matter.js가 충돌 반동으로 공을 벽에서 분리할 시간을 준다.
      */
      const touchingWall =
        position.x <= BALL_RADIUS + 2 ||
        position.x >= W - BALL_RADIUS - 2 ||
        position.y <= TOP + BALL_RADIUS + 2 ||
        (
          launchGate &&
          position.y >= FLOOR - BALL_RADIUS - 2
        );

      if (
        !touchingWall &&
        speedSquared <=
          activeSnapStopSpeed *
          activeSnapStopSpeed
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
          activeLowSpeedThreshold *
          activeLowSpeedThreshold
      ) {
        /*
        * 벽 근처에서는 감속을 훨씬 약하게 적용한다.
        */
        const damping =
          touchingWall
            ? Math.max(
                activeDamping,
                0.96
              )
            : activeDamping;

        Body.setVelocity(body, {
          x:
            velocityX *
            damping,

          y:
            velocityY *
            damping
        });

        Body.setAngularVelocity(
          body,
          body.angularVelocity *
            damping
        );
      }
    }
  }

  /**
   * 저속 공끼리 너무 가까이 겹쳐 붙어 있는 경우
   * 서로 반대 방향으로 아주 약하게 밀어낸다.
   *
   * 빠르게 움직이는 공에는 적용하지 않으므로
   * 정상적인 충돌 물리는 그대로 유지된다.
   */
  function separateStuckBalls() {
    const minimumDistanceSquared =
      BALL_SEPARATION_DISTANCE *
      BALL_SEPARATION_DISTANCE;

    const speedLimitSquared =
      BALL_SEPARATION_SPEED_LIMIT *
      BALL_SEPARATION_SPEED_LIMIT;

    for (let i = 0; i < balls.length; i++) {
      const first = balls[i];

      if (
        first.effectLocked ||
        first.specialType === "cloud"
      ) {
        continue;
      }

      for (
        let j = i + 1;
        j < balls.length;
        j++
      ) {
        const second = balls[j];

        if (
          second.effectLocked ||
          second.specialType === "cloud"
        ) {
          continue;
        }

        const firstSpeedSquared =
          first.body.velocity.x *
            first.body.velocity.x +
          first.body.velocity.y *
            first.body.velocity.y;

        const secondSpeedSquared =
          second.body.velocity.x *
            second.body.velocity.x +
          second.body.velocity.y *
            second.body.velocity.y;

        if (
          firstSpeedSquared >
            speedLimitSquared ||
          secondSpeedSquared >
            speedLimitSquared
        ) {
          continue;
        }

        let dx =
          second.body.position.x -
          first.body.position.x;

        let dy =
          second.body.position.y -
          first.body.position.y;

        let distanceSquared =
          dx * dx + dy * dy;

        if (
          distanceSquared >=
          minimumDistanceSquared
        ) {
          continue;
        }

        let distance =
          Math.sqrt(distanceSquared);

        if (distance < 0.001) {
          const angle =
            Math.random() *
            Math.PI * 2;

          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        const normalX = dx / distance;
        const normalY = dy / distance;

        const overlap =
          BALL_SEPARATION_DISTANCE -
          distance;

        const positionPush =
          Math.min(0.6, overlap * 0.18);

        Body.setPosition(
          first.body,
          {
            x:
              first.body.position.x -
              normalX *
                positionPush,

            y:
              first.body.position.y -
              normalY *
                positionPush
          }
        );

        Body.setPosition(
          second.body,
          {
            x:
              second.body.position.x +
              normalX *
                positionPush,

            y:
              second.body.position.y +
              normalY *
                positionPush
          }
        );

        Body.setVelocity(
          first.body,
          {
            x:
              first.body.velocity.x -
              normalX *
                BALL_SEPARATION_PUSH,

            y:
              first.body.velocity.y -
              normalY *
                BALL_SEPARATION_PUSH
          }
        );

        Body.setVelocity(
          second.body,
          {
            x:
              second.body.velocity.x +
              normalX *
                BALL_SEPARATION_PUSH,

            y:
              second.body.velocity.y +
              normalY *
                BALL_SEPARATION_PUSH
          }
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
      ui.rankingWeek.textContent = getCurrentWeekRange();

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

          const resultBox =
            document.createElement("span");

          resultBox.className =
            "ranking-result";

          const scoreText =
            document.createElement("strong");

          scoreText.className =
            "ranking-score";

          scoreText.textContent =
            `${item.score.toLocaleString()}점`;

          const comboText =
            document.createElement("span");

          comboText.className =
            "ranking-combo";

          comboText.textContent =
            `최고 ${item.bestCombo ?? 0}콤보`;

          resultBox.append(
            scoreText,
            comboText
          );

          row.append(
            rank,
            player,
            resultBox
          );
          return row;
        })
      );
    } catch (error) {
      console.error("랭킹 조회 실패:", error);
      ui.rankingList.innerHTML =
        '<li class="ranking-empty">랭킹을 불러오지 못했습니다.</li>';
    }
  }

  function rankingRefreshRemainingSeconds() {
    return Math.max(
      0,
      Math.ceil(
        (
          rankingRefreshCooldownUntil -
          Date.now()
        ) / 1000
      )
    );
  }

  function stopRankingRefreshTimer() {
    if (!rankingRefreshTimer) {
      return;
    }

    clearInterval(
      rankingRefreshTimer
    );

    rankingRefreshTimer = null;
  }

  function updateRankingRefreshButton() {
    const remainingSeconds =
      rankingRefreshRemainingSeconds();

    if (remainingSeconds > 0) {
      ui.refreshRankingButton.disabled = true;
      ui.refreshRankingButton.textContent =
        `새로고침 (${remainingSeconds}초)`;

      return;
    }

    stopRankingRefreshTimer();

    rankingRefreshCooldownUntil = 0;

    localStorage.removeItem(
      RANKING_REFRESH_STORAGE_KEY
    );

    ui.refreshRankingButton.disabled = false;
    ui.refreshRankingButton.textContent =
      "새로고침";
  }

  function startRankingRefreshCooldown() {
    rankingRefreshCooldownUntil =
      Date.now() +
      RANKING_REFRESH_COOLDOWN_MS;

    localStorage.setItem(
      RANKING_REFRESH_STORAGE_KEY,
      String(
        rankingRefreshCooldownUntil
      )
    );

    stopRankingRefreshTimer();
    updateRankingRefreshButton();

    rankingRefreshTimer = setInterval(
      updateRankingRefreshButton,
      250
    );
  }

  function restoreRankingRefreshCooldown() {
    if (
      rankingRefreshCooldownUntil <=
      Date.now()
    ) {
      updateRankingRefreshButton();
      return;
    }

    updateRankingRefreshButton();

    rankingRefreshTimer = setInterval(
      updateRankingRefreshButton,
      250
    );
  }

  async function handleRankingRefresh(event) {
    /*
     * 버튼이 폼 안으로 이동하거나 마크업이 변경돼도
     * 브라우저의 기본 제출 동작이 실행되지 않게 막는다.
     */
    event.preventDefault();
    event.stopPropagation();

    if (
      rankingRefreshRemainingSeconds() >
      0
    ) {
      updateRankingRefreshButton();
      return;
    }

    /*
     * 조회가 끝나기 전부터 쿨타임을 시작해
     * 연속 클릭으로 중복 요청이 발생하지 않게 한다.
     */
    startRankingRefreshCooldown();

    await renderWeeklyRanking();
  }

  /* =========================================================
   * TURN END
   * ======================================================= */

  /**
   * 턴이 끝났을 때 발사 구역에 남아 있는 실제 물리 공을 제거한다.
   *
   * FLOOR 아래쪽에 공의 중심이 있으면 발사 구역에 있는 것으로 판단한다.
   * 화면에 그려지는 현재 발사 준비 공과 다음 대기열은 물리 공이 아니므로
   * 이 함수의 영향을 받지 않는다.
   */
  /**
   * 필드 밖으로 밀려난 일반 공과 검은 구슬을
   * 삭제하지 않고 필드 안쪽으로 되돌린다.
   *
   * 발사 후 남은 특수공은 기존 규칙대로 제거한다.
   */
  function returnBallsInLaunchAreaToField() {
    const launchAreaBalls =
      balls.filter(ball =>
        ball.body.position.y +
          BALL_RADIUS >=
        FLOOR - 2
    );

    let returnedCount = 0;

    for (
      let i = 0;
      i < launchAreaBalls.length;
      i++
    ) {
      const ball =
        launchAreaBalls[i];

      if (
        !ballByBodyId.has(
          ball.body.id
        ) ||
        ball.specialType
      ) {
        continue;
      }

      const safeX = Math.min(
        W - BALL_RADIUS - 4,
        Math.max(
          BALL_RADIUS + 4,
          ball.body.position.x
        )
      );

      Body.setPosition(
        ball.body,
        {
          x: safeX,
          y:
            FLOOR -
            BALL_RADIUS -
            12
        }
      );

      Body.setVelocity(
        ball.body,
        {
          x: 0,
          y: 0
        }
      );

      Body.setAngularVelocity(
        ball.body,
        0
      );

      ball.hasEnteredField = true;
      ball.isShot = false;

      returnedCount++;
    }

    return returnedCount;
  }

  function finishTurn() {
    activeShotBall = null;
    closeLaunchGate();

    /*
     * 턴 종료 시 발사 구역으로 밀려난 일반 공과 검은 구슬은
     * 삭제하지 않고 필드 안쪽으로 되돌린다.
     *
     * 특히 검은 구슬도 반드시 유지된다.
     */
    const returnedLaunchAreaCount =
      returnBallsInLaunchAreaToField();

    if (returnedLaunchAreaCount > 0) {
      console.debug(
        `필드 밖 공 ${returnedLaunchAreaCount}개 복귀`
      );
    }

    /*
     * 발사 후 멈춘 특수공은 필드에 남기지 않는다.
     * 배열을 복사한 뒤 제거하여 순회 중 인덱스가 꼬이지 않게 한다.
     */
    const stoppedSpecialBalls =
      balls.filter(ball => Boolean(ball.specialType));

    for (let i = 0; i < stoppedSpecialBalls.length; i++) {
      const specialBall =
        stoppedSpecialBalls[i];

      if (specialBall.specialType === "cloud") {
        detonateCloudBall(specialBall);
      } else {
        removeSpecialShot(specialBall);
      }
    }

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

    if (iceTurnsRemaining > 0) {
      iceTurnsRemaining--;

      if (iceTurnsRemaining === 0) {
        deactivateIceFloor();
      }
    }

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

        /*
         * 종료된 게임은 다음 접속 때 복원하지 않는다.
         */
        clearSavedGameState();
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

      const added = addWave();

      statusMessage =
        `새 숫자 공 ${added}개가 추가되었습니다.`;

      statusBadge = "WAVE";

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
          "OVERLOAD! 다음 한 발로 65 아래로 낮추세요.",
          "OVERLOAD"
        );
      }
    }

    updateHud();

    /*
     * 새 공 추가와 과부하 판정까지 끝난
     * 완전한 턴 종료 상태를 자동 저장한다.
     */
    if (!gameOver) {
      saveGameState();
    }
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
    /*
     * 무지개공 대상이 잠깐 반짝인 뒤 동시에 사라진다.
     */
    for (
      let i =
        rainbowEffects.length - 1;
      i >= 0;
      i--
    ) {
      const effect =
        rainbowEffects[i];

      effect.elapsed +=
        deltaTime;

      const progress =
        Math.min(
          1,
          effect.elapsed /
            effect.duration
        );

      for (
        let j = 0;
        j < effect.targets.length;
        j++
      ) {
        const target =
          effect.targets[j];

        if (
          !ballByBodyId.has(
            target.ball.body.id
          )
        ) {
          continue;
        }

        /*
         * 무지개공에 선택된 공은 이펙트가 끝날 때까지
         * 처음 위치에 고정한다.
         *
         * 충돌 직후 반동이나 다른 공의 충격을 받아도
         * 튕겨 나가지 않고 제자리에서 깜빡인다.
         */
        Body.setPosition(
          target.ball.body,
          {
            x: target.x,
            y: target.y
          }
        );

        Body.setVelocity(
          target.ball.body,
          {
            x: 0,
            y: 0
          }
        );

        Body.setAngularVelocity(
          target.ball.body,
          0
        );

        if (
          Math.random() <
          deltaTime * 14
        ) {
          createRainbowSparkles(
            target.x,
            target.y,
            2
          );
        }
      }

      if (progress >= 1) {
        for (
          let j = 0;
          j < effect.targets.length;
          j++
        ) {
          const target =
            effect.targets[j];

          if (
            !ballByBodyId.has(
              target.ball.body.id
            )
          ) {
            continue;
          }

          createRainbowSparkles(
            target.ball.body.position.x,
            target.ball.body.position.y,
            10
          );

          removeBall(
            target.ball
          );

          /*
           * 무지개공으로 제거된 공도 한 개씩 콤보로 처리한다.
           */
          const gained =
            addScore();

          /*
           * 일반 폭발의 createExplosion()을 사용하지 않고
           * 무지개공 전용 점수·콤보 텍스트만 표시한다.
           *
           * 각 공 위치에
           *   +점수
           *   N COMBO!
           * 가 함께 표시된다.
           */
          /*
           * 무지개공 콤보 텍스트는 두 줄로 표시한다.
           *
           * 위: N COMBO!
           * 아래: +점수
           */
          if (
            floatingTexts.length + 2 <=
            MAX_FLOATING_TEXTS
          ) {
            const offsetY =
              (j % 3) * 7;

            floatingTexts.push({
              x: target.x,
              y:
                target.y -
                20 -
                offsetY,
              text:
                `${combo} COMBO!`,
              life: 1.05,
              color: "#ffffff",
              combo: true
            });

            floatingTexts.push({
              x: target.x,
              y:
                target.y +
                8 -
                offsetY,
              text:
                `+${gained}`,
              life: 1.05,
              color: COLORS.rainbow,
              combo: false
            });
          }
        }

        rainbowEffects.splice(
          i,
          1
        );

        updateHud();
      }
    }

    /*
     * 블랙홀 대상 공들이 회전하며 중심으로 빨려 들어간다.
     * 연출이 끝난 순간 공을 제거하고 큰 폭발을 발생시킨다.
     */
    for (
      let i =
        blackHoleEffects.length - 1;
      i >= 0;
      i--
    ) {
      const effect =
        blackHoleEffects[i];

      effect.elapsed +=
        deltaTime;

      const progress =
        Math.min(
          1,
          effect.elapsed /
            effect.duration
        );

      const eased =
        progress * progress *
        (3 - 2 * progress);

      for (
        let j = 0;
        j < effect.targets.length;
        j++
      ) {
        const target =
          effect.targets[j];

        if (
          !ballByBodyId.has(
            target.ball.body.id
          )
        ) {
          continue;
        }

        const angle =
          target.startAngle +
          eased *
            Math.PI *
            target.rotation;

        const radius =
          target.startDistance *
          Math.pow(
            1 - eased,
            1.55
          );

        Body.setPosition(
          target.ball.body,
          {
            x:
              effect.x +
              Math.cos(angle) *
                radius,

            y:
              effect.y +
              Math.sin(angle) *
                radius
          }
        );
      }

      if (
        Math.random() <
        deltaTime * 28
      ) {
        const angle =
          Math.random() *
          Math.PI * 2;

        const radius =
          12 +
          Math.random() *
            BLACK_HOLE_SUCTION_RADIUS;

        particles.push({
          x:
            effect.x +
            Math.cos(angle) *
              radius,
          y:
            effect.y +
            Math.sin(angle) *
              radius,
          vx:
            -Math.cos(angle) *
            (40 + Math.random() * 55),
          vy:
            -Math.sin(angle) *
            (40 + Math.random() * 55),
          size:
            1.8 +
            Math.random() * 3,
          life:
            0.25 +
            Math.random() * 0.25,
          color:
            Math.random() < 0.35
              ? "#ffffff"
              : COLORS.blackHole
        });
      }

      if (progress >= 1) {
        let totalGained = 0;
        let eatenCount = 0;

        for (
          let j = 0;
          j < effect.targets.length;
          j++
        ) {
          const target =
            effect.targets[j];

          if (
            !ballByBodyId.has(
              target.ball.body.id
            )
          ) {
            continue;
          }

          removeBall(
            target.ball
          );

          totalGained +=
            addScore();

          eatenCount++;
        }

        const blastRadius =
          BLACK_HOLE_BASE_BLAST_RADIUS +
          eatenCount *
            BLACK_HOLE_RADIUS_PER_BALL;

        const blastForce =
          BLAST_FORCE +
          eatenCount *
            BLACK_HOLE_FORCE_PER_BALL;

        createExplosion(
          effect.x,
          effect.y,
          COLORS.blackHole,
          totalGained,
          Math.min(
            3,
            1.35 +
              eatenCount * 0.14
          )
        );

        applyBlast(
          effect.x,
          effect.y,
          [],
          blastRadius,
          blastForce
        );

        blackHoleEffects.splice(
          i,
          1
        );

        updateHud();
      }
    }

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

    /*
     * 블랙홀 중심에 회전하는 소용돌이를 그린다.
     */
    for (
      let i = 0;
      i < blackHoleEffects.length;
      i++
    ) {
      const effect =
        blackHoleEffects[i];

      const progress =
        Math.min(
          1,
          effect.elapsed /
            effect.duration
        );

      ctx.save();

      ctx.translate(
        effect.x,
        effect.y
      );

      ctx.rotate(
        effect.elapsed * 11
      );

      const gradient =
        ctx.createRadialGradient(
          0,
          0,
          3,
          0,
          0,
          31 + progress * 7
        );

      gradient.addColorStop(
        0,
        "rgba(0,0,0,1)"
      );

      gradient.addColorStop(
        0.45,
        "rgba(35,16,70,.96)"
      );

      gradient.addColorStop(
        0.78,
        "rgba(109,74,255,.75)"
      );

      gradient.addColorStop(
        1,
        "rgba(109,74,255,0)"
      );

      ctx.fillStyle = gradient;

      ctx.beginPath();
      ctx.arc(
        0,
        0,
        35 + progress * 6,
        0,
        Math.PI * 2
      );
      ctx.fill();

      ctx.strokeStyle =
        "rgba(220,210,255,.78)";

      ctx.lineWidth = 3;
      ctx.lineCap = "round";

      for (
        let arm = 0;
        arm < 3;
        arm++
      ) {
        ctx.beginPath();

        for (
          let step = 0;
          step <= 24;
          step++
        ) {
          const t =
            step / 24;

          const radius =
            5 + t * 31;

          const angle =
            arm *
              (Math.PI * 2 / 3) +
            t * Math.PI * 2.3;

          const px =
            Math.cos(angle) *
            radius;

          const py =
            Math.sin(angle) *
            radius;

          if (step === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }

        ctx.stroke();
      }

      ctx.restore();
    }

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

    let drawScale = 1;
    let drawAlpha = 1;
    let rainbowGlow = 0;

    /*
     * 무지개 효과 대상은 깜빡이면서 살짝 커졌다 작아진다.
     */
    for (
      let i = 0;
      i < rainbowEffects.length;
      i++
    ) {
      const effect =
        rainbowEffects[i];

      const progress =
        Math.min(
          1,
          effect.elapsed /
            effect.duration
        );

      const target =
        effect.targets.find(
          item =>
            item.ball === ball
        );

      if (target) {
        const pulse =
          Math.sin(
            progress *
              Math.PI *
              8 +
            target.phase
          );

        drawScale =
          1 +
          pulse * 0.12;

        drawAlpha =
          0.72 +
          Math.abs(pulse) *
            0.28;

        rainbowGlow =
          10 +
          Math.abs(pulse) *
            10;

        break;
      }
    }

    /*
     * 블랙홀에 흡수되는 공은 중심으로 갈수록 작아진다.
     */
    for (
      let i = 0;
      i < blackHoleEffects.length;
      i++
    ) {
      const effect =
        blackHoleEffects[i];

      const target =
        effect.targets.find(
          item =>
            item.ball === ball
        );

      if (target) {
        const progress =
          Math.min(
            1,
            effect.elapsed /
              effect.duration
          );

        drawScale =
          Math.max(
            0.08,
            1 - progress * 0.92
          );

        drawAlpha =
          Math.max(
            0.22,
            1 - progress * 0.72
          );

        break;
      }
    }

    const color = ball.specialType
      ? shotColor(ball.specialType)
      : ball.isBlack
        ? BLACK_BALL_COLOR
        : numberColor(ball.number);

    ctx.save();

    ctx.globalAlpha =
      drawAlpha;

    if (rainbowGlow > 0) {
      ctx.shadowBlur =
        rainbowGlow;

      ctx.shadowColor =
        `hsl(${
          (
            performance.now() /
            5 +
            position.x
          ) % 360
        } 90% 65%)`;
    }

    ctx.beginPath();

    ctx.arc(
      position.x,
      position.y,
      BALL_RADIUS *
        drawScale,
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
      ctx.fillStyle = ball.specialType
        ? shotTextColor(ball.specialType)
        : numberTextColor(ball.number);

      ctx.font =
        "900 18px system-ui";

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillText(
        ball.specialType
          ? specialBallSymbol(ball.specialType)
          : ball.number,
        position.x,
        position.y + 0.5
      );
    }

    ctx.restore();
  }

  /**
   * 발사 공간에 현재 발사 공과 다음 대기열을 함께 표시한다.
   */
  function drawReadyBall() {
    if (moving) {
      return;
    }

    ctx.save();

    /*
     * 현재 발사 준비 공이 특수공이면
     * 아이콘 왼쪽의 빈 공간에 짧은 효과 설명을 표시한다.
     */
    if (isSpecialShot(currentNumber)) {
      const descriptionLines =
        specialBallLaunchDescription(
          currentNumber
        );

      const infoX = 24;
      const infoY = FLOOR + 10;
      const infoWidth =
        SHOOT_X - BALL_RADIUS - 48;
      const infoHeight = 70;

      ctx.fillStyle =
        "rgba(255,255,255,.055)";

      ctx.fillRect(
        infoX,
        infoY,
        infoWidth,
        infoHeight
      );

      ctx.strokeStyle =
        "rgba(255,255,255,.16)";

      ctx.lineWidth = 1.5;

      ctx.strokeRect(
        infoX,
        infoY,
        infoWidth,
        infoHeight
      );

      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      ctx.fillStyle =
        shotColor(currentNumber);

      ctx.font =
        "900 13px system-ui";

      ctx.fillText(
        specialBallName(currentNumber),
        infoX + 13,
        infoY + 18
      );

      ctx.fillStyle =
        "rgba(255,255,255,.82)";

      ctx.font =
        "700 11px system-ui";

      for (
        let i = 0;
        i < descriptionLines.length;
        i++
      ) {
        ctx.fillText(
          descriptionLines[i],
          infoX + 13,
          infoY + 39 + i * 17
        );
      }
    }

    /*
     * 현재 발사 공
     */
    ctx.beginPath();

    ctx.arc(
      SHOOT_X,
      LAUNCH_Y,
      BALL_RADIUS,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      shotColor(currentNumber);

    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    ctx.fillStyle =
      shotTextColor(currentNumber);

    ctx.font =
      "900 18px system-ui";

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText(
      shotDisplay(currentNumber),
      SHOOT_X,
      LAUNCH_Y
    );

    /*
     * 현재 공 위쪽의 안내 문구
     */
    ctx.fillStyle =
      "rgba(255,255,255,.66)";

    ctx.font =
      "700 12px system-ui";

    ctx.fillText(
      "발사",
      SHOOT_X,
      LAUNCH_Y -
        BALL_RADIUS -
        13
    );

    /*
     * 다음 공 대기열
     */
    ctx.fillStyle =
      "rgba(255,255,255,.66)";

    ctx.font =
      "700 12px system-ui";

    const queueTotalWidth =
      queue.length *
        LAUNCH_QUEUE_RADIUS *
        2 +
      Math.max(
        0,
        queue.length - 1
      ) *
        LAUNCH_QUEUE_GAP;

    const queueCenterX =
      LAUNCH_QUEUE_START_X +
      queueTotalWidth / 2 -
      LAUNCH_QUEUE_RADIUS;

    ctx.fillText(
      "다음",
      queueCenterX,
      LAUNCH_Y -
        LAUNCH_QUEUE_RADIUS -
        15
    );

    for (
      let i = 0;
      i < queue.length;
      i++
    ) {
      const value = queue[i];

      const x =
        LAUNCH_QUEUE_START_X +
        i *
          (
            LAUNCH_QUEUE_RADIUS * 2 +
            LAUNCH_QUEUE_GAP
          );

      const y = LAUNCH_Y;

      /*
       * 발사 공과 대기열 사이 연결 점
       */
      if (i === 0) {
        ctx.fillStyle =
          "rgba(255,255,255,.28)";

        for (
          let dot = 0;
          dot < 3;
          dot++
        ) {
          ctx.beginPath();

          ctx.arc(
            SHOOT_X +
              BALL_RADIUS +
              13 +
              dot * 9,
            LAUNCH_Y,
            2,
            0,
            Math.PI * 2
          );

          ctx.fill();
        }
      }

      ctx.beginPath();

      ctx.arc(
        x,
        y,
        LAUNCH_QUEUE_RADIUS,
        0,
        Math.PI * 2
      );

      ctx.fillStyle =
        shotColor(value);

      ctx.fill();

      ctx.lineWidth = 2;

      ctx.strokeStyle =
        i === 0
          ? "rgba(255,255,255,.92)"
          : "rgba(255,255,255,.5)";

      ctx.stroke();

      ctx.fillStyle =
        shotTextColor(value);

      ctx.font =
        isSpecialShot(value)
          ? "900 14px system-ui"
          : "900 15px system-ui";

      ctx.fillText(
        shotDisplay(value),
        x,
        y + 0.5
      );

      /*
       * 첫 번째 대기 공에는 순서를 조금 더 명확히 표시한다.
       */
      if (i === 0) {
        ctx.fillStyle =
          "rgba(255,255,255,.72)";

        ctx.font =
          "800 9px system-ui";
      }
    }

    ctx.restore();
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

    ctx.fillStyle =
      iceTurnsRemaining > 0
        ? "#182633"
        : "#151b23";

    ctx.fillRect(
      0,
      0,
      W,
      FLOOR
    );

    ctx.fillStyle = "#0d121a";

    ctx.fillRect(
      0,
      FLOOR,
      W,
      H - FLOOR
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

    ctx.strokeStyle =
      iceTurnsRemaining > 0
        ? "#45677a"
        : "#344054";

    ctx.globalAlpha =
      iceTurnsRemaining > 0
        ? 0.23
        : 0.17;
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

    if (iceTurnsRemaining > 0) {
      ctx.fillStyle =
        "rgba(105,185,215,.18)";

      ctx.fillRect(
        0,
        FLOOR - 24,
        W,
        24
      );

      ctx.strokeStyle =
        "rgba(190,225,238,.62)";

      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, FLOOR - 2);
      ctx.lineTo(W, FLOOR - 2);
      ctx.stroke();

      for (
        let iceX = -30;
        iceX < W + 40;
        iceX += 86
      ) {
        ctx.beginPath();
        ctx.moveTo(iceX, FLOOR - 7);
        ctx.lineTo(iceX + 34, FLOOR - 22);
        ctx.lineTo(iceX + 66, FLOOR - 8);
        ctx.lineWidth = 2;
        ctx.strokeStyle =
          "rgba(185,220,232,.25)";
        ctx.stroke();
      }
    }

    /*
     * 발사 구역은 벽 없이 어두운 배경과 안내 문구만 표시한다.
     */
    ctx.fillStyle =
      "rgba(255,255,255,.52)";

    ctx.font =
      "700 13px system-ui";

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    

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

      /*
       * 화면 밖 발사 공이 맵에 들어오지 못한 경우
       * updateOutsideShot 내부에서 턴을 종료한다.
       */
      const outsideShotFinished =
        updateOutsideShot(now);

      if (outsideShotFinished) {
        updateEffects(deltaTime);
        drawScene();

        requestAnimationFrame(
          gameLoop
        );

        return;
      }

      // 기본 마찰 후 느린 공에만 추가 감속을 적용한다.
      applyLowSpeedBraking();

      /*
       * 저속 공끼리 겹쳐 붙는 현상을 방지한다.
       */
      separateStuckBalls();

      const allStopped =
        !hasActiveSpecialEffect() &&
        areAllBallsStopped();

      quietFrames = allStopped
        ? quietFrames + 1
        : 0;

      if (
        !hasActiveSpecialEffect() &&
        (
          quietFrames >=
            REQUIRED_QUIET_FRAMES ||
          now - shotStartedAt >=
            MAX_SHOT_DURATION_MS
        )
      ) {
        /*
         * 구름공이 두 번째 벽에 닿지 않고 바닥이나 공 사이에서
         * 멈춘 경우에도 턴을 바로 끝내지 않는다.
         * 먼저 구름공을 폭발시킨 뒤 폭발로 밀려난 공의 움직임을
         * 다시 물리 엔진에서 처리한다.
         */
        const stoppedCloudBalls =
          balls.filter(
            ball =>
              ball.specialType === "cloud"
          );

        if (stoppedCloudBalls.length > 0) {
          for (
            let i = 0;
            i < stoppedCloudBalls.length;
            i++
          ) {
            detonateCloudBall(
              stoppedCloudBalls[i]
            );
          }

          quietFrames = 0;
          shotStartedAt = now;
        } else {
          finishTurn();
        }
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
    () => {
      clearSavedGameState();
      resetGame(false);
    }
  );

  ui.refreshRankingButton.addEventListener(
    "click",
    handleRankingRefresh
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

  function handleSpecialBadgeInteraction(event) {
    const badge =
      event.target.closest(
        "[data-special-type]"
      );

    if (!badge) {
      return;
    }

    setSpecialBallInfo(
      badge.dataset.specialType
    );
  }

  ui.currentBall.addEventListener(
    "pointerenter",
    handleSpecialBadgeInteraction
  );

  ui.currentBall.addEventListener(
    "focus",
    handleSpecialBadgeInteraction
  );

  ui.currentBall.addEventListener(
    "click",
    handleSpecialBadgeInteraction
  );

  ui.nextBalls.addEventListener(
    "pointerover",
    handleSpecialBadgeInteraction
  );

  ui.nextBalls.addEventListener(
    "focusin",
    handleSpecialBadgeInteraction
  );

  ui.nextBalls.addEventListener(
    "click",
    handleSpecialBadgeInteraction
  );

  /*
   * 다른 페이지로 이동하거나 탭을 닫을 때도
   * 현재 상태가 안정적이면 한 번 더 저장한다.
   */
  window.addEventListener(
    "pagehide",
    saveGameState
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        saveGameState();
      }
    }
  );

  /* =========================================================
   * START
   * ======================================================= */

    resetGame();

  /*
  * 먼저 localStorage에 저장된
  * 랭킹 새로고침 쿨타임을 복원한다.
  */
  restoreRankingRefreshCooldown();

  /*
  * 페이지를 새로고침했을 때 쿨타임이 남아 있다면
  * Firebase에서 랭킹을 다시 불러오지 않는다.
  */
  if (
    rankingRefreshRemainingSeconds() > 0
  ) {
    ui.rankingWeek.textContent =
      getCurrentWeekRange();

    ui.rankingList.innerHTML =
      '<li class="ranking-empty">새로고침 쿨타임이 끝나면 랭킹을 불러올 수 있습니다.</li>';
  } else {
    renderWeeklyRanking();
  }

  if (isFirebaseConfigured()) {
    initializeRanking().catch(error => {
      console.error("Firebase 익명 로그인 실패:", error);
    });
  }

  requestAnimationFrame(
    gameLoop
  );
})();
