/* ==========================================================================
   Badminton Rotation
   Scheduling engine, doubles scoring rules, and the app shell that drives them.
   ========================================================================== */

function pairKey(team) {
  return [...team].sort().join("|");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : value;
  return div.innerHTML;
}

/* --------------------------------------------------------------------------
   Stored state
   -------------------------------------------------------------------------- */

const SESSION_STORAGE_KEY = "badmintonSession";
const LEGACY_SEASON_KEY = "badmintonSeasonState";
const INPUTS_STORAGE_KEY = "badmintonInputs";
const KNOWN_PLAYERS_KEY = "badmintonKnownPlayers";
const THEME_STORAGE_KEY = "badmintonTheme";
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const DEFAULT_GAME_COUNT = 12;
const MIN_GAME_COUNT = 1;
const MAX_GAME_COUNT = 60;

function playersKey(players) {
  return [...players].sort().join("|");
}

function newSession(players, gameCount, courtView = "end") {
  return {
    key: playersKey(players),
    players,
    gameCount,
    courtView,
    schedule: [],
    matchStates: {},
    completedGameIndexes: [],
    expandedGameIndex: null,
    initialComboOrder: null,
    updatedAt: Date.now(),
  };
}

function loadSession(players) {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const state = JSON.parse(raw);
    if (state.key !== playersKey(players)) return null;
    if (!Array.isArray(state.schedule) || !state.schedule.length) return null;
    if (!state.updatedAt || Date.now() - state.updatedAt > SESSION_TTL_MS) {
      clearSession();
      return null;
    }

    if (!state.matchStates) state.matchStates = {};
    if (!Array.isArray(state.completedGameIndexes)) state.completedGameIndexes = [];
    return state;
  } catch {
    return null;
  }
}

function saveSession(state) {
  state.updatedAt = Date.now();
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
}

function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function saveInputs(playersRaw, gameCount) {
  localStorage.setItem(INPUTS_STORAGE_KEY, JSON.stringify({ playersRaw, gameCount }));
}

function loadInputs() {
  const raw = localStorage.getItem(INPUTS_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
   UI primitives: haptics, toasts, dialogs, confetti
   -------------------------------------------------------------------------- */

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Browsers reject (and log) vibrate() before the first real gesture, so wait for one.
let userHasInteracted = false;
["pointerdown", "touchstart", "keydown"].forEach((type) =>
  window.addEventListener(type, () => {
    userHasInteracted = true;
  }, { once: true, passive: true })
);

function haptic(pattern = 8) {
  if (!userHasInteracted || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* vibration is a nice-to-have */
  }
}

function toast(message, emoji = "🏸", duration = 2600) {
  const host = document.getElementById("toastHost");
  if (!host) return;

  while (host.children.length >= 3) host.firstElementChild.remove();

  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="toast-emoji" aria-hidden="true">${emoji}</span><span>${escapeHtml(message)}</span>`;
  host.appendChild(el);

  window.setTimeout(() => {
    el.classList.add("is-leaving");
    window.setTimeout(() => el.remove(), 260);
  }, duration);
}

function confirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  emoji = "❔",
  danger = false,
}) {
  return new Promise((resolve) => {
    const host = document.getElementById("dialogHost");
    const previousFocus = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
        <h3 id="dialogTitle"><span aria-hidden="true">${emoji}</span> ${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="dialog-actions">
          <button type="button" class="ghost cancel-btn">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="confirm-btn${danger ? " is-danger" : ""}">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    const close = (result) => {
      document.removeEventListener("keydown", onKeyDown);
      backdrop.remove();
      if (previousFocus && previousFocus.focus) previousFocus.focus();
      resolve(result);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") close(false);
    };

    backdrop.querySelector(".cancel-btn").addEventListener("click", () => close(false));
    backdrop.querySelector(".confirm-btn").addEventListener("click", () => {
      haptic(12);
      close(true);
    });
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener("keydown", onKeyDown);

    host.appendChild(backdrop);
    backdrop.querySelector(".confirm-btn").focus();
  });
}

const CONFETTI_COLORS = ["#00a862", "#f2a30f", "#21c97c", "#ffd166", "#0f7a4c", "#ffffff"];

function celebrate() {
  if (prefersReducedMotion()) return;

  const host = document.createElement("div");
  host.className = "confetti-host";
  host.setAttribute("aria-hidden", "true");

  for (let i = 0; i < 72; i += 1) {
    const bit = document.createElement("span");
    bit.className = "confetti-bit";
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    bit.style.width = `${6 + Math.random() * 5}px`;
    bit.style.height = `${9 + Math.random() * 8}px`;
    bit.style.animationDuration = `${1500 + Math.random() * 1500}ms`;
    bit.style.animationDelay = `${Math.random() * 320}ms`;
    host.appendChild(bit);
  }

  document.body.appendChild(host);
  window.setTimeout(() => host.remove(), 3800);
}

/* --------------------------------------------------------------------------
   App shell: theme, tabs, progress
   -------------------------------------------------------------------------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;

  const isDark = theme === "dark";
  const toggle = document.getElementById("themeToggle");
  if (toggle) {
    const label = isDark ? "Switch to light theme" : "Switch to dark theme";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
    toggle.setAttribute("aria-pressed", String(isDark));
  }

  const meta = document.getElementById("themeColorMeta");
  if (meta) meta.setAttribute("content", isDark ? "#0b0f0d" : "#f4f6f5");
}

function isCompactLayout() {
  return window.matchMedia("(max-width: 940px)").matches;
}

function setView(view) {
  document.body.dataset.view = view;
  document.querySelectorAll(".tab").forEach((tab) => {
    if (tab.dataset.view === view) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

function scrollToExpandedGame() {
  requestAnimationFrame(() => {
    const card = document.querySelector(".game.expanded");
    if (!card) return;
    card.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  });
}

function updateProgress(session) {
  const bar = document.getElementById("progressBar");
  const badge = document.getElementById("tabBadge");
  const status = document.getElementById("brandStatus");

  if (!session || !session.schedule.length) {
    bar.style.width = "0%";
    badge.hidden = true;
    status.textContent = "Fair games, every time";
    return;
  }

  const total = session.schedule.length;
  const done = session.completedGameIndexes.length;
  const remaining = total - done;

  bar.style.width = `${Math.round((done / total) * 100)}%`;
  badge.hidden = remaining <= 0;
  badge.textContent = String(remaining);
  status.textContent = `${done}/${total} games played`;
}

/* --------------------------------------------------------------------------
   Line-up inputs
   -------------------------------------------------------------------------- */

function loadKnownPlayers() {
  const raw = localStorage.getItem(KNOWN_PLAYERS_KEY);
  if (!raw) return [];

  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function rememberKnownPlayers(players) {
  const known = loadKnownPlayers();
  for (const p of players) {
    if (!known.includes(p)) known.push(p);
  }
  localStorage.setItem(KNOWN_PLAYERS_KEY, JSON.stringify(known));
}

function forgetKnownPlayer(name) {
  const known = loadKnownPlayers().filter((p) => p !== name);
  localStorage.setItem(KNOWN_PLAYERS_KEY, JSON.stringify(known));
}

function renderKnownPlayerChips() {
  const container = document.getElementById("knownPlayersChips");
  const known = loadKnownPlayers();

  container.innerHTML = known
    .map(
      (name) => `
      <span class="chip" data-chip="${escapeHtml(name)}">
        <button type="button" class="chip-add" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>
        <button type="button" class="chip-remove" data-name="${escapeHtml(name)}" aria-label="Forget ${escapeHtml(name)}">×</button>
      </span>
    `
    )
    .join("");

  markActiveChips();
}

function markActiveChips() {
  const current = new Set(parsePlayers(document.getElementById("playersInput").value));
  document.querySelectorAll("#knownPlayersChips .chip").forEach((chip) => {
    const isActive = current.has(chip.dataset.chip);
    chip.classList.toggle("is-active", isActive);
    const addBtn = chip.querySelector(".chip-add");
    addBtn.setAttribute("aria-pressed", String(isActive));
    addBtn.title = isActive ? `Remove ${chip.dataset.chip}` : `Add ${chip.dataset.chip}`;
  });
}

function selectedGameCount() {
  const raw = Number(document.getElementById("gameCountInput").value);
  if (!Number.isFinite(raw)) return DEFAULT_GAME_COUNT;
  return Math.min(MAX_GAME_COUNT, Math.max(MIN_GAME_COUNT, Math.round(raw)));
}

function setGameCount(value) {
  const input = document.getElementById("gameCountInput");
  input.value = String(Math.min(MAX_GAME_COUNT, Math.max(MIN_GAME_COUNT, Math.round(value) || MIN_GAME_COUNT)));
  updateLineUpMeta();
}

/** "8 each" when it divides evenly, otherwise "6–7 each". */
function gamesPerPlayerLabel(playerCount, gameCount) {
  if (playerCount < 4) return "—";
  const slots = gameCount * 4;
  const low = Math.floor(slots / playerCount);
  const high = Math.ceil(slots / playerCount);
  return low === high ? `${low} each` : `${low}–${high} each`;
}

function updateLineUpMeta() {
  const players = parsePlayers(document.getElementById("playersInput").value);
  const count = players.length;
  const hasDuplicates = uniqueFold(players).length !== count;

  const playerBadge = document.getElementById("playerCount");
  playerBadge.textContent = count === 1 ? "1 player" : `${count} players`;
  playerBadge.classList.toggle("is-invalid", count > 0 && (count < 4 || hasDuplicates));

  const gamesBadge = document.getElementById("gamesHint");
  gamesBadge.textContent = gamesPerPlayerLabel(count, selectedGameCount());

  markActiveChips();
}

/* --------------------------------------------------------------------------
   Schedule generation
   -------------------------------------------------------------------------- */

const DEFAULT_ATTEMPTS = 400;
const MIN_ATTEMPTS = 40;
// Rough ceiling on candidate evaluations per build, so no group size can freeze
// the main thread. ~10M lands around 400ms on a laptop, ~1.5s on a mid phone.
const WORK_BUDGET = 1.0e7;

function makeGameConfigs(players) {
  const configs = [];

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      for (let k = j + 1; k < players.length; k += 1) {
        for (let l = k + 1; l < players.length; l += 1) {
          const a = players[i];
          const b = players[j];
          const c = players[k];
          const d = players[l];

          configs.push([[a, b], [c, d]]);
          configs.push([[a, c], [b, d]]);
          configs.push([[a, d], [b, c]]);
        }
      }
    }
  }

  return configs;
}

/** Whole-schedule quality, used to pick the best of many random attempts. */
function evaluateSchedule(schedule, players) {
  const playerGames = new Map(players.map((p) => [p, 0]));
  const partnerCount = new Map();
  const consecutive = new Map(players.map((p) => [p, 0]));

  let maxConsecutive = 0;

  for (const [team1, team2] of schedule) {
    const participants = new Set([...team1, ...team2]);

    for (const p of players) {
      if (participants.has(p)) {
        playerGames.set(p, playerGames.get(p) + 1);

        const newConsecutive = consecutive.get(p) + 1;
        consecutive.set(p, newConsecutive);

        if (newConsecutive > maxConsecutive) {
          maxConsecutive = newConsecutive;
        }
      } else {
        consecutive.set(p, 0);
      }
    }

    const key1 = pairKey(team1);
    const key2 = pairKey(team2);
    partnerCount.set(key1, (partnerCount.get(key1) || 0) + 1);
    partnerCount.set(key2, (partnerCount.get(key2) || 0) + 1);
  }

  const games = players.map((p) => playerGames.get(p));
  const gameImbalance = Math.max(...games) - Math.min(...games);

  let score = gameImbalance * 1000;

  const uniquePartners = partnerCount.size;
  let repeatedPartnerships = 0;
  for (const count of partnerCount.values()) {
    repeatedPartnerships += Math.max(0, count - 1);
  }

  score += repeatedPartnerships * 500;
  score -= uniquePartners * 100;

  if (maxConsecutive >= 4) {
    score += 5000;
  } else if (maxConsecutive === 3) {
    score += 1500;
  } else if (maxConsecutive === 2) {
    score += 200;
  }

  return score;
}

/**
 * Build exactly `gameCount` games for `players`.
 *
 * Each game is chosen greedily from every possible foursome-and-pairing, scored
 * as follows (lower is better) — this is the original balancing logic, retargeted
 * from "everyone plays N" to "everyone plays as close to the ideal as the
 * requested game count allows":
 *
 *   + 100 x (ideal - gamesAfterThisMatch)^2   per player  → even game counts
 *   + 900                                     per player resting again  → spread rests
 *   + 120 x timesAlreadyPaired                per team    → fresh partnerships
 *   -  80                                     per brand-new pair
 *   + random x 20                                         → variety
 *
 * The ten lowest-scoring candidates are kept and one is picked at random, and the
 * whole thing is retried many times keeping the best result by `evaluateSchedule`.
 *
 * The scoring is inlined over typed arrays with precomputed pair keys: the
 * straightforward version allocated a Set and two sorted key strings per
 * candidate per game per attempt, which froze the page for tens of seconds.
 */
function generateSchedule(players, gameCount, attempts = DEFAULT_ATTEMPTS) {
  const playerCount = players.length;
  if (playerCount < 4 || gameCount < 1) return [];

  const configs = makeGameConfigs(players);
  const configCount = configs.length;
  const playerIndex = new Map(players.map((p, i) => [p, i]));

  const configPlayers = new Int32Array(configCount * 4);
  const configPairKeys = new Array(configCount);
  for (let c = 0; c < configCount; c += 1) {
    const [teamA, teamB] = configs[c];
    const o = c * 4;
    configPlayers[o] = playerIndex.get(teamA[0]);
    configPlayers[o + 1] = playerIndex.get(teamA[1]);
    configPlayers[o + 2] = playerIndex.get(teamB[0]);
    configPlayers[o + 3] = playerIndex.get(teamB[1]);
    configPairKeys[c] = [pairKey(teamA), pairKey(teamB)];
  }

  const idealGames = (gameCount * 4) / playerCount;
  const gamesCeiling = Math.ceil(idealGames);
  // Perfectly even only when the player-slots divide by the head count.
  const bestPossibleSpread = Number.isInteger(idealGames) ? 0 : 1;

  const runs = Math.min(
    attempts,
    Math.max(MIN_ATTEMPTS, Math.floor(WORK_BUDGET / (configCount * gameCount)))
  );

  const TOP = 10;
  const playerGames = new Int32Array(playerCount);
  const restStreak = new Int32Array(playerCount);
  const topScores = new Float64Array(TOP);
  const topConfigs = new Int32Array(TOP);

  let best = null;
  let bestScore = Infinity;
  let fallback = null;
  let fallbackKey = Infinity;

  for (let run = 0; run < runs; run += 1) {
    const schedule = [];
    const partnerCount = new Map();
    playerGames.fill(0);
    restStreak.fill(0);

    while (schedule.length < gameCount) {
      /* Every candidate shares the same sum over all players and differs only for
         its own four, so compute the shared part once. A player who plays turns
         (ideal-games)^2 into (ideal-games-1)^2, i.e. adds 1 - 2*(ideal-games),
         and drops their rest penalty. Algebraically exact, not an approximation. */
      let baseSquares = 0;
      let baseRest = 0;
      for (let i = 0; i < playerCount; i += 1) {
        const delta = idealGames - playerGames[i];
        baseSquares += delta * delta;
        if (restStreak[i] > 0) baseRest += 900;
      }

      let topCount = 0;

      /* Pass 0 keeps every player at or under the ceiling. If that leaves nothing
         playable (possible when the remaining allowance bunches on fewer than four
         players), pass 1 drops the ceiling so the requested count is still met. */
      for (let pass = 0; pass < 2 && topCount === 0; pass += 1) {
        const useCeiling = pass === 0;
        let worstTop = Infinity;

        for (let c = 0; c < configCount; c += 1) {
          const o = c * 4;
          const p0 = configPlayers[o];
          const p1 = configPlayers[o + 1];
          const p2 = configPlayers[o + 2];
          const p3 = configPlayers[o + 3];

          const g0 = playerGames[p0];
          const g1 = playerGames[p1];
          const g2 = playerGames[p2];
          const g3 = playerGames[p3];

          if (useCeiling && (g0 >= gamesCeiling || g1 >= gamesCeiling || g2 >= gamesCeiling || g3 >= gamesCeiling)) {
            continue;
          }

          const squares = baseSquares
            + 1 - 2 * (idealGames - g0)
            + 1 - 2 * (idealGames - g1)
            + 1 - 2 * (idealGames - g2)
            + 1 - 2 * (idealGames - g3);

          let rest = baseRest;
          if (restStreak[p0] > 0) rest -= 900;
          if (restStreak[p1] > 0) rest -= 900;
          if (restStreak[p2] > 0) rest -= 900;
          if (restStreak[p3] > 0) rest -= 900;

          let score = squares * 100 + rest;

          const keys = configPairKeys[c];
          for (let k = 0; k < 2; k += 1) {
            const count = partnerCount.get(keys[k]) || 0;
            score += count * 120;
            if (count === 0) score -= 80;
          }

          score += Math.random() * 20;

          // Keep the ten lowest scores, stable on ties.
          if (topCount < TOP || score < worstTop) {
            let pos = topCount < TOP ? topCount : TOP - 1;
            while (pos > 0 && topScores[pos - 1] > score) {
              topScores[pos] = topScores[pos - 1];
              topConfigs[pos] = topConfigs[pos - 1];
              pos -= 1;
            }
            topScores[pos] = score;
            topConfigs[pos] = c;
            if (topCount < TOP) topCount += 1;
            worstTop = topScores[topCount - 1];
          }
        }
      }

      if (topCount === 0) break;

      const chosen = topConfigs[Math.floor(Math.random() * topCount)];
      const o = chosen * 4;
      const s0 = configPlayers[o];
      const s1 = configPlayers[o + 1];
      const s2 = configPlayers[o + 2];
      const s3 = configPlayers[o + 3];

      schedule.push(configs[chosen]);

      for (let i = 0; i < playerCount; i += 1) {
        if (i === s0 || i === s1 || i === s2 || i === s3) {
          playerGames[i] += 1;
          restStreak[i] = 0;
        } else {
          restStreak[i] += 1;
        }
      }

      const keys = configPairKeys[chosen];
      partnerCount.set(keys[0], (partnerCount.get(keys[0]) || 0) + 1);
      partnerCount.set(keys[1], (partnerCount.get(keys[1]) || 0) + 1);
    }

    if (schedule.length < gameCount) continue;

    let minGames = Infinity;
    let maxGames = -Infinity;
    for (let i = 0; i < playerCount; i += 1) {
      if (playerGames[i] < minGames) minGames = playerGames[i];
      if (playerGames[i] > maxGames) maxGames = playerGames[i];
    }

    const spread = maxGames - minGames;
    const finalScore = evaluateSchedule(schedule, players);

    if (spread <= bestPossibleSpread) {
      if (finalScore < bestScore) {
        bestScore = finalScore;
        best = schedule;
      }
    } else if (spread * 1e9 + finalScore < fallbackKey) {
      fallbackKey = spread * 1e9 + finalScore;
      fallback = schedule;
    }
  }

  return best || fallback || [];
}

/* --------------------------------------------------------------------------
   Match state & service rules
   -------------------------------------------------------------------------- */

function createMatchState(topTeam, bottomTeam, targetScore = 11) {
  return {
    targetScore,
    topScore: 0,
    bottomScore: 0,
    server: "",
    receiver: "",
    firstServer: "",
    firstReceiver: "",
    courtServingTeam: "",
    courtView: "end",
    courtServingPlacement: "bottom",
    topPositions: { left: topTeam[0], right: topTeam[1] },
    bottomPositions: { left: bottomTeam[0], right: bottomTeam[1] },
    undoStack: [],
    finished: false,
  };
}

function shuffled(values) {
  return [...values].sort(() => Math.random() - 0.5);
}

function initializeMatchState(state, topTeam, bottomTeam, gameIndex, session) {
  if (state.server && state.receiver) return;

  if (!session.initialComboOrder) {
    session.initialComboOrder = shuffled([...Array(8).keys()]);
  }

  const combo = session.initialComboOrder[gameIndex % session.initialComboOrder.length];
  const serverCandidates = [...topTeam, ...bottomTeam];
  const server = serverCandidates[Math.floor(combo / 2)];
  const servingTeam = teamForPlayer(server, topTeam, bottomTeam);
  const receivingTeam = servingTeam === "top" ? bottomTeam : topTeam;
  const receiver = receivingTeam[combo % 2];

  state.server = server;
  state.receiver = receiver;
  state.firstServer = server;
  state.firstReceiver = receiver;
  state.courtServingTeam = servingTeam;
  state.courtView = session.courtView || "end";
  state.courtServingPlacement = Math.random() < 0.5 ? "top" : "bottom";
  placeServerAndReceiver(state, topTeam, bottomTeam);
}

function teamForPlayer(player, topTeam, bottomTeam) {
  return topTeam.includes(player) ? "top" : bottomTeam.includes(player) ? "bottom" : "";
}

function placePlayer(positions, team, player, side) {
  positions[side] = player;
  positions[side === "right" ? "left" : "right"] = team.find((name) => name !== player);
}

function oppositePositionKey(position) {
  return position === "right" ? "left" : "right";
}

function receiverPositionKey(state, serverPosition) {
  return state.courtView === "side" ? serverPosition : oppositePositionKey(serverPosition);
}

function servicePositionKey(state, team, score) {
  const serviceSide = score % 2 === 0 ? "right" : "left";
  if (state.courtView !== "end") return serviceSide;

  const initialTeamAtTop = state.courtServingPlacement === "top"
    ? state.courtServingTeam
    : state.courtServingTeam === "top" ? "bottom" : "top";
  const teamIsAtTop = team === initialTeamAtTop;

  return teamIsAtTop ? (serviceSide === "right" ? "left" : "right") : serviceSide;
}

function placeServerAndReceiver(state, topTeam, bottomTeam) {
  if (!state.server) return;
  const servingTeam = teamForPlayer(state.server, topTeam, bottomTeam);
  const servingScore = servingTeam === "top" ? state.topScore : state.bottomScore;
  const serverSide = servicePositionKey(state, servingTeam, servingScore);
  const serverPositions = servingTeam === "top" ? state.topPositions : state.bottomPositions;
  const receivingPositions = servingTeam === "top" ? state.bottomPositions : state.topPositions;
  const serverTeam = servingTeam === "top" ? topTeam : bottomTeam;
  const receivingTeam = servingTeam === "top" ? bottomTeam : topTeam;

  placePlayer(serverPositions, serverTeam, state.server, serverSide);
  if (state.receiver) placePlayer(receivingPositions, receivingTeam, state.receiver, receiverPositionKey(state, serverSide));
}

function gameComplete(state) {
  return Math.max(state.topScore, state.bottomScore) >= state.targetScore
    && Math.abs(state.topScore - state.bottomScore) >= 2;
}

function scorePoint(state, winningTeam, topTeam, bottomTeam) {
  if (!state.server || !state.receiver || state.finished || gameComplete(state)) return;

  state.undoStack.push({
    topScore: state.topScore,
    bottomScore: state.bottomScore,
    server: state.server,
    receiver: state.receiver,
    topPositions: { ...state.topPositions },
    bottomPositions: { ...state.bottomPositions },
  });

  const servingTeam = teamForPlayer(state.server, topTeam, bottomTeam);
  const servingPositions = servingTeam === "top" ? state.topPositions : state.bottomPositions;
  const receivingPositions = servingTeam === "top" ? state.bottomPositions : state.topPositions;

  if (winningTeam === "top") state.topScore += 1;
  else state.bottomScore += 1;

  if (winningTeam === servingTeam) {
    const servingScore = servingTeam === "top" ? state.topScore : state.bottomScore;
    const nextServerSide = servicePositionKey(state, servingTeam, servingScore);
    const servingPlayers = servingTeam === "top" ? topTeam : bottomTeam;
    placePlayer(servingPositions, servingPlayers, state.server, nextServerSide);
    state.receiver = receivingPositions[receiverPositionKey(state, nextServerSide)];
  } else {
    const newServingTeam = winningTeam;
    const newServingScore = newServingTeam === "top" ? state.topScore : state.bottomScore;
    const newServerSide = servicePositionKey(state, newServingTeam, newServingScore);
    const newServingPositions = newServingTeam === "top" ? state.topPositions : state.bottomPositions;
    const newServingPlayers = newServingTeam === "top" ? topTeam : bottomTeam;
    state.server = newServingPositions[newServerSide];
    state.receiver = servingPositions[receiverPositionKey(state, newServerSide)];
    placePlayer(newServingPositions, newServingPlayers, state.server, newServerSide);
  }

  placeServerAndReceiver(state, topTeam, bottomTeam);
}

function undoScore(state) {
  const previous = state.undoStack.pop();
  if (previous && !state.finished) Object.assign(state, previous);
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

// Remembers the last rendered score per game so a fresh point can animate.
const renderedScores = new Map();

function courtPlayerHtml(name, match) {
  const isServer = Boolean(name) && name === match.server;
  const isReceiver = Boolean(name) && name === match.receiver;
  const roleTag = isServer
    ? '<span class="role-tag">SERVE</span>'
    : isReceiver
      ? '<span class="role-tag">RETURN</span>'
      : "";

  return `<span class="court-player${isServer ? " is-server" : ""}${isReceiver ? " is-receiver" : ""}">${escapeHtml(name)}${roleTag}</span>`;
}

/* Player boxes are drawn as seen from the viewer, so the far side is mirrored —
   that is why no left/right letters are stamped here. The service-court call-out
   below the court states the side from the server's own point of view. */
function courtSideHtml(label, positions, match) {
  return `<div class="court-side${label === "Serving" ? " serving" : ""}">
    <span class="court-label">${label === "Serving" ? "🏸 " : ""}${escapeHtml(label)}</span>
    ${courtPlayerHtml(positions.left, match)}
    ${courtPlayerHtml(positions.right, match)}
  </div>`;
}

function statusPillFor(match, isDone) {
  if (isDone) return { text: "Final", emoji: "✅", cls: "is-done" };
  if (gameComplete(match)) return { text: "Ready", emoji: "🏁", cls: "is-live" };
  if (match.topScore > 0 || match.bottomScore > 0) return { text: "In play", emoji: "🔴", cls: "is-live" };
  return { text: "Tap to score", emoji: "👆", cls: "" };
}

function renderEmptyState(message = "No schedule yet") {
  return `
    <div class="empty-state">
      <span class="empty-emoji" aria-hidden="true">🏸</span>
      <strong>${escapeHtml(message)}</strong>
      <span>Add at least four player names in the Line-up tab, choose how many games you want, then tap Start Session.</span>
    </div>
  `;
}

function renderSchedule(session) {
  const players = session.players;
  const schedule = session.schedule;
  const output = document.getElementById("output");
  const metaText = document.getElementById("metaText");
  const resetBtn = document.getElementById("resetCurrentSetBtn");
  const regenerateBtn = document.getElementById("regenerateBtn");
  output.innerHTML = "";

  const completedGameIndexes = new Set(session.completedGameIndexes);
  if (!session.matchStates) session.matchStates = {};

  const playerGames = new Map(players.map((p) => [p, 0]));
  const partnerCount = new Map();

  schedule.forEach(([team1, team2], idx) => {
    const participants = new Set([...team1, ...team2]);
    const rest = players.filter((p) => !participants.has(p));

    for (const p of participants) {
      playerGames.set(p, playerGames.get(p) + 1);
    }

    partnerCount.set(pairKey(team1), (partnerCount.get(pairKey(team1)) || 0) + 1);
    partnerCount.set(pairKey(team2), (partnerCount.get(pairKey(team2)) || 0) + 1);

    let state = session.matchStates[idx];
    if (!state) {
      state = createMatchState(team1, team2);
      session.matchStates[idx] = state;
    }
    initializeMatchState(state, team1, team2, idx, session);

    const isDone = completedGameIndexes.has(idx);
    const expanded = session.expandedGameIndex === idx;
    const status = statusPillFor(state, isDone);
    const started = state.topScore > 0 || state.bottomScore > 0;
    const leader = state.topScore === state.bottomScore ? "" : state.topScore > state.bottomScore ? "top" : "bottom";

    const card = document.createElement("article");
    card.className = `game${isDone ? " done" : ""}${expanded ? " expanded" : ""}`;
    card.innerHTML = `
      <button type="button" class="game-summary" aria-expanded="${expanded}">
        <span class="game-top">
          <span class="game-badge"><span aria-hidden="true">🏸</span> Game ${idx + 1}</span>
          <span class="score-pill${started ? " is-live" : ""}">
            <b class="${leader === "top" ? "lead" : ""}">${state.topScore}</b><i>–</i><b class="${leader === "bottom" ? "lead" : ""}">${state.bottomScore}</b>
          </span>
          <span class="chevron" aria-hidden="true">›</span>
        </span>
        <span class="matchup">
          <span class="team side-a${isDone && leader === "top" ? " is-winner" : ""}">${escapeHtml(team1.join(" + "))}</span>
          <span class="vs" aria-hidden="true">VS</span>
          <span class="team side-b${isDone && leader === "bottom" ? " is-winner" : ""}">${escapeHtml(team2.join(" + "))}</span>
        </span>
        <span class="game-meta">
          <span class="pill rest"><span aria-hidden="true">😴</span><span>${escapeHtml(rest.length ? rest.join(", ") : "Everyone plays")}</span></span>
          <span class="pill status ${status.cls}"><span aria-hidden="true">${status.emoji}</span>${escapeHtml(status.text)}</span>
        </span>
      </button>
    `;

    if (expanded) {
      const match = state;
      match.targetScore = match.targetScore || 11;
      const servingTeam = teamForPlayer(match.server, team1, team2);
      const hasServer = Boolean(servingTeam);
      const courtView = session.courtView || "end";
      const servingPlacement = match.courtServingPlacement || (courtView === "side" ? "right" : "bottom");
      const courtServingTeam = match.courtServingTeam || "top";
      const alternateTeam = courtServingTeam === "top" ? "bottom" : "top";
      const servingStartsPrimary = servingPlacement === "top" || servingPlacement === "left";
      const primaryTeam = servingStartsPrimary ? courtServingTeam : alternateTeam;
      const secondaryTeam = primaryTeam === "top" ? "bottom" : "top";
      const primaryPositions = primaryTeam === "top" ? match.topPositions : match.bottomPositions;
      const secondaryPositions = secondaryTeam === "top" ? match.topPositions : match.bottomPositions;
      const primaryLabel = hasServer ? (servingTeam === primaryTeam ? "Serving" : "Receiving") : "Team";
      const secondaryLabel = hasServer ? (servingTeam === secondaryTeam ? "Serving" : "Receiving") : "Team";
      const primaryButtonTeam = primaryTeam === "top" ? team1 : team2;
      const secondaryButtonTeam = secondaryTeam === "top" ? team1 : team2;
      const primaryButtonScore = primaryTeam === "top" ? match.topScore : match.bottomScore;
      const secondaryButtonScore = secondaryTeam === "top" ? match.topScore : match.bottomScore;
      const pointsLocked = !match.server || !match.receiver || match.finished || gameComplete(match);
      const serviceBox = (servingTeam === "top" ? match.topScore : match.bottomScore) % 2 === 0 ? "right" : "left";
      // The primary side is drawn first: top in back view, left in sideline view.
      const primaryEnd = courtView === "side" ? "Left" : "Top";
      const secondaryEnd = courtView === "side" ? "Right" : "Bottom";
      const servingEnd = hasServer ? (servingTeam === primaryTeam ? primaryEnd : secondaryEnd) : "—";
      const servingEndIcon = !hasServer
        ? "·"
        : servingTeam === primaryTeam
          ? (courtView === "side" ? "←" : "↑")
          : (courtView === "side" ? "→" : "↓");

      // Which side just scored? Used to pop the number on that button only.
      const previous = renderedScores.get(idx);
      const snapshot = `${match.topScore}:${match.bottomScore}`;
      let poppedTeam = "";
      if (previous && previous !== snapshot) {
        const [prevTop, prevBottom] = previous.split(":").map(Number);
        if (match.topScore > prevTop) poppedTeam = "top";
        else if (match.bottomScore > prevBottom) poppedTeam = "bottom";
      }
      renderedScores.set(idx, snapshot);

      const winner = match.topScore > match.bottomScore ? team1 : team2;
      const winBanner = gameComplete(match)
        ? `<div class="win-banner">
             <span class="win-emoji" aria-hidden="true">${match.finished ? "🏆" : "🏁"}</span>
             <span>${escapeHtml(winner.join(" + "))} ${match.finished ? "won" : "win"} ${Math.max(match.topScore, match.bottomScore)}–${Math.min(match.topScore, match.bottomScore)}${match.finished ? "" : " · tap Finish"}</span>
           </div>`
        : "";

      const scorer = document.createElement("section");
      scorer.className = "scorer-panel";
      scorer.innerHTML = `
        <div class="scorer-settings">
          <div class="setting-field score-field">
            <span>Play to</span>
            <div class="segmented score-switch" role="radiogroup" aria-label="Game target score">
              <input id="scoreTarget11-${idx}" name="scoreTarget-${idx}" type="radio" value="11"${match.targetScore === 11 ? " checked" : ""}${started || match.finished ? " disabled" : ""}>
              <label for="scoreTarget11-${idx}">11</label>
              <input id="scoreTarget21-${idx}" name="scoreTarget-${idx}" type="radio" value="21"${match.targetScore === 21 ? " checked" : ""}${started || match.finished ? " disabled" : ""}>
              <label for="scoreTarget21-${idx}">21</label>
            </div>
          </div>
          <div class="setting-field">
            <span>Serving end</span>
            <strong><span class="dir" aria-hidden="true">${servingEndIcon}</span>${escapeHtml(servingEnd)}</strong>
          </div>
          <div class="setting-field first-serve-field">
            <span>First serve</span>
            <strong>${escapeHtml(match.firstServer)} <span class="dir" aria-hidden="true">→</span><span class="sr-only">to</span> ${escapeHtml(match.firstReceiver)}</strong>
          </div>
        </div>
        <div class="court ${courtView === "side" ? "court-side-view" : "court-end-view"}">
          ${courtSideHtml(primaryLabel, primaryPositions, match)}
          <div class="net" aria-hidden="true"><span>NET</span></div>
          ${courtSideHtml(secondaryLabel, secondaryPositions, match)}
        </div>
        <p class="service-note">
          <span class="service-callout-text">${match.server && match.receiver
            ? `<em>${escapeHtml(match.server)}</em> serves to <em>${escapeHtml(match.receiver)}</em> · ${serviceBox} service court`
            : "Select the first server and receiver."}</span>
        </p>
        ${winBanner}
        <div class="scorer-actions">
          <div class="point-actions">
            <button type="button" class="point-btn primary-point${servingTeam === primaryTeam ? " is-serving" : ""}${poppedTeam === primaryTeam ? " score-pop" : ""}" ${pointsLocked ? "disabled" : ""}>
              <span class="pt-team">${escapeHtml(primaryButtonTeam.join(" + "))}</span>
              <span class="pt-score">${primaryButtonScore}</span>
              <span class="pt-add"><span aria-hidden="true">＋</span>1 point</span>
            </button>
            <button type="button" class="point-btn secondary-point${servingTeam === secondaryTeam ? " is-serving" : ""}${poppedTeam === secondaryTeam ? " score-pop" : ""}" ${pointsLocked ? "disabled" : ""}>
              <span class="pt-team">${escapeHtml(secondaryButtonTeam.join(" + "))}</span>
              <span class="pt-score">${secondaryButtonScore}</span>
              <span class="pt-add"><span aria-hidden="true">＋</span>1 point</span>
            </button>
          </div>
          <div class="game-actions">
            <button type="button" class="ghost undo-btn" ${match.undoStack.length === 0 || match.finished ? "disabled" : ""}><span aria-hidden="true">↩︎</span> Undo</button>
            <button type="button" class="finish-btn${gameComplete(match) && !match.finished ? " is-ready" : ""}" ${!gameComplete(match) || match.finished ? "disabled" : ""}><span aria-hidden="true">${match.finished ? "🏆" : "✅"}</span> ${match.finished ? "Finished" : "Finish Game"}</button>
          </div>
        </div>
      `;

      const update = (change) => {
        if (!session.matchStates[idx]) session.matchStates[idx] = createMatchState(team1, team2);
        change(session.matchStates[idx]);
        saveSession(session);
        showSession(session);
      };

      scorer.querySelectorAll(`input[name="scoreTarget-${idx}"]`).forEach((input) =>
        input.addEventListener("change", (event) =>
          update((active) => {
            active.targetScore = Number(event.target.value);
          })
        )
      );

      const addPoint = (team) => (event) => {
        event.stopPropagation();
        haptic(10);
        update((active) => scorePoint(active, team, team1, team2));
      };

      scorer.querySelector(".primary-point").addEventListener("click", addPoint(primaryTeam));
      scorer.querySelector(".secondary-point").addEventListener("click", addPoint(secondaryTeam));

      scorer.querySelector(".undo-btn").addEventListener("click", () => {
        haptic(6);
        update(undoScore);
      });

      scorer.querySelector(".finish-btn").addEventListener("click", () => {
        const active = session.matchStates[idx];
        if (!active || !gameComplete(active) || active.finished) return;

        const winners = active.topScore > active.bottomScore ? team1 : team2;
        const high = Math.max(active.topScore, active.bottomScore);
        const low = Math.min(active.topScore, active.bottomScore);

        update((current) => {
          current.finished = true;
          completedGameIndexes.add(idx);
          session.completedGameIndexes = [...completedGameIndexes];
        });

        haptic([14, 50, 20]);
        celebrate();
        toast(`${winners.join(" + ")} win ${high}–${low}`, "🏆", 3200);

        const nextIdx = schedule.findIndex((_, i) => !completedGameIndexes.has(i));
        window.setTimeout(() => {
          session.expandedGameIndex = nextIdx >= 0 ? nextIdx : null;
          saveSession(session);
          showSession(session);
          if (nextIdx >= 0) scrollToExpandedGame();
          else toast("Every game played — nice session", "🎉", 4000);
        }, 1150);
      });

      card.appendChild(scorer);
    }

    card.querySelector(".game-summary").addEventListener("click", () => {
      const opening = !expanded;
      haptic(6);
      session.expandedGameIndex = opening ? idx : null;
      saveSession(session);
      showSession(session);
      if (opening) scrollToExpandedGame();
    });

    output.appendChild(card);
  });

  if (!schedule.length) {
    output.innerHTML = renderEmptyState("Couldn't build that schedule");
  }

  /* ---- Balance summary ---- */

  const totalPossible = (players.length * (players.length - 1)) / 2;
  const uniquePartners = partnerCount.size;
  const playedCount = completedGameIndexes.size;

  let repeated = 0;
  for (const count of partnerCount.values()) {
    repeated += Math.max(0, count - 1);
  }

  const counts = players.map((p) => playerGames.get(p) || 0);
  const spread = counts.length ? Math.max(...counts) - Math.min(...counts) : 0;

  const rows = players
    .map((p) => {
      const games = playerGames.get(p) || 0;
      return `<tr><td>${escapeHtml(p)}</td><td>${games}</td><td>${schedule.length - games}</td></tr>`;
    })
    .join("");

  const stat = document.createElement("div");
  stat.className = "stat";
  stat.innerHTML = `
    <div class="stat-block">
      <h3 class="stat-title"><span aria-hidden="true">📊</span> Balance</h3>
      <div class="stat-cards">
        <div class="stat-card"><span class="value">${schedule.length}</span><span class="label">Games</span></div>
        <div class="stat-card${playedCount === schedule.length && schedule.length ? " is-good" : ""}"><span class="value">${playedCount}/${schedule.length}</span><span class="label">Played</span></div>
        <div class="stat-card"><span class="value">${uniquePartners}/${totalPossible}</span><span class="label">Unique pairs</span></div>
        <div class="stat-card${repeated === 0 ? " is-good" : ""}"><span class="value">${repeated}</span><span class="label">Repeat pairs</span></div>
      </div>
      <table class="stat-table">
        <thead><tr><th>Player</th><th>Games</th><th>Rest</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="stat-note${spread === 0 ? " is-good" : ""}">
        <span aria-hidden="true">${spread === 0 ? "✅" : "⚖️"}</span>
        ${spread === 0
          ? "Everyone plays the same number of games."
          : `Games differ by ${spread} — the closest possible split for ${schedule.length} game${schedule.length === 1 ? "" : "s"} between ${players.length} players.`}
      </p>
    </div>
  `;
  output.appendChild(stat);

  resetBtn.disabled = schedule.length === 0;
  resetBtn.onclick = async () => {
    const ok = await confirmDialog({
      title: "Clear all scores?",
      message: "Every score and finished marker is reset. The match-ups stay exactly as they are.",
      confirmLabel: "Clear scores",
      emoji: "↺",
      danger: true,
    });
    if (!ok) return;

    session.completedGameIndexes = [];
    session.matchStates = {};
    session.expandedGameIndex = null;
    renderedScores.clear();
    saveSession(session);
    showSession(session);
    toast("Scores cleared", "↺");
  };

  regenerateBtn.disabled = false;
  regenerateBtn.onclick = async () => {
    const requested = selectedGameCount();
    if (playedCount > 0) {
      const ok = await confirmDialog({
        title: "Build a new schedule?",
        message: `${playedCount} finished game${playedCount === 1 ? "" : "s"} will be discarded and ${requested} fresh match-up${requested === 1 ? "" : "s"} generated.`,
        confirmLabel: "Regenerate",
        emoji: "🎲",
        danger: true,
      });
      if (!ok) return;
    }
    await withBusyState(regenerateBtn, () => buildSchedule(session, requested));
  };

  const remaining = schedule.length - playedCount;
  const summary = `${schedule.length} game${schedule.length === 1 ? "" : "s"} · ${remaining === 0 ? "all done 🎉" : `${remaining} to play`}`;
  metaText.textContent = schedule.length
    ? (playedCount === 0 ? `${summary} · tap one to score` : summary)
    : "No games could be generated for this line-up.";

  updateProgress(session);
}

/* --------------------------------------------------------------------------
   Session flow
   -------------------------------------------------------------------------- */

function parsePlayers(raw) {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Distinct names ignoring case, so "Alex" and "alex" count as one person. */
function uniqueFold(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function validatePlayers(players) {
  if (players.length < 4) {
    return players.length === 0
      ? "Add at least 4 player names to get started."
      : `Need at least 4 players — ${4 - players.length} more to go.`;
  }

  const seen = new Set();
  const duplicates = new Set();
  for (const p of players) {
    const key = p.toLowerCase();
    if (seen.has(key)) duplicates.add(p);
    seen.add(key);
  }

  if (duplicates.size) {
    return `Player names must be unique — check ${[...duplicates].join(", ")}.`;
  }

  return "";
}

// The session currently on screen, so control state can be re-synced from anywhere.
let activeSession = null;

function updateNavControls(session) {
  const startBtn = document.getElementById("startBtn");
  const regenerateBtn = document.getElementById("regenerateBtn");
  const courtViewChoices = document.querySelectorAll('input[name="courtView"]');
  const active = Boolean(session);

  startBtn.disabled = active;
  startBtn.innerHTML = active
    ? '<span aria-hidden="true">🎯</span> Session in progress'
    : '<span aria-hidden="true">🏸</span> Start Session';
  regenerateBtn.disabled = !active;
  courtViewChoices.forEach((choice) => {
    choice.disabled = active;
  });
}

function selectedCourtView() {
  return document.querySelector('input[name="courtView"]:checked').value;
}

function setSelectedCourtView(courtView) {
  const choice = document.querySelector(`input[name="courtView"][value="${courtView}"]`);
  if (choice) choice.checked = true;
}

function showSession(session) {
  activeSession = session;
  renderSchedule(session);
  saveSession(session);
  updateNavControls(session);
}

/** Generate `gameCount` fresh match-ups into `session`, replacing anything there. */
function buildSchedule(session, gameCount) {
  session.gameCount = gameCount;
  session.schedule = generateSchedule(session.players, gameCount, DEFAULT_ATTEMPTS);
  session.matchStates = {};
  session.completedGameIndexes = [];
  session.initialComboOrder = null;
  session.expandedGameIndex = session.schedule.length ? 0 : null;
  renderedScores.clear();

  saveSession(session);
  showSession(session);

  setView("play");
  scrollToTop();
  haptic([10, 30, 10]);
  toast(
    session.schedule.length
      ? `${session.schedule.length} games ready · ${gamesPerPlayerLabel(session.players.length, session.schedule.length)}`
      : "Couldn't build a schedule for this line-up",
    session.schedule.length ? "🏸" : "⚠️"
  );
}

/**
 * Scheduling is a synchronous search that can take a moment, so paint a busy
 * state and yield a frame before starting.
 */
async function withBusyState(button, work) {
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span aria-hidden="true">⏳</span> Building…';
  document.getElementById("output").setAttribute("aria-busy", "true");

  await new Promise((resolve) => window.setTimeout(resolve, 40));

  try {
    work();
  } finally {
    button.innerHTML = originalHtml;
    button.disabled = false;
    document.getElementById("output").removeAttribute("aria-busy");
    // work() may have started or ended a session — let the real state win.
    updateNavControls(activeSession);
  }
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */

document.getElementById("demoBtn").addEventListener("click", async () => {
  const input = document.getElementById("playersInput");
  if (parsePlayers(input.value).length) {
    const ok = await confirmDialog({
      title: "Load the demo line-up?",
      message: "This replaces the names you've typed with six demo players.",
      confirmLabel: "Load demo",
      emoji: "✨",
    });
    if (!ok) return;
  }

  input.value = "Alex\nBella\nChris\nDev\nElla\nFinn";
  document.getElementById("errorText").textContent = "";
  updateLineUpMeta();
  toast("Demo line-up loaded", "✨");
});

document.getElementById("shuffleNamesBtn").addEventListener("click", () => {
  const input = document.getElementById("playersInput");
  const names = parsePlayers(input.value);
  if (names.length < 2) {
    toast("Add a couple of names first", "🤔");
    return;
  }

  for (let index = names.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [names[index], names[swapIndex]] = [names[swapIndex], names[index]];
  }

  input.value = names.join("\n");
  haptic(8);
  updateLineUpMeta();
  toast("Order shuffled", "🔀");
});

document.getElementById("startBtn").addEventListener("click", async () => {
  const startBtn = document.getElementById("startBtn");
  const errorText = document.getElementById("errorText");
  errorText.textContent = "";

  const players = parsePlayers(document.getElementById("playersInput").value);
  const validationError = validatePlayers(players);
  if (validationError) {
    errorText.textContent = validationError;
    haptic([16, 40, 16]);
    document.getElementById("playersInput").focus();
    return;
  }

  const gameCount = selectedGameCount();
  saveInputs(document.getElementById("playersInput").value, gameCount);
  rememberKnownPlayers(players);
  renderKnownPlayerChips();

  const session = newSession(players, gameCount, selectedCourtView());
  await withBusyState(startBtn, () => buildSchedule(session, gameCount));
});

document.getElementById("playersInput").addEventListener("input", () => {
  updateLineUpMeta();
  const errorText = document.getElementById("errorText");
  if (errorText.textContent) errorText.textContent = "";
});

document.getElementById("gameCountInput").addEventListener("input", updateLineUpMeta);
document.getElementById("gameCountInput").addEventListener("change", () => {
  setGameCount(selectedGameCount());
  saveInputs(document.getElementById("playersInput").value, selectedGameCount());
});

document.getElementById("gamesMinus").addEventListener("click", () => {
  haptic(5);
  setGameCount(selectedGameCount() - 1);
  saveInputs(document.getElementById("playersInput").value, selectedGameCount());
});

document.getElementById("gamesPlus").addEventListener("click", () => {
  haptic(5);
  setGameCount(selectedGameCount() + 1);
  saveInputs(document.getElementById("playersInput").value, selectedGameCount());
});

document.getElementById("knownPlayersChips").addEventListener("click", (event) => {
  const removeBtn = event.target.closest(".chip-remove");
  if (removeBtn) {
    forgetKnownPlayer(removeBtn.dataset.name);
    renderKnownPlayerChips();
    toast(`Forgot ${removeBtn.dataset.name}`, "🗑️", 1800);
    return;
  }

  const addBtn = event.target.closest(".chip-add");
  if (!addBtn) return;

  const input = document.getElementById("playersInput");
  const existing = parsePlayers(input.value);
  const name = addBtn.dataset.name;

  // Tapping a chip toggles that player in and out of tonight's line-up.
  input.value = existing.includes(name)
    ? existing.filter((p) => p !== name).join("\n")
    : `${existing.concat(name).join("\n")}\n`;

  haptic(6);
  updateLineUpMeta();
});

document.getElementById("resetSeasonBtn").addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Reset everything?",
    message: "The schedule, tonight's names, and every score are cleared. Saved player names are kept.",
    confirmLabel: "Reset session",
    emoji: "🗑️",
    danger: true,
  });
  if (!ok) return;

  clearSession();
  activeSession = null;
  renderedScores.clear();
  localStorage.removeItem(INPUTS_STORAGE_KEY);

  document.getElementById("playersInput").value = "";
  setGameCount(DEFAULT_GAME_COUNT);
  document.getElementById("output").innerHTML = renderEmptyState();

  const resetCurrentSetBtn = document.getElementById("resetCurrentSetBtn");
  resetCurrentSetBtn.disabled = true;
  resetCurrentSetBtn.onclick = null;
  document.getElementById("regenerateBtn").onclick = null;

  updateNavControls(null);
  updateProgress(null);
  updateLineUpMeta();
  document.getElementById("errorText").textContent = "";
  document.getElementById("metaText").textContent = "Add player names, then tap Start Session.";
  setView("setup");
  document.getElementById("playersInput").focus();
  toast("Session reset", "🗑️");
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (document.body.dataset.view === tab.dataset.view) {
      scrollToTop();
      return;
    }
    haptic(5);
    setView(tab.dataset.view);
    scrollToTop();
  });
});

window.addEventListener("DOMContentLoaded", () => {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(storedTheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

  document.getElementById("themeToggle").addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
    haptic(6);
  });

  // Sets were replaced by a plain game count; drop any state from that schema.
  localStorage.removeItem(LEGACY_SEASON_KEY);

  const savedInputs = loadInputs();
  if (savedInputs) {
    document.getElementById("playersInput").value = savedInputs.playersRaw || "";
    if (savedInputs.gameCount) setGameCount(savedInputs.gameCount);
  }

  renderKnownPlayerChips();
  updateLineUpMeta();

  const players = parsePlayers(document.getElementById("playersInput").value);
  const session = players.length ? loadSession(players) : null;

  if (session) {
    setSelectedCourtView(session.courtView || "end");
    if (session.gameCount) setGameCount(session.gameCount);
    showSession(session);
    if (isCompactLayout()) setView("play");
  } else {
    activeSession = null;
    document.getElementById("output").innerHTML = renderEmptyState();
    updateNavControls(null);
    updateProgress(null);
  }
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline support is optional */
    });
  });
}
