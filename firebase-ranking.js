import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const isConfigured =
  firebaseConfig.apiKey &&
  !firebaseConfig.apiKey.startsWith("YOUR_") &&
  firebaseConfig.projectId &&
  !firebaseConfig.projectId.startsWith("YOUR_");

let auth = null;
let db = null;
let authPromise = null;

export function isFirebaseConfigured() {
  return Boolean(isConfigured);
}

/**
 * 한국 시간 기준 ISO 주차 ID를 만든다.
 * 월요일 00:00부터 일요일 23:59까지 같은 주차로 취급한다.
 * 예: 2026-W30
 */
export function getCurrentWeekId(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );

  const koreanDate = new Date(
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day)
    )
  );

  const day = koreanDate.getUTCDay() || 7;
  koreanDate.setUTCDate(koreanDate.getUTCDate() + 4 - day);

  const weekYear = koreanDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil(
    (((koreanDate - yearStart) / 86400000) + 1) / 7
  );

  return `${weekYear}-W${String(weekNumber).padStart(2, "0")}`;
}

export async function initializeRanking() {
  if (!isConfigured) {
    throw new Error("FIREBASE_NOT_CONFIGURED");
  }

  if (auth?.currentUser) {
    return auth.currentUser;
  }

  if (authPromise) {
    return authPromise;
  }

  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  authPromise = new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      user => {
        if (user) {
          unsubscribe();
          resolve(user);
        }
      },
      reject
    );
  });

  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }

  return authPromise;
}

/**
 * 현재 브라우저의 Firebase 익명 사용자 UID를 반환한다.
 */
export async function getCurrentRankingUserId() {
  const user = await initializeRanking();
  return user.uid;
}

/**
 * 한 번의 게임 결과를 주간 최고 기록과 전체 최고 기록에 함께 반영한다.
 *
 * 주간 기록:
 *   weeklyRankings/{weekId}/scores/{uid}
 *
 * 전체 기록:
 *   allTimeRankings/{uid}
 *
 * 전체 랭킹은 기간별 점수를 합산하지 않고,
 * 사용자의 모든 게임 중 가장 높은 단일 점수를 저장한다.
 */
export async function submitRankingScore({
  nickname,
  score,
  bestCombo,
  turn
}) {
  const user = await initializeRanking();
  const weekId = getCurrentWeekId();

  const weeklyScoreRef = doc(
    db,
    "weeklyRankings",
    weekId,
    "scores",
    user.uid
  );

  const allTimeScoreRef = doc(
    db,
    "allTimeRankings",
    user.uid
  );

  const cleanNickname = sanitizeNickname(nickname);
  const cleanScore = normalizeInteger(
    score,
    0,
    1_000_000_000_000
  );
  const cleanBestCombo = normalizeInteger(
    bestCombo,
    0,
    10_000_000
  );
  const cleanTurn = normalizeInteger(
    turn,
    0,
    1_000_000
  );

  return runTransaction(db, async transaction => {
    /*
     * Firestore 트랜잭션은 모든 읽기를 먼저 끝낸 뒤 쓰기를 진행한다.
     */
    const weeklySnapshot =
      await transaction.get(weeklyScoreRef);

    const allTimeSnapshot =
      await transaction.get(allTimeScoreRef);

    const previousWeeklyScore = weeklySnapshot.exists()
      ? Number(weeklySnapshot.data().score || 0)
      : 0;

    const previousAllTimeScore = allTimeSnapshot.exists()
      ? Number(allTimeSnapshot.data().score || 0)
      : 0;

    const weeklyUpdated =
      !weeklySnapshot.exists() ||
      cleanScore > previousWeeklyScore;

    const allTimeUpdated =
      !allTimeSnapshot.exists() ||
      cleanScore > previousAllTimeScore;

    const commonData = {
      uid: user.uid,
      nickname: cleanNickname,
      score: cleanScore,
      bestCombo: cleanBestCombo,
      turn: cleanTurn,
      updatedAt: serverTimestamp()
    };

    if (weeklyUpdated) {
      transaction.set(weeklyScoreRef, {
        ...commonData,
        weekId
      });
    }

    if (allTimeUpdated) {
      transaction.set(allTimeScoreRef, {
        ...commonData,
        sourceWeekId: weekId
      });
    }

    return {
      uid: user.uid,
      weekId,
      weeklyUpdated,
      allTimeUpdated,
      previousWeeklyScore,
      previousAllTimeScore
    };
  });
}

/**
 * 주간 랭킹과 전체 랭킹을 동시에 조회한다.
 * 게임에서는 이 함수만 호출하므로 탭 전환 시 추가 조회가 발생하지 않는다.
 */
export async function getRankingBundle(maxResults = 20) {
  const user = await initializeRanking();
  const weekId = getCurrentWeekId();
  const safeLimit = Math.max(
    1,
    Math.min(500, Number(maxResults) || 20)
  );

  const weeklyScoresRef = collection(
    db,
    "weeklyRankings",
    weekId,
    "scores"
  );

  const allTimeScoresRef = collection(
    db,
    "allTimeRankings"
  );

  const weeklyQuery = query(
    weeklyScoresRef,
    orderBy("score", "desc"),
    limit(safeLimit)
  );

  const allTimeQuery = query(
    allTimeScoresRef,
    orderBy("score", "desc"),
    limit(safeLimit)
  );

  const [weeklySnapshot, allTimeSnapshot] =
    await Promise.all([
      getDocs(weeklyQuery),
      getDocs(allTimeQuery)
    ]);

  return {
    weekId,
    currentUserUid: user.uid,
    weeklyRankings: mapRankingSnapshot(weeklySnapshot),
    allTimeRankings: mapRankingSnapshot(allTimeSnapshot)
  };
}

/**
 * 필요할 때 개별 조회에도 사용할 수 있도록 유지한다.
 */
export async function getWeeklyRanking(maxResults = 20) {
  const bundle = await getRankingBundle(maxResults);

  return {
    weekId: bundle.weekId,
    currentUserUid: bundle.currentUserUid,
    rankings: bundle.weeklyRankings
  };
}

export async function getAllTimeRanking(maxResults = 20) {
  const bundle = await getRankingBundle(maxResults);

  return {
    currentUserUid: bundle.currentUserUid,
    rankings: bundle.allTimeRankings
  };
}

function mapRankingSnapshot(snapshot) {
  return snapshot.docs.map((scoreDocument, index) => {
    const data = scoreDocument.data();

    return {
      uid: String(data.uid || scoreDocument.id),
      rank: index + 1,
      nickname: String(data.nickname || "익명"),
      score: Number(data.score || 0),
      bestCombo: Number(data.bestCombo || 0),
      turn: Number(data.turn || 0)
    };
  });
}

function sanitizeNickname(value) {
  const nickname = String(value || "")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, 12);

  if (!nickname) {
    throw new Error("NICKNAME_REQUIRED");
  }

  return nickname;
}

function normalizeInteger(value, minimum, maximum) {
  const number = Math.floor(Number(value));

  if (!Number.isFinite(number)) {
    return minimum;
  }

  return Math.max(minimum, Math.min(maximum, number));
}

/**
 * 이번 주 월요일~일요일 날짜 범위를 반환한다.
 * 예: 2026-07-20 ~ 2026-07-26
 */
export function getCurrentWeekRange(date = new Date()) {
  const koreanDate = new Date(
    date.toLocaleString("en-US", {
      timeZone: "Asia/Seoul"
    })
  );

  const day = koreanDate.getDay() || 7;

  const monday = new Date(koreanDate);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - day + 1);

  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  return `${formatDate(monday)} ~ ${formatDate(sunday)}`;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
