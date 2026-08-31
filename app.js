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
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function playersKey(players) {
  return [...players].sort().join("|");
}

function newSession(players, courtView = "end") {
  return {
    key: playersKey(players),
    players,
    courtView,
    schedule: [],
    matchStates: {},
    completedGameIndexes: [],
    expandedGameIndex: null,
    initialComboOrder: null,
    setsCount: 1,
    setBreaks: [0],
    courtPrice: 0,
    sessionEndedAt: null,
    splitEnabled: false,
    defaultTargetScore: 11,
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
    if (!state.setsCount) state.setsCount = 1;
    if (!Array.isArray(state.setBreaks)) state.setBreaks = [0];
    if (!state.courtPrice) state.courtPrice = 0;
    if (state.sessionEndedAt === undefined) state.sessionEndedAt = null;
    if (state.splitEnabled === undefined) state.splitEnabled = false;
    if (!state.defaultTargetScore) state.defaultTargetScore = 11;
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

function saveInputs(playersRaw) {
  localStorage.setItem(INPUTS_STORAGE_KEY, JSON.stringify({ playersRaw }));
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

/** Fewest games a full partnership cover can ever take: each game locks in 2 pairs. */
function estimateGameCount(playerCount) {
  if (playerCount < 4) return 0;
  const totalPairs = (playerCount * (playerCount - 1)) / 2;
  return Math.ceil(totalPairs / 2);
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

  const preview = document.getElementById("gamesPreview");
  if (count < 4) {
    preview.textContent = "Add at least 4 players to see how many games it'll take.";
  } else {
    const estimate = estimateGameCount(count);
    preview.textContent = `~${estimate} games so everyone partners with everyone once (${gamesPerPlayerLabel(count, estimate)}).`;
  }

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

/**
 * Build however many games it takes for every pair of players to partner at
 * least once — the game count is never chosen by the user, it falls out of
 * the group size. For `n` players there are n*(n-1)/2 possible partnerships
 * and each game locks in exactly 2 of them, so n*(n-1)/4 games is the
 * theoretical floor; the search below tries to land exactly on it.
 *
 * Each game is chosen greedily from every possible foursome-and-pairing,
 * scored as follows (lower is better):
 *
 *   - 3000                                    per brand-new pair in the team → finish the cover fast
 *   + 100 x (ideal - gamesAfterThisMatch)^2   per player  → even game counts
 *   + 900                                     per player resting again  → spread rests
 *   + 120 x timesAlreadyPaired                per team    → fresh partnerships
 *   -  80                                     per brand-new pair
 *   + random x 20                                         → variety
 *
 * The ten lowest-scoring candidates are kept and one is picked at random. The
 * whole thing is retried many times, keeping whichever attempt covers every
 * partnership with the fewest repeats, then the fewest games, then the best
 * game-count balance.
 *
 * The scoring is inlined over typed arrays with precomputed pair keys: the
 * straightforward version allocated a Set and two sorted key strings per
 * candidate per game per attempt, which froze the page for tens of seconds.
 */
function generateSchedule(players, attempts = DEFAULT_ATTEMPTS) {
  const playerCount = players.length;
  if (playerCount < 4) return [];

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

  const totalPairs = (playerCount * (playerCount - 1)) / 2;
  // Every game locks in at least one new pair or the attempt is abandoned below,
  // so no attempt can ever run longer than totalPairs games.
  const maxGames = totalPairs;

  const runs = Math.min(
    attempts,
    Math.max(MIN_ATTEMPTS, Math.floor(WORK_BUDGET / (configCount * Math.max(totalPairs / 2, 1))))
  );

  const TOP = 10;
  const playerGames = new Int32Array(playerCount);
  const restStreak = new Int32Array(playerCount);
  const topScores = new Float64Array(TOP);
  const topConfigs = new Int32Array(TOP);

  let best = null;
  let bestKey = Infinity;

  for (let run = 0; run < runs; run += 1) {
    const schedule = [];
    const partnerCount = new Map();
    let coveredPairs = 0;
    playerGames.fill(0);
    restStreak.fill(0);

    while (coveredPairs < totalPairs && schedule.length < maxGames) {
      // Balance target drifts upward as the schedule grows, since the final
      // length isn't known ahead of time.
      const idealGames = ((schedule.length + 1) * 4) / playerCount;
      const gamesCeiling = Math.ceil(idealGames);

      let baseSquares = 0;
      let baseRest = 0;
      for (let i = 0; i < playerCount; i += 1) {
        const delta = idealGames - playerGames[i];
        baseSquares += delta * delta;
        if (restStreak[i] > 0) baseRest += 900;
      }

      let topCount = 0;

      /* Partnership freshness is a hard filter, not just a scoring nudge: a
         repeat pairing is only ever considered once every option with more
         fresh pairs is exhausted, and a pair is never pushed to a third
         meeting while any pair still has room under a second. Ceiling works
         the same way underneath that — try the strict cap first, then relax
         it. Eight passes, tried in order until one yields candidates:
           0: both pairs fresh, respecting the ceiling
           1: both pairs fresh, ceiling relaxed
           2: at least one fresh pair, respecting the ceiling
           3: at least one fresh pair, ceiling relaxed
           4: neither pair repeated more than once yet, respecting the ceiling
           5: neither pair repeated more than once yet, ceiling relaxed
           6: any pairing, respecting the ceiling    (3rd+ meetings allowed)
           7: any pairing, ceiling relaxed           (3rd+ meetings allowed) */
      const passConfigs = [
        { minFresh: 2, maxCount: Infinity, useCeiling: true },
        { minFresh: 2, maxCount: Infinity, useCeiling: false },
        { minFresh: 1, maxCount: Infinity, useCeiling: true },
        { minFresh: 1, maxCount: Infinity, useCeiling: false },
        { minFresh: 0, maxCount: 1, useCeiling: true },
        { minFresh: 0, maxCount: 1, useCeiling: false },
        { minFresh: 0, maxCount: Infinity, useCeiling: true },
        { minFresh: 0, maxCount: Infinity, useCeiling: false },
      ];

      for (let pass = 0; pass < passConfigs.length && topCount === 0; pass += 1) {
        const { minFresh, maxCount, useCeiling } = passConfigs[pass];
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

          const keys = configPairKeys[c];
          const count0 = partnerCount.get(keys[0]) || 0;
          const count1 = partnerCount.get(keys[1]) || 0;
          const freshPairs = (count0 === 0 ? 1 : 0) + (count1 === 0 ? 1 : 0);

          if (freshPairs < minFresh || count0 > maxCount || count1 > maxCount) continue;

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

          score += count0 * 120 + (count0 === 0 ? -80 : 0);
          score += count1 * 120 + (count1 === 0 ? -80 : 0);
          // Covering brand-new pairs outranks everything else so the schedule
          // finishes as close to the theoretical floor as possible.
          score -= freshPairs * 3000;

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
      if (!partnerCount.has(keys[0])) coveredPairs += 1;
      if (!partnerCount.has(keys[1])) coveredPairs += 1;
      partnerCount.set(keys[0], (partnerCount.get(keys[0]) || 0) + 1);
      partnerCount.set(keys[1], (partnerCount.get(keys[1]) || 0) + 1);
    }

    if (coveredPairs < totalPairs) continue;

    let minGames = Infinity;
    let maxGames2 = -Infinity;
    for (let i = 0; i < playerCount; i += 1) {
      if (playerGames[i] < minGames) minGames = playerGames[i];
      if (playerGames[i] > maxGames2) maxGames2 = playerGames[i];
    }

    let repeated = 0;
    for (const count of partnerCount.values()) {
      repeated += Math.max(0, count - 1);
    }

    // Fewest repeats wins outright, then fewest games, then the tightest game-count spread.
    const key = repeated * 1e8 + schedule.length * 1e4 + (maxGames2 - minGames);
    if (key < bestKey) {
      bestKey = key;
      best = schedule;
    }
  }

  return best || [];
}

/** Generate one additional set of games, using existing pair counts as a prior.
 *  Pairs already played together get a scoring penalty so the new set
 *  spreads partnerships as evenly as possible across the whole session.
 *  Coverage tracking is per-set only; the pass / ceiling logic mirrors
 *  generateSchedule exactly.
 */
// priorPlayerGames: Map<playerName, gamesPlayedSoFar> from all previous sets.
function generateAdditionalSet(players, priorCounts, priorPlayerGames, attempts = DEFAULT_ATTEMPTS) {
  const playerCount = players.length;
  if (playerCount < 4) return [];

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

  const totalPairs = (playerCount * (playerCount - 1)) / 2;
  const maxGames = totalPairs;

  const runs = Math.min(
    attempts,
    Math.max(MIN_ATTEMPTS, Math.floor(WORK_BUDGET / (configCount * Math.max(totalPairs / 2, 1))))
  );

  // Pre-build prior game counts as a typed array for fast reset each run.
  const priorGames = new Int32Array(playerCount);
  for (const [name, count] of priorPlayerGames) {
    const i = playerIndex.get(name);
    if (i !== undefined) priorGames[i] = count;
  }
  // Total player-slots already used = 4 × number of prior games.
  const priorGameSlots = priorGames.reduce((a, b) => a + b, 0);

  const TOP = 10;
  const playerGames = new Int32Array(playerCount);
  const restStreak = new Int32Array(playerCount);
  const topScores = new Float64Array(TOP);
  const topConfigs = new Int32Array(TOP);

  const passConfigs = [
    { minFresh: 2, maxCount: Infinity, useCeiling: true },
    { minFresh: 2, maxCount: Infinity, useCeiling: false },
    { minFresh: 1, maxCount: Infinity, useCeiling: true },
    { minFresh: 1, maxCount: Infinity, useCeiling: false },
    { minFresh: 0, maxCount: 1, useCeiling: true },
    { minFresh: 0, maxCount: 1, useCeiling: false },
    { minFresh: 0, maxCount: Infinity, useCeiling: true },
    { minFresh: 0, maxCount: Infinity, useCeiling: false },
  ];

  let best = null;
  let bestKey = Infinity;

  for (let run = 0; run < runs; run += 1) {
    const schedule = [];
    // allCounts = prior + this-set counts; used for scoring to penalise repeats
    const allCounts = new Map(priorCounts);
    // setCounts tracks what has been paired within THIS set (freshness + coverage)
    const setCounts = new Map();
    let coveredThisSet = 0;
    // Seed with prior totals so balance is enforced across all sets, not just within one.
    for (let i = 0; i < playerCount; i += 1) playerGames[i] = priorGames[i];
    restStreak.fill(0);

    while (coveredThisSet < totalPairs && schedule.length < maxGames) {
      // Global ideal: total player-slots (prior + this set so far + this game) / players.
      const idealGames = (priorGameSlots + (schedule.length + 1) * 4) / playerCount;
      const gamesCeiling = Math.ceil(idealGames);

      let baseSquares = 0;
      let baseRest = 0;
      for (let i = 0; i < playerCount; i += 1) {
        const delta = idealGames - playerGames[i];
        baseSquares += delta * delta;
        if (restStreak[i] > 0) baseRest += 900;
      }

      let topCount = 0;

      for (let pass = 0; pass < passConfigs.length && topCount === 0; pass += 1) {
        const { minFresh, maxCount, useCeiling } = passConfigs[pass];
        let worstTop = Infinity;

        for (let c = 0; c < configCount; c += 1) {
          const o = c * 4;
          const p0 = configPlayers[o];
          const p1 = configPlayers[o + 1];
          const p2 = configPlayers[o + 2];
          const p3 = configPlayers[o + 3];

          if (useCeiling && (
            playerGames[p0] >= gamesCeiling ||
            playerGames[p1] >= gamesCeiling ||
            playerGames[p2] >= gamesCeiling ||
            playerGames[p3] >= gamesCeiling
          )) continue;

          const keys = configPairKeys[c];
          // "fresh" = not yet seen in this set
          const sc0 = setCounts.get(keys[0]) || 0;
          const sc1 = setCounts.get(keys[1]) || 0;
          const freshPairs = (sc0 === 0 ? 1 : 0) + (sc1 === 0 ? 1 : 0);

          if (freshPairs < minFresh || sc0 > maxCount || sc1 > maxCount) continue;

          const squares = baseSquares
            + 1 - 2 * (idealGames - playerGames[p0])
            + 1 - 2 * (idealGames - playerGames[p1])
            + 1 - 2 * (idealGames - playerGames[p2])
            + 1 - 2 * (idealGames - playerGames[p3]);

          let rest = baseRest;
          if (restStreak[p0] > 0) rest -= 900;
          if (restStreak[p1] > 0) rest -= 900;
          if (restStreak[p2] > 0) rest -= 900;
          if (restStreak[p3] > 0) rest -= 900;

          let score = squares * 100 + rest;

          // Penalise pairs with a high session-total count (includes prior sets)
          const ac0 = allCounts.get(keys[0]) || 0;
          const ac1 = allCounts.get(keys[1]) || 0;
          score += ac0 * 120 + (sc0 === 0 ? -80 : 0);
          score += ac1 * 120 + (sc1 === 0 ? -80 : 0);
          score -= freshPairs * 3000;
          score += Math.random() * 20;

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
      if (!setCounts.has(keys[0])) coveredThisSet += 1;
      if (!setCounts.has(keys[1])) coveredThisSet += 1;
      setCounts.set(keys[0], (setCounts.get(keys[0]) || 0) + 1);
      setCounts.set(keys[1], (setCounts.get(keys[1]) || 0) + 1);
      allCounts.set(keys[0], (allCounts.get(keys[0]) || 0) + 1);
      allCounts.set(keys[1], (allCounts.get(keys[1]) || 0) + 1);
    }

    if (coveredThisSet < totalPairs) continue;

    let minG = Infinity;
    let maxG = -Infinity;
    for (let i = 0; i < playerCount; i += 1) {
      if (playerGames[i] < minG) minG = playerGames[i];
      if (playerGames[i] > maxG) maxG = playerGames[i];
    }

    let repeated = 0;
    for (const count of setCounts.values()) {
      repeated += Math.max(0, count - 1);
    }

    const key = repeated * 1e8 + schedule.length * 1e4 + (maxG - minG);
    if (key < bestKey) {
      bestKey = key;
      best = schedule;
    }
  }

  return best || [];
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
    courtFlipped: false,
    topPositions: { left: topTeam[0], right: topTeam[1] },
    bottomPositions: { left: bottomTeam[0], right: bottomTeam[1] },
    undoStack: [],
    finished: false,
    startedAt: null,
    finishedAt: null,
  };
}

/** Formats a millisecond duration as "M:SS" (or "H:MM:SS" past an hour). */
function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Elapsed time for a match: running total while live, frozen once finished. */
function matchElapsedMs(state) {
  if (!state.startedAt) return 0;
  const end = state.finishedAt || Date.now();
  return Math.max(0, end - state.startedAt);
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
    startedAt: state.startedAt,
  });

  // The clock starts the instant either team gets on the board, and runs
  // continuously — including while the card is collapsed — until Finish.
  if (!state.startedAt) state.startedAt = Date.now();

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

/** True while a match's clock should be actively ticking (started, not finished). */
function matchTimerRunning(state) {
  return Boolean(state.startedAt) && !state.finished;
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

/** Earliest startedAt across all match states — the moment the session clock began. */
function getSessionStartedAt(session) {
  let earliest = null;
  for (const state of Object.values(session.matchStates || {})) {
    if (state.startedAt && (earliest === null || state.startedAt < earliest)) {
      earliest = state.startedAt;
    }
  }
  return earliest;
}

/**
 * Compute a cost split for the session.
 * Each player is billed in whole hours (min 1) proportional to games played.
 * Their share = (billed_hours / total_billed_hours) × court_price.
 */
function computeSplit(session) {
  const startedAt = getSessionStartedAt(session);
  if (!startedAt) return null;

  const endedAt = session.sessionEndedAt || Date.now();
  const sessionHours = Math.max(1 / 60, (endedAt - startedAt) / 3600000);

  const completedSet = new Set(session.completedGameIndexes);
  const playerGameCounts = new Map(session.players.map((p) => [p, 0]));

  for (const idx of completedSet) {
    const game = session.schedule[idx];
    if (!game) continue;
    for (const p of [...game[0], ...game[1]]) {
      playerGameCounts.set(p, (playerGameCounts.get(p) || 0) + 1);
    }
  }

  const totalCompletedGames = completedSet.size;
  const gamesPerHour = sessionHours > 0 ? totalCompletedGames / sessionHours : 0;

  const billedHours = new Map();
  for (const [player, games] of playerGameCounts) {
    if (games === 0) {
      billedHours.set(player, 0);
    } else if (gamesPerHour <= 0) {
      billedHours.set(player, 1);
    } else {
      billedHours.set(player, Math.max(1, Math.ceil(games / gamesPerHour)));
    }
  }

  const totalBilledHours = [...billedHours.values()].reduce((a, b) => a + b, 0);
  const courtPrice = session.courtPrice || 0;

  const splits = session.players
    .map((player) => {
      const games = playerGameCounts.get(player) || 0;
      const hours = billedHours.get(player) || 0;
      const share = totalBilledHours > 0 && hours > 0 ? (hours / totalBilledHours) * courtPrice : 0;
      return { player, games, hours, share };
    })
    .filter((s) => s.games > 0);

  return { startedAt, endedAt, sessionHours, totalCompletedGames, gamesPerHour, totalBilledHours, courtPrice, splits };
}

function renderSplitSummaryHtml(split) {
  if (!split || !split.splits.length) return "";

  const hasCost = split.courtPrice > 0;
  const startStr = new Date(split.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const endStr = new Date(split.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const duration = formatElapsed(split.endedAt - split.startedAt);

  const rows = split.splits
    .map(
      ({ player, games, hours, share }) => `
      <tr>
        <td>${escapeHtml(player)}</td>
        <td>${games}</td>
        <td>${hours} hr${hours !== 1 ? "s" : ""}</td>
        ${hasCost ? `<td class="split-amount">\u20b9${Math.round(share)}</td>` : ""}
      </tr>`
    )
    .join("");

  return `
    <div class="split-summary">
      <div class="split-summary-head">
        <h3 class="split-title"><span aria-hidden="true">\u{1F4B0}</span> Cost Split</h3>
        <button type="button" class="ghost mini split-share-btn" aria-label="Share cost split"><span aria-hidden="true">\u{1F4E4}</span> Share</button>
      </div>
      <div class="split-meta">
        <span>\u{1F558} ${escapeHtml(startStr)} \u2013 ${escapeHtml(endStr)}</span>
        <span>\u23F1\uFE0F ${escapeHtml(duration)}</span>
        <span>\u{1F3F8} ${split.totalCompletedGames} game${split.totalCompletedGames !== 1 ? "s" : ""}</span>
      </div>
      <table class="stat-table split-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Games</th>
            <th>Hours</th>
            ${hasCost ? "<th>Share</th>" : ""}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${hasCost ? `<p class="split-total-row"><span>Total court cost</span><strong>\u20b9${split.courtPrice}</strong></p>` : ""}
    </div>
  `;
}

/** Tallies games-played and partner counts for a built schedule. */
function computeScheduleStats(schedule, players, matchStates = {}, completedSet = new Set()) {
  const playerGames = new Map(players.map((p) => [p, 0]));
  const playerWins  = new Map(players.map((p) => [p, 0]));
  const playerLosses = new Map(players.map((p) => [p, 0]));
  const partnerCount = new Map();

  for (let idx = 0; idx < schedule.length; idx++) {
    const [team1, team2] = schedule[idx];
    for (const p of [...team1, ...team2]) {
      playerGames.set(p, (playerGames.get(p) || 0) + 1);
    }
    partnerCount.set(pairKey(team1), (partnerCount.get(pairKey(team1)) || 0) + 1);
    partnerCount.set(pairKey(team2), (partnerCount.get(pairKey(team2)) || 0) + 1);

    if (completedSet.has(idx) && matchStates[idx]?.finished) {
      const state = matchStates[idx];
      const winners = state.topScore > state.bottomScore ? team1 : team2;
      const losers  = state.topScore > state.bottomScore ? team2 : team1;
      for (const p of winners) playerWins.set(p,   (playerWins.get(p)   || 0) + 1);
      for (const p of losers)  playerLosses.set(p, (playerLosses.get(p) || 0) + 1);
    }
  }

  return { playerGames, playerWins, playerLosses, partnerCount };
}

/** Bigger, more legible cells for small groups; shrinks gracefully as the group grows. */
function matrixSizing(playerCount) {
  const tiers = [
    { max: 6, cell: 50, header: 116, headerFont: 13, row: 90, font: 14 },
    { max: 8, cell: 44, header: 104, headerFont: 12.5, row: 82, font: 13 },
    { max: 10, cell: 39, header: 94, headerFont: 12, row: 76, font: 12.5 },
    { max: 14, cell: 34, header: 86, headerFont: 11.5, row: 70, font: 12 },
    { max: 18, cell: 29, header: 78, headerFont: 11, row: 64, font: 11.5 },
    { max: Infinity, cell: 25, header: 70, headerFont: 10.5, row: 58, font: 11 },
  ];
  const tier = tiers.find((t) => playerCount <= t.max);

  const compact = window.matchMedia("(max-width: 560px)").matches;
  const scale = compact ? 0.86 : 1;

  return {
    cell: Math.round(tier.cell * scale),
    header: Math.round(tier.header * scale),
    headerFont: (tier.headerFont * scale).toFixed(1),
    row: Math.round(tier.row * scale),
    font: (tier.font * scale).toFixed(1),
  };
}

/** Player x player heatmap: how many games each pair has partnered together. */
function partnershipMatrixHtml(players, partnerCount) {
  const sizing = matrixSizing(players.length);
  const frameStyle = `--matrix-cell:${sizing.cell}px; --matrix-header:${sizing.header}px; `
    + `--matrix-header-font:${sizing.headerFont}px; --matrix-row:${sizing.row}px; `
    + `--matrix-font:${sizing.font}px;`;

  const header = players
    .map((p) => `<th scope="col"><span title="${escapeHtml(p)}">${escapeHtml(p)}</span></th>`)
    .join("");

  const body = players
    .map((rowPlayer) => {
      const cells = players
        .map((colPlayer) => {
          if (colPlayer === rowPlayer) return `<td class="matrix-cell matrix-self">·</td>`;

          const count = partnerCount.get(pairKey([rowPlayer, colPlayer])) || 0;
          const bucket = count >= 3 ? 3 : count;
          const label = count > 0
            ? `${rowPlayer} + ${colPlayer}: ${count} game${count === 1 ? "" : "s"} · tap to view`
            : `${rowPlayer} + ${colPlayer}: never partnered yet`;
          return `<td class="matrix-cell${count > 0 ? " matrix-clickable" : ""}" data-count="${bucket}" data-row="${escapeHtml(rowPlayer)}" data-col="${escapeHtml(colPlayer)}" title="${escapeHtml(label)}">${count || ""}</td>`;
        })
        .join("");

      return `<tr><th scope="row" title="${escapeHtml(rowPlayer)}">${escapeHtml(rowPlayer)}</th>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="matrix-frame" style="${frameStyle}">
      <div class="matrix-scroll">
        <table class="matrix-table">
          <thead><tr><th class="matrix-corner" aria-hidden="true"></th>${header}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="matrix-hint" aria-hidden="true">Swipe to see everyone <span>→</span></p>
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

  const { playerGames, playerWins, playerLosses, partnerCount } = computeScheduleStats(
    schedule, players, session.matchStates, completedGameIndexes
  );

  schedule.forEach(([team1, team2], idx) => {
    // Insert a visual divider at the start of every set after the first
    const setBreaks = session.setBreaks || [0];
    const setIdx = setBreaks.indexOf(idx);
    if (setIdx > 0) {
      const divider = document.createElement("div");
      divider.className = "set-divider";
      divider.innerHTML = `<span>Set ${setIdx + 1}</span>`;
      output.appendChild(divider);
    }

    const participants = new Set([...team1, ...team2]);
    const rest = players.filter((p) => !participants.has(p));

    let state = session.matchStates[idx];
    if (!state) {
      state = createMatchState(team1, team2, session.defaultTargetScore || 11);
      session.matchStates[idx] = state;
    }
    initializeMatchState(state, team1, team2, idx, session);

    const isDone = completedGameIndexes.has(idx);
    const expanded = session.expandedGameIndex === idx;
    const status = statusPillFor(state, isDone);
    const started = state.topScore > 0 || state.bottomScore > 0;
    const leader = state.topScore === state.bottomScore ? "" : state.topScore > state.bottomScore ? "top" : "bottom";
    const timerRunning = matchTimerRunning(state);
    const timerHtml = state.startedAt
      ? `<span class="timer-pill${timerRunning ? " is-running" : ""}" data-timer${timerRunning ? ` data-start="${state.startedAt}"` : ""}>
           <span class="timer-pill-icon" aria-hidden="true">⏱️</span><span class="timer-pill-value">${escapeHtml(formatElapsed(matchElapsedMs(state)))}</span>
         </span>`
      : "";

    const card = document.createElement("article");
    card.className = `game${isDone ? " done" : ""}${expanded ? " expanded" : ""}`;
    card.innerHTML = `
      <button type="button" class="game-summary" aria-expanded="${expanded}">
        <span class="game-top">
          <span class="game-badge"><span aria-hidden="true">🏸</span> Game ${idx + 1}</span>
          ${timerHtml}
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
      let primaryTeam = servingStartsPrimary ? courtServingTeam : alternateTeam;
      let secondaryTeam = primaryTeam === "top" ? "bottom" : "top";
      if (match.courtFlipped) { [primaryTeam, secondaryTeam] = [secondaryTeam, primaryTeam]; }
      const primaryPositions = primaryTeam === "top" ? match.topPositions : match.bottomPositions;
      const secondaryPositions = secondaryTeam === "top" ? match.topPositions : match.bottomPositions;
      // In back-view a 180° flip also mirrors left↔right; side-view CSS nth-child reordering already handles it
      const flipPos = (pos) => ({ left: pos.right, right: pos.left });
      const needsMirror = match.courtFlipped && courtView !== "side";
      const displayPrimaryPositions = needsMirror ? flipPos(primaryPositions) : primaryPositions;
      const displaySecondaryPositions = needsMirror ? flipPos(secondaryPositions) : secondaryPositions;
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
        <div class="court-rotate-row">
          <div class="match-time-field">
            <span>Match time</span>
            ${match.startedAt
              ? `<span class="timer-pill${timerRunning ? " is-running" : ""}" data-timer${timerRunning ? ` data-start="${match.startedAt}"` : ""}><span class="timer-pill-icon" aria-hidden="true">⏱️</span><span class="timer-pill-value">${escapeHtml(formatElapsed(matchElapsedMs(match)))}</span></span>`
              : `<span class="match-time-empty">Starts on first point</span>`}
          </div>
          <button type="button" class="ghost mini court-rotate-btn" ${started ? "disabled" : ""} title="Swap which team appears at each end of the court">
            <span aria-hidden="true">${match.courtFlipped ? "🔄" : "↕️"}</span> Rotate Court
          </button>
        </div>
        <div class="court ${courtView === "side" ? "court-side-view" : "court-end-view"}">
          ${courtSideHtml(primaryLabel, displayPrimaryPositions, match)}
          <div class="net" aria-hidden="true"><span>NET</span></div>
          ${courtSideHtml(secondaryLabel, displaySecondaryPositions, match)}
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

      scorer.querySelector(".court-rotate-btn").addEventListener("click", () => {
        haptic(8);
        update((active) => { active.courtFlipped = !active.courtFlipped; });
      });

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
          current.finishedAt = Date.now();
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
      const games  = playerGames.get(p)  || 0;
      const wins   = playerWins.get(p)   || 0;
      const losses = playerLosses.get(p) || 0;
      const wl = wins + losses > 0 ? `${wins}W · ${losses}L` : "—";
      return `<tr><td>${escapeHtml(p)}</td><td>${games}</td><td>${schedule.length - games}</td><td class="wl-cell">${wl}</td></tr>`;
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
        <thead><tr><th>Player</th><th>Games</th><th>Rest</th><th>W / L</th></tr></thead>
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

  // Compute once — used by both the split panel and the timer bar below
  const sessionStartedAt = getSessionStartedAt(session);

  // Sync the static split panel
  const splitPanel = document.getElementById("splitPanel");
  const splitToggleEl = document.getElementById("splitToggle");
  const splitBodyEl = document.getElementById("splitBody");
  const splitPriceEl = document.getElementById("splitPriceInput");
  const splitActionsEl = document.getElementById("splitActions");

  if (splitPanel) {
    splitPanel.hidden = false;
    if (splitToggleEl) splitToggleEl.checked = Boolean(session.splitEnabled);
    if (splitBodyEl) splitBodyEl.hidden = !session.splitEnabled;

    if (session.splitEnabled && splitPriceEl && document.activeElement !== splitPriceEl) {
      splitPriceEl.value = session.courtPrice || "";
    }

    if (session.splitEnabled && splitActionsEl) {
      const isEnded = Boolean(session.sessionEndedAt);
      if (sessionStartedAt || isEnded) {
        splitActionsEl.innerHTML = `
          <button type="button" class="end-session-btn${isEnded ? " is-ended" : ""}" ${isEnded ? "disabled" : ""}>
            <span aria-hidden="true">${isEnded ? "🔒" : "🏁"}</span>
            ${isEnded ? "Session Ended" : "End Today's Session"}
          </button>
          ${isEnded ? renderSplitSummaryHtml(computeSplit(session)) : ""}
        `;
      } else {
        splitActionsEl.innerHTML = `<p class="split-hint">Score a point first to enable session end.</p>`;
      }
    } else if (splitActionsEl) {
      splitActionsEl.innerHTML = "";
    }
  }

  // Sync the session timer bar visibility + running state
  const timerBar = document.getElementById("sessionTimerBar");
  const timerValueEl = document.getElementById("sessionTimerValue");
  if (timerBar && timerValueEl) {
    if (sessionStartedAt) {
      const ended = session.sessionEndedAt;
      timerBar.hidden = false;
      timerBar.classList.toggle("is-ended", Boolean(ended));
      timerValueEl.textContent = formatElapsed((ended || Date.now()) - sessionStartedAt);
      if (ended) {
        timerValueEl.removeAttribute("data-session-start");
      } else {
        timerValueEl.setAttribute("data-session-start", String(sessionStartedAt));
      }
    } else {
      timerBar.hidden = true;
      timerValueEl.removeAttribute("data-session-start");
    }
  }

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
    if (playedCount > 0) {
      const ok = await confirmDialog({
        title: "Build a new schedule?",
        message: `${playedCount} finished game${playedCount === 1 ? "" : "s"} will be discarded and a fresh set of match-ups generated.`,
        confirmLabel: "Regenerate",
        emoji: "🎲",
        danger: true,
      });
      if (!ok) return;
    }
    await withBusyState(regenerateBtn, () => buildSchedule(session));
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
  const setsBar = document.getElementById("setsBar");
  const decSetsBtn = document.getElementById("decSetsBtn");
  const incSetsBtn = document.getElementById("incSetsBtn");
  const setsCountLabel = document.getElementById("setsCountLabel");
  const active = Boolean(session);

  startBtn.disabled = active;
  startBtn.innerHTML = active
    ? '<span aria-hidden="true">🎯</span> Session in progress'
    : '<span aria-hidden="true">🏸</span> Start Session';
  regenerateBtn.disabled = !active;
  courtViewChoices.forEach((choice) => {
    choice.disabled = active;
  });
  document.querySelectorAll('input[name="gameTarget"]').forEach((choice) => {
    choice.disabled = active;
  });

  // Names are locked in once a session starts — editing them wouldn't match the schedule below.
  document.getElementById("playersInput").disabled = active;
  document.getElementById("demoBtn").disabled = active;
  document.getElementById("shuffleNamesBtn").disabled = active;
  document.getElementById("knownPlayersChips").classList.toggle("is-disabled", active);

  if (!setsBar) return;
  setsBar.hidden = !active;

  if (active && session) {
    const count = session.setsCount || 1;
    setsCountLabel.textContent = count === 1 ? "1 Set" : `${count} Sets`;

    const lastStart = session.setBreaks ? session.setBreaks[session.setBreaks.length - 1] : 0;
    const anyPlayedInLast = (session.completedGameIndexes || []).some((i) => i >= lastStart);
    decSetsBtn.disabled = count <= 1 || anyPlayedInLast;

    decSetsBtn.onclick = () => {
      if (!activeSession) return;
      const ok = removeLastSet(activeSession);
      if (ok) {
        haptic(6);
        saveSession(activeSession);
        showSession(activeSession);
        toast("Last set removed", "↺");
      } else {
        toast("Can't remove — games already played", "⚠️", 2000);
      }
    };

    incSetsBtn.onclick = () => {
      if (!activeSession) return;
      withBusyState(incSetsBtn, () => addSet(activeSession));
    };
  }
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
  renderPartnershipMapPanel(session);
  saveSession(session);
  updateNavControls(session);
}

/** First game where `a` and `b` are on the same team, preferring an unplayed one. */
function findMatchIndexForPair(session, a, b) {
  const completed = new Set(session.completedGameIndexes);
  let firstAny = -1;

  for (let i = 0; i < session.schedule.length; i += 1) {
    const [team1, team2] = session.schedule[i];
    const together = (team1.includes(a) && team1.includes(b)) || (team2.includes(a) && team2.includes(b));
    if (!together) continue;

    if (firstAny === -1) firstAny = i;
    if (!completed.has(i)) return i;
  }

  return firstAny;
}

/** Renders the read-only partnership heatmap into the Line-up tab. */
function renderPartnershipMapPanel(session) {
  const panel = document.getElementById("partnershipMapPanel");
  const mount = document.getElementById("partnershipMapMount");
  const preview = document.getElementById("gamesPreview");

  if (!session || !session.schedule.length) {
    panel.hidden = true;
    mount.innerHTML = "";
    if (preview) preview.hidden = false;
    return;
  }

  if (preview) preview.hidden = true;
  panel.hidden = false;
  const { partnerCount } = computeScheduleStats(session.schedule, session.players);
  mount.innerHTML = partnershipMatrixHtml(session.players, partnerCount);
}

document.getElementById("partnershipMapMount").addEventListener("click", (event) => {
  const cell = event.target.closest(".matrix-clickable");
  if (!cell || !activeSession) return;

  const idx = findMatchIndexForPair(activeSession, cell.dataset.row, cell.dataset.col);
  if (idx < 0) return;

  haptic(6);
  activeSession.expandedGameIndex = idx;
  saveSession(activeSession);
  setView("play");
  showSession(activeSession);
  scrollToExpandedGame();
});

/** Append one more full-coverage set to the existing session schedule. */
function addSet(session) {
  const { partnerCount, playerGames: priorPlayerGames } = computeScheduleStats(session.schedule, session.players);
  const newGames = generateAdditionalSet(session.players, partnerCount, priorPlayerGames);
  if (!newGames.length) {
    toast("Couldn't generate another set", "⚠️");
    return;
  }
  const breakIdx = session.schedule.length;
  session.schedule = [...session.schedule, ...newGames];
  session.setsCount = (session.setsCount || 1) + 1;
  session.setBreaks = [...(session.setBreaks || [0]), breakIdx];
  saveSession(session);
  showSession(session);
  toast(`Set ${session.setsCount} added · ${newGames.length} more games`, "🏸");
}

/** Remove the last set if none of its games have been scored yet. */
function removeLastSet(session) {
  const count = session.setsCount || 1;
  if (count <= 1 || !session.setBreaks) return false;
  const lastStart = session.setBreaks[session.setBreaks.length - 1];
  const anyPlayed = (session.completedGameIndexes || []).some((i) => i >= lastStart);
  if (anyPlayed) return false;
  const totalBefore = session.schedule.length;
  for (let i = lastStart; i < totalBefore; i += 1) {
    delete session.matchStates[i];
  }
  session.schedule = session.schedule.slice(0, lastStart);
  session.setsCount = count - 1;
  session.setBreaks = session.setBreaks.slice(0, -1);
  if ((session.expandedGameIndex || 0) >= lastStart) session.expandedGameIndex = null;
  return true;
}

/** Generate a fresh full-partnership-coverage schedule into `session`. */
function buildSchedule(session) {
  session.schedule = generateSchedule(session.players, DEFAULT_ATTEMPTS);
  session.matchStates = {};
  session.completedGameIndexes = [];
  session.initialComboOrder = null;
  session.expandedGameIndex = session.schedule.length ? 0 : null;
  session.setsCount = 1;
  session.setBreaks = [0];
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
   Live game clocks
   -------------------------------------------------------------------------- */

// Ticks every second, nudging just the timer text — not a full re-render —
// so a game's clock keeps running whether its card is expanded or collapsed.
window.setInterval(() => {
  document.querySelectorAll(".timer-pill.is-running[data-start]").forEach((el) => {
    const start = Number(el.dataset.start);
    if (!start) return;
    const valueEl = el.querySelector(".timer-pill-value");
    if (valueEl) valueEl.textContent = formatElapsed(Date.now() - start);
  });

  // Session timer in the play panel header
  const sessionTimerEl = document.getElementById("sessionTimerValue");
  if (sessionTimerEl) {
    const start = Number(sessionTimerEl.getAttribute("data-session-start"));
    if (start) sessionTimerEl.textContent = formatElapsed(Date.now() - start);
  }
}, 1000);

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

  saveInputs(document.getElementById("playersInput").value);
  rememberKnownPlayers(players);
  renderKnownPlayerChips();

  const session = newSession(players, selectedCourtView());
  session.defaultTargetScore = Number(document.querySelector('input[name="gameTarget"]:checked')?.value) || 11;
  await withBusyState(startBtn, () => buildSchedule(session));
});

document.getElementById("playersInput").addEventListener("input", () => {
  updateLineUpMeta();
  const errorText = document.getElementById("errorText");
  if (errorText.textContent) errorText.textContent = "";
});

document.getElementById("splitToggle").addEventListener("change", () => {
  if (!activeSession) return;
  activeSession.splitEnabled = document.getElementById("splitToggle").checked;
  saveSession(activeSession);
  showSession(activeSession);
});

document.getElementById("splitPriceInput").addEventListener("input", () => {
  if (!activeSession) return;
  activeSession.courtPrice = Number(document.getElementById("splitPriceInput").value) || 0;
  saveSession(activeSession);
  // Update split amounts live without a full re-render (keeps input focused)
  if (activeSession.sessionEndedAt) {
    const splitActionsEl = document.getElementById("splitActions");
    if (splitActionsEl) {
      splitActionsEl.innerHTML = `
        <button type="button" class="end-session-btn is-ended" disabled>
          <span aria-hidden="true">🔒</span> Session Ended
        </button>
        ${renderSplitSummaryHtml(computeSplit(activeSession))}
      `;
    }
  }
});

// Event delegation for split actions panel (share button + end session button)
document.getElementById("splitActions").addEventListener("click", async (event) => {
  // Share button — uses Web Share API or clipboard fallback
  if (event.target.closest(".split-share-btn") && activeSession) {
    const split = computeSplit(activeSession);
    if (!split) return;
    const hasCost = split.courtPrice > 0;
    const startStr = new Date(split.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const endStr   = new Date(split.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const duration = formatElapsed(split.endedAt - split.startedAt);
    const text = [
      "🏸 Badminton Cost Split",
      `🕐 ${startStr} – ${endStr} (${duration})`,
      `🏸 ${split.totalCompletedGames} games played`,
      "",
      ...split.splits.map(({ player, games, hours, share }) =>
        `${player}  ${games}g  ${hours}h${hasCost ? `  ₹${Math.round(share)}` : ""}`
      ),
      ...(hasCost ? ["", `Total: ₹${split.courtPrice}`] : []),
    ].join("\n");
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(
        () => toast("Split copied to clipboard", "📋"),
        () => toast("Couldn't copy — please copy manually", "⚠️", 3000)
      );
    }
    return;
  }

  // End session button
  const btn = event.target.closest(".end-session-btn:not([disabled])");
  if (!btn || !activeSession) return;
  const doneCount = activeSession.completedGameIndexes.length;
  const ok = await confirmDialog({
    title: "End today's session?",
    message: doneCount > 0
      ? `Records the end time and calculates the cost split for ${doneCount} completed game${doneCount === 1 ? "" : "s"}.`
      : "No games completed yet — end the session anyway?",
    confirmLabel: "End Session",
    emoji: "🏁",
  });
  if (!ok) return;
  activeSession.sessionEndedAt = Date.now();
  saveSession(activeSession);
  showSession(activeSession);
  haptic([10, 50, 10]);
  toast("Session ended · cost split ready", "🏁", 3200);
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
  const timerBarReset = document.getElementById("sessionTimerBar");
  if (timerBarReset) timerBarReset.hidden = true;
  const splitPanelReset = document.getElementById("splitPanel");
  if (splitPanelReset) splitPanelReset.hidden = true;
  document.getElementById("splitPriceInput").value = "";
  document.getElementById("splitToggle").checked = false;
  document.getElementById("splitActions").innerHTML = "";
  const gameTarget11Reset = document.getElementById("gameTarget11");
  if (gameTarget11Reset) gameTarget11Reset.checked = true;
  document.getElementById("output").innerHTML = renderEmptyState();
  renderPartnershipMapPanel(null);

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

  // Sets were replaced by a full partnership cover; drop any state from that schema.
  localStorage.removeItem(LEGACY_SEASON_KEY);

  const savedInputs = loadInputs();
  if (savedInputs) {
    document.getElementById("playersInput").value = savedInputs.playersRaw || "";
  }

  renderKnownPlayerChips();
  updateLineUpMeta();

  const players = parsePlayers(document.getElementById("playersInput").value);
  const session = players.length ? loadSession(players) : null;

  if (session) {
    setSelectedCourtView(session.courtView || "end");
    const targetChoice = document.querySelector(`input[name="gameTarget"][value="${session.defaultTargetScore || 11}"]`);
    if (targetChoice) targetChoice.checked = true;
    showSession(session);
    if (isCompactLayout()) setView("play");
  } else {
    activeSession = null;
    document.getElementById("output").innerHTML = renderEmptyState();
    renderPartnershipMapPanel(null);
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
