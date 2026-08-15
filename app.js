function pairKey(team) {
  return [...team].sort().join("|");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

const SEASON_STORAGE_KEY = "badmintonSeasonState";
const SEASON_TTL_MS = 2 * 60 * 60 * 1000;

function playersKey(players) {
  return [...players].sort().join("|");
}

function loadSeason(players) {
  const raw = localStorage.getItem(SEASON_STORAGE_KEY);
  if (!raw) return null;

  try {
    const state = JSON.parse(raw);
    if (state.key !== playersKey(players)) return null;
    if (!state.updatedAt || Date.now() - state.updatedAt > SEASON_TTL_MS) {
      clearSeason();
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function newSeason(players, courtView = "end", servingPlacement = "bottom") {
  return {
    key: playersKey(players),
    players,
    setNumber: 0,
    cumulativeGames: Object.fromEntries(players.map((p) => [p, 0])),
    history: [],
    currentIndex: -1,
    courtView,
    servingPlacement,
    updatedAt: Date.now(),
  };
}

function saveSeason(state) {
  state.updatedAt = Date.now();
  localStorage.setItem(SEASON_STORAGE_KEY, JSON.stringify(state));
}

function clearSeason() {
  localStorage.removeItem(SEASON_STORAGE_KEY);
}

const INPUTS_STORAGE_KEY = "badmintonInputs";
const THEME_STORAGE_KEY = "badmintonTheme";
const DEFAULT_ATTEMPTS = 400;

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = document.getElementById("themeToggle");
  const isDark = theme === "dark";
  toggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  toggle.setAttribute("title", isDark ? "Switch to light theme" : "Switch to dark theme");
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

const KNOWN_PLAYERS_KEY = "badmintonKnownPlayers";

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
      <span class="chip">
        <button type="button" class="chip-add" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>
        <button type="button" class="chip-remove" data-name="${escapeHtml(name)}" aria-label="Remove ${escapeHtml(name)}">×</button>
      </span>
    `
    )
    .join("");
}

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

function evaluateSchedule(schedule, players, initialGames) {
  const playerGames = new Map(players.map((p) => [p, initialGames.get(p) || 0]));
  const partnerCount = new Map();
  const consecutive = new Map(players.map((p) => [p, 0]));

  let maxConsecutive = 0;

  for (const [team1, team2] of schedule) {
    const participants = new Set([...team1, ...team2]);

    for (const p of players) {
      if (participants.has(p)) {
        const newGames = playerGames.get(p) + 1;
        playerGames.set(p, newGames);

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

function calculateScore(game, playerGames, partnerCount, lastPlayed, consecutive, players) {
  const [team1, team2] = game;
  const participants = new Set([...team1, ...team2]);

  let score = 0;

  const partners = [pairKey(team1), pairKey(team2)];

  for (const pair of partners) {
    const count = partnerCount.get(pair) || 0;
    if (count === 0) {
      score -= 100;
    } else if (count === 1) {
      score += 80;
    } else {
      score += 200 * count;
    }
  }

  for (const p of participants) {
    const c = consecutive.get(p) || 0;
    if (c >= 2) {
      score += 1000;
    } else if (c === 1) {
      score += 100;
    }

    if ((lastPlayed.get(p) || 0) > 0 && c >= 2) {
      score += 500;
    }
  }

  const currentGames = players.map((p) => playerGames.get(p) || 0);
  const minGames = Math.min(...currentGames);
  const maxGames = Math.max(...currentGames);

  for (const p of participants) {
    if ((playerGames.get(p) || 0) > minGames) {
      score += 20;
    }
  }

  score += (maxGames - minGames) * 50;
  score += Math.random() * 15;

  return score;
}

function generateSchedule(players, attempts = 300, initialGames = null) {
  const configs = makeGameConfigs(players);
  const startingGames = initialGames || new Map(players.map((p) => [p, 0]));
  let bestSchedule = [];
  let bestScore = Infinity;

  for (let run = 0; run < attempts; run += 1) {
    const schedule = [];
    const playerGames = new Map(players.map((p) => [p, startingGames.get(p) || 0]));
    const partnerCount = new Map();
    const lastPlayed = new Map(players.map((p) => [p, 0]));
    const consecutive = new Map(players.map((p) => [p, 0]));

    let gameNumber = 0;

    while (true) {
      const candidates = [];
      const sampleSize = Math.min(150, configs.length);
      const sampled = [...configs].sort(() => 0.5 - Math.random()).slice(0, sampleSize);

      for (const config of sampled) {
        const [team1, team2] = config;
        const key1 = pairKey(team1);
        const key2 = pairKey(team2);

        if ((partnerCount.get(key1) || 0) > 0 || (partnerCount.get(key2) || 0) > 0) {
          continue;
        }

        const score = calculateScore(config, playerGames, partnerCount, lastPlayed, consecutive, players);
        candidates.push([score, config]);
      }

      if (candidates.length === 0) {
        for (const config of configs) {
          const [team1, team2] = config;
          const key1 = pairKey(team1);
          const key2 = pairKey(team2);

          if ((partnerCount.get(key1) || 0) > 0 || (partnerCount.get(key2) || 0) > 0) {
            continue;
          }

          const score = calculateScore(config, playerGames, partnerCount, lastPlayed, consecutive, players);
          candidates.push([score, config]);
        }
      }

      if (candidates.length === 0) {
        break;
      }

      candidates.sort((a, b) => a[0] - b[0]);
      const top = candidates.slice(0, Math.min(8, candidates.length));
      const selected = top[Math.floor(Math.random() * top.length)][1];

      const [team1, team2] = selected;
      const participants = new Set([...team1, ...team2]);
      schedule.push(selected);

      for (const p of players) {
        if (participants.has(p)) {
          playerGames.set(p, (playerGames.get(p) || 0) + 1);
          consecutive.set(p, (consecutive.get(p) || 0) + 1);
          lastPlayed.set(p, gameNumber + 1);
        } else {
          consecutive.set(p, 0);
        }
      }

      partnerCount.set(pairKey(team1), (partnerCount.get(pairKey(team1)) || 0) + 1);
      partnerCount.set(pairKey(team2), (partnerCount.get(pairKey(team2)) || 0) + 1);

      gameNumber += 1;
    }

    const finalScore = evaluateSchedule(schedule, players, startingGames);
    if (finalScore < bestScore) {
      bestScore = finalScore;
      bestSchedule = schedule;
    }
  }

  return bestSchedule;
}

function createMatchState(topTeam, bottomTeam, targetScore = 21) {
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
}

function undoScore(state) {
  const previous = state.undoStack.pop();
  if (previous && !state.finished) Object.assign(state, previous);
}

function renderSchedule(schedule, players, setState, seasonState) {
  const output = document.getElementById("output");
  const metaText = document.getElementById("metaText");
  const resetBtn = document.getElementById("resetCurrentSetBtn");
  output.innerHTML = "";

  const completedGameIndexes = new Set(setState.completedGameIndexes || []);
  if (!setState.matchStates) setState.matchStates = {};

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

    const state = setState.matchStates[idx];
    const expanded = setState.expandedGameIndex === idx;
    const card = document.createElement("article");
    card.className = `${completedGameIndexes.has(idx) ? "game done" : "game"}${expanded ? " expanded" : ""}`;
    card.innerHTML = `
      <button type="button" class="game-summary" aria-expanded="${expanded}">
        <span class="game-title">🏸 GAME ${idx + 1}</span>
        <span class="game-line teams"><span class="label">👥</span><span class="team">${escapeHtml(team1.join(" + "))}</span><span class="vs">VS</span><span class="team">${escapeHtml(team2.join(" + "))}</span></span>
        <span class="game-line rest-line"><span class="label">😴</span><span>Rest: ${escapeHtml(rest.join(", ") || "None")}</span></span>
        <span class="game-footer"><span class="score-pill">${state ? `${state.topScore} - ${state.bottomScore}` : "0 - 0"}</span><span class="status-pill">${state?.finished ? "Finished" : "Open scorer"}</span></span>
      </button>
    `;

    if (expanded) {
      const match = state || createMatchState(team1, team2);
      const started = match.topScore > 0 || match.bottomScore > 0;
      const servingTeam = teamForPlayer(match.server, team1, team2);
      const receiverTeam = servingTeam === "top" ? team2 : team1;
      const receiverOptions = started ? [...team1, ...team2] : receiverTeam;
      const hasServer = Boolean(servingTeam);
      const courtView = setState.courtView || "end";
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
      const placementOptions = courtView === "side"
        ? [["left", "Left"], ["right", "Right"]]
        : [["top", "Top"], ["bottom", "Bottom"]];
      const options = (names, selected, placeholder) => `<option value="">${placeholder}</option>${names.map((name) => `<option value="${escapeHtml(name)}"${selected === name ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}`;
      const scorer = document.createElement("section");
      scorer.className = "scorer-panel";
      scorer.innerHTML = `
        <div class="scorer-settings">
          <label>Play to <select class="score-target" ${started || match.finished ? "disabled" : ""}><option value="11"${match.targetScore === 11 ? " selected" : ""}>11</option><option value="21"${match.targetScore === 21 ? " selected" : ""}>21</option></select></label>
          <label>Serving team starts <select class="court-placement" ${started || match.finished ? "disabled" : ""}>${placementOptions.map(([value, label]) => `<option value="${value}"${servingPlacement === value ? " selected" : ""}>${label}</option>`).join("")}</select></label>
          <label>First server <select class="server-select" ${started || match.finished ? "disabled" : ""}>${options([...team1, ...team2], match.firstServer || match.server, "Select player")}</select></label>
          <label>First receiver <select class="receiver-select" ${!match.server || started || match.finished ? "disabled" : ""}>${options(receiverOptions, match.firstReceiver || match.receiver, "Select opponent")}</select></label>
        </div>
        <div class="court court-${courtView}"><div class="court-side ${primaryLabel === "Serving" ? "serving" : ""}"><span class="court-label">${primaryLabel}</span><span>${escapeHtml(primaryPositions.left)}</span><span>${escapeHtml(primaryPositions.right)}</span></div><div class="net">NET</div><div class="court-side ${secondaryLabel === "Serving" ? "serving" : ""}"><span class="court-label">${secondaryLabel}</span><span>${escapeHtml(secondaryPositions.left)}</span><span>${escapeHtml(secondaryPositions.right)}</span></div></div>
        <p class="service-note">${match.server && match.receiver ? `${escapeHtml(match.server)} to ${escapeHtml(match.receiver)} from ${(servingTeam === "top" ? match.topScore : match.bottomScore) % 2 === 0 ? "right" : "left"}` : "Select the first server and receiver."}</p>
        <div class="scorer-actions"><div class="point-actions"><button type="button" class="point-btn primary-point" ${!match.server || !match.receiver || match.finished || gameComplete(match) ? "disabled" : ""}><span>${escapeHtml(primaryButtonTeam.join(" + "))}</span><span class="point-team-score">Score: ${primaryButtonScore}</span><strong>+1</strong></button><button type="button" class="point-btn secondary-point" ${!match.server || !match.receiver || match.finished || gameComplete(match) ? "disabled" : ""}><span>${escapeHtml(secondaryButtonTeam.join(" + "))}</span><span class="point-team-score">Score: ${secondaryButtonScore}</span><strong>+1</strong></button></div><div class="game-actions"><button type="button" class="ghost undo-btn" ${match.undoStack.length === 0 || match.finished ? "disabled" : ""}>Undo</button><button type="button" class="finish-btn" ${!gameComplete(match) || match.finished ? "disabled" : ""}>${match.finished ? "Finished" : "Finish Game"}</button></div></div>
      `;
      const update = (change) => {
        if (!setState.matchStates[idx]) setState.matchStates[idx] = createMatchState(team1, team2);
        change(setState.matchStates[idx]);
        saveSeason(seasonState);
        showHistoryEntry(seasonState);
      };
      scorer.querySelector(".score-target").addEventListener("change", (event) => update((active) => { active.targetScore = Number(event.target.value); }));
      scorer.querySelector(".court-placement").addEventListener("change", (event) => update((active) => { active.courtServingPlacement = event.target.value; }));
      scorer.querySelector(".server-select").addEventListener("change", (event) => update((active) => { active.server = event.target.value; active.firstServer = event.target.value; active.receiver = ""; active.firstReceiver = ""; active.courtServingTeam = teamForPlayer(active.server, team1, team2); active.courtView = courtView; active.courtServingPlacement = servingPlacement; placeServerAndReceiver(active, team1, team2); }));
      scorer.querySelector(".receiver-select").addEventListener("change", (event) => update((active) => { active.receiver = event.target.value; active.firstReceiver = event.target.value; placeServerAndReceiver(active, team1, team2); }));
      scorer.querySelector(".primary-point").addEventListener("click", (event) => { event.stopPropagation(); update((active) => scorePoint(active, primaryTeam, team1, team2)); });
      scorer.querySelector(".secondary-point").addEventListener("click", (event) => { event.stopPropagation(); update((active) => scorePoint(active, secondaryTeam, team1, team2)); });
      scorer.querySelector(".undo-btn").addEventListener("click", () => update(undoScore));
      scorer.querySelector(".finish-btn").addEventListener("click", () => update((active) => { if (gameComplete(active)) { active.finished = true; completedGameIndexes.add(idx); setState.completedGameIndexes = [...completedGameIndexes]; } }));
      card.appendChild(scorer);
    }

    card.querySelector(".game-summary").addEventListener("click", () => {
      setState.expandedGameIndex = expanded ? null : idx;
      saveSeason(seasonState);
      showHistoryEntry(seasonState);
    });

    output.appendChild(card);
  });

  const totalPossible = (players.length * (players.length - 1)) / 2;
  const uniquePartners = partnerCount.size;

  let repeated = 0;
  for (const count of partnerCount.values()) {
    repeated += Math.max(0, count - 1);
  }

  const stat = document.createElement("div");
  stat.className = "stat";

  const setRows = players
    .map((p) => {
      const games = playerGames.get(p) || 0;
      const rests = schedule.length - games;
      return `<tr><td>${escapeHtml(p)}</td><td>${games}</td><td>${rests}</td></tr>`;
    })
    .join("");

  let statHtml = `
    <h3 class="stat-title">📊 This Set</h3>
    <table class="stat-table">
      <thead><tr><th>Player</th><th>Games</th><th>Rest</th></tr></thead>
      <tbody>${setRows}</tbody>
    </table>
    <div class="stat-summary">
      <span>🤝 Unique partnerships: ${uniquePartners}/${totalPossible}</span>
      <span>🔁 Repeated partnerships: ${repeated}</span>
    </div>
  `;

  if (seasonState) {
    const seasonGames = Object.values(seasonState.cumulativeGames);
    const seasonMax = Math.max(...seasonGames);
    const seasonMin = Math.min(...seasonGames);
    const seasonRows = players
      .map((p) => {
        const games = seasonState.cumulativeGames[p] || 0;
        const behind = seasonMax - games;
        return `<tr><td>${escapeHtml(p)}</td><td>${games}</td><td>${behind > 0 ? `owed ${behind}` : "—"}</td></tr>`;
      })
      .join("");

    statHtml += `
      <h3 class="stat-title">🏆 Season (set ${seasonState.setNumber})</h3>
      <table class="stat-table">
        <thead><tr><th>Player</th><th>Season games</th><th>Owed</th></tr></thead>
        <tbody>${seasonRows}</tbody>
      </table>
      <div class="stat-summary">
        <span>${seasonMax - seasonMin === 0 ? "✅ Season is perfectly balanced." : `⚖️ Season spread: ${seasonMax - seasonMin} game(s). Generate another set to even it out.`}</span>
      </div>
    `;
  }

  stat.innerHTML = statHtml;

  output.appendChild(stat);

  resetBtn.disabled = schedule.length === 0;
  resetBtn.onclick = () => {
    if (!window.confirm("Reset all scores and completed markers for this set?")) return;

    completedGameIndexes.clear();
    setState.completedGameIndexes = [];
    setState.matchStates = {};
    setState.expandedGameIndex = null;
    saveSeason(seasonState);
    showHistoryEntry(seasonState);
  };

  metaText.textContent = setState
    ? `Set ${setState.setNumber}: generated ${schedule.length} game(s). Season games are tracked to auto-balance the next set.`
    : `Generated ${schedule.length} game(s). Stops before partnership repetition.`;
}


function parsePlayers(raw) {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function unique(values) {
  return [...new Set(values)];
}

function validatePlayers(players) {
  if (players.length < 4) {
    return "Need at least 4 players.";
  }

  const distinct = unique(players);
  if (distinct.length !== players.length) {
    return "Player names must be unique.";
  }

  return "";
}

function updateNavControls(seasonState) {
  const prevBtn = document.getElementById("prevSetBtn");
  const viewNextBtn = document.getElementById("viewNextSetBtn");
  const indicator = document.getElementById("setIndicator");
  const nextSetBtn = document.getElementById("nextSetBtn");
  const startBtn = document.getElementById("startBtn");
  const courtViewChoices = document.querySelectorAll('input[name="courtView"]');

  const total = seasonState ? seasonState.history.length : 0;
  const index = seasonState ? seasonState.currentIndex : -1;

  prevBtn.disabled = !seasonState || index <= 0;
  viewNextBtn.disabled = !seasonState || index >= total - 1;
  nextSetBtn.disabled = !seasonState;
  startBtn.disabled = Boolean(seasonState);
  courtViewChoices.forEach((choice) => { choice.disabled = Boolean(seasonState); });
  indicator.textContent = seasonState ? `Set ${index + 1} of ${total}` : "No sets yet";
}

function selectedCourtView() {
  return document.querySelector('input[name="courtView"]:checked').value;
}

function setSelectedCourtView(courtView) {
  const choice = document.querySelector(`input[name="courtView"][value="${courtView}"]`);
  if (choice) choice.checked = true;
}

function showHistoryEntry(seasonState) {
  const entry = seasonState.history[seasonState.currentIndex];
  renderSchedule(entry.schedule, seasonState.players, entry, seasonState);
  updateNavControls(seasonState);
}

function generateNextSet(seasonState, attempts) {
  const players = seasonState.players;
  const schedule = generateSchedule(players, attempts, new Map(Object.entries(seasonState.cumulativeGames)));

  for (const p of players) {
    seasonState.cumulativeGames[p] += schedule.filter(([t1, t2]) => t1.includes(p) || t2.includes(p)).length;
  }
  seasonState.setNumber += 1;
  seasonState.history.push({
    setNumber: seasonState.setNumber,
    schedule,
    cumulativeGames: { ...seasonState.cumulativeGames },
    completedGameIndexes: [],
    courtView: seasonState.courtView || "end",
    servingPlacement: seasonState.servingPlacement || "bottom",
  });
  seasonState.currentIndex = seasonState.history.length - 1;
  saveSeason(seasonState);
  showHistoryEntry(seasonState);
}

document.getElementById("demoBtn").addEventListener("click", () => {
  if (!window.confirm("Replace the current player names with the demo list?")) return;

  document.getElementById("playersInput").value = "A\nB\nC\nD\nE\nF";
  document.getElementById("errorText").textContent = "";
});

document.getElementById("startBtn").addEventListener("click", () => {
  const errorText = document.getElementById("errorText");
  errorText.textContent = "";

  const players = parsePlayers(document.getElementById("playersInput").value);
  const validationError = validatePlayers(players);
  if (validationError) {
    errorText.textContent = validationError;
    return;
  }

  saveInputs(document.getElementById("playersInput").value);
  rememberKnownPlayers(players);
  renderKnownPlayerChips();

  const courtView = selectedCourtView();
  const seasonState = newSeason(players, courtView);
  generateNextSet(seasonState, DEFAULT_ATTEMPTS);
});

document.getElementById("nextSetBtn").addEventListener("click", () => {
  const errorText = document.getElementById("errorText");
  errorText.textContent = "";

  const players = parsePlayers(document.getElementById("playersInput").value);
  const validationError = validatePlayers(players);
  if (validationError) {
    errorText.textContent = validationError;
    return;
  }

  const seasonState = loadSeason(players);
  if (!seasonState) {
    errorText.textContent = "Click Start first to begin a season for this player list.";
    return;
  }

  generateNextSet(seasonState, DEFAULT_ATTEMPTS);
});

document.getElementById("knownPlayersChips").addEventListener("click", (event) => {
  const removeBtn = event.target.closest(".chip-remove");
  if (removeBtn) {
    forgetKnownPlayer(removeBtn.dataset.name);
    renderKnownPlayerChips();
    return;
  }

  const addBtn = event.target.closest(".chip-add");
  if (!addBtn) return;

  const input = document.getElementById("playersInput");
  const existing = parsePlayers(input.value);
  const name = addBtn.dataset.name;
  if (existing.includes(name)) return;

  input.value = existing.concat(name).join("\n") + "\n";
  input.focus();
});

document.getElementById("prevSetBtn").addEventListener("click", () => {
  const players = parsePlayers(document.getElementById("playersInput").value);
  const seasonState = loadSeason(players);
  if (!seasonState || seasonState.currentIndex <= 0) return;

  seasonState.currentIndex -= 1;
  saveSeason(seasonState);
  showHistoryEntry(seasonState);
});

document.getElementById("viewNextSetBtn").addEventListener("click", () => {
  const players = parsePlayers(document.getElementById("playersInput").value);
  const seasonState = loadSeason(players);
  if (!seasonState || seasonState.currentIndex >= seasonState.history.length - 1) return;

  seasonState.currentIndex += 1;
  saveSeason(seasonState);
  showHistoryEntry(seasonState);
});

document.getElementById("resetSeasonBtn").addEventListener("click", () => {
  if (!window.confirm("Reset the season, player names, and all completed markers?")) return;

  clearSeason();
  localStorage.removeItem(INPUTS_STORAGE_KEY);
  document.getElementById("playersInput").value = "";
  document.getElementById("output").innerHTML = "";
  const resetCurrentSetBtn = document.getElementById("resetCurrentSetBtn");
  resetCurrentSetBtn.disabled = true;
  resetCurrentSetBtn.onclick = null;
  updateNavControls(null);
  document.getElementById("errorText").textContent = "";
  document.getElementById("metaText").textContent = "Season reset. Enter player names and click Start.";
  document.getElementById("playersInput").focus();
});

window.addEventListener("DOMContentLoaded", () => {
  applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || "light");
  document.getElementById("themeToggle").addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  });

  const savedInputs = loadInputs();
  if (savedInputs) {
    document.getElementById("playersInput").value = savedInputs.playersRaw || "";
  }

  renderKnownPlayerChips();

  const players = parsePlayers(document.getElementById("playersInput").value);
  const seasonState = players.length ? loadSeason(players) : null;
  if (seasonState && seasonState.history.length) {
    setSelectedCourtView(seasonState.courtView || "end");
    showHistoryEntry(seasonState);
  } else {
    updateNavControls(null);
  }
});

