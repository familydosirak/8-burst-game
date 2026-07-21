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
    parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
  );

  const koreanDate = new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day))
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
 * 해당 브라우저 익명 계정의 이번 주 최고 점수만 저장한다.
 */
export async function submitWeeklyScore({ nickname, score, bestCombo, turn }) {
  const user = await initializeRanking();
  const weekId = getCurrentWeekId();
  const scoreRef = doc(db, "weeklyRankings", weekId, "scores", user.uid);

  const cleanNickname = sanitizeNickname(nickname);
  const cleanScore = normalizeInteger(score, 0, 1_000_000_000);
  const cleanBestCombo = normalizeInteger(bestCombo, 0, 1_000_000);
  const cleanTurn = normalizeInteger(turn, 0, 1_000_000);

  return runTransaction(db, async transaction => {
    const oldSnapshot = await transaction.get(scoreRef);
    const previousScore = oldSnapshot.exists()
      ? Number(oldSnapshot.data().score || 0)
      : 0;

    if (oldSnapshot.exists() && cleanScore <= previousScore) {
      return {
        updated: false,
        previousScore,
        weekId
      };
    }

    transaction.set(scoreRef, {
      uid: user.uid,
      nickname: cleanNickname,
      score: cleanScore,
      bestCombo: cleanBestCombo,
      turn: cleanTurn,
      weekId,
      updatedAt: serverTimestamp()
    });

    return {
      updated: true,
      previousScore,
      weekId
    };
  });
}

export async function getWeeklyRanking(maxResults = 20) {
  await initializeRanking();

  const weekId = getCurrentWeekId();
  const scoresRef = collection(db, "weeklyRankings", weekId, "scores");
  const rankingQuery = query(
    scoresRef,
    orderBy("score", "desc"),
    limit(Math.max(1, Math.min(100, Number(maxResults) || 20)))
  );

  const snapshot = await getDocs(rankingQuery);

  return {
    weekId,
    rankings: snapshot.docs.map((scoreDocument, index) => {
      const data = scoreDocument.data();

      return {
        rank: index + 1,
        nickname: String(data.nickname || "익명"),
        score: Number(data.score || 0),
        bestCombo: Number(data.bestCombo || 0),
        turn: Number(data.turn || 0)
      };
    })
  };
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