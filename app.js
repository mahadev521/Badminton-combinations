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

function newSeason(players) {
  return {
    key: playersKey(players),
    players,
    setNumber: 0,
    cumulativeGames: Object.fromEntries(players.map((p) => [p, 0])),
    history: [],
    currentIndex: -1,
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
const DEFAULT_ATTEMPTS = 400;

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

function renderSchedule(schedule, players, seasonState) {
  const output = document.getElementById("output");
  const metaText = document.getElementById("metaText");
  const resetBtn = document.getElementById("resetColorsBtn");
  output.innerHTML = "";

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

    const card = document.createElement("article");
    card.className = "game";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.innerHTML = `
      <div class="game-title">🏸 GAME ${idx + 1}</div>
      <div class="game-line teams">
        <span class="label">👥</span>
        <span class="team">${escapeHtml(team1[0])} + ${escapeHtml(team1[1])}</span>
        <span class="vs">VS</span>
        <span class="team">${escapeHtml(team2[0])} + ${escapeHtml(team2[1])}</span>
      </div>
      <div class="game-line rest-line">
        <span class="label">😴</span>
        <span>Rest: ${escapeHtml(rest.join(", ") || "None")}</span>
      </div>
      <span class="status-pill">Tap to mark done</span>
    `;

    const toggleDone = () => {
      card.classList.toggle("done");
    };

    card.addEventListener("click", toggleDone);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleDone();
      }
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

  metaText.textContent = seasonState
    ? `Set ${seasonState.setNumber}: generated ${schedule.length} game(s). Season games are tracked to auto-balance the next set.`
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

  const total = seasonState ? seasonState.history.length : 0;
  const index = seasonState ? seasonState.currentIndex : -1;

  prevBtn.disabled = !seasonState || index <= 0;
  viewNextBtn.disabled = !seasonState || index >= total - 1;
  nextSetBtn.disabled = !seasonState;
  indicator.textContent = seasonState ? `Set ${index + 1} of ${total}` : "No sets yet";
}

function showHistoryEntry(seasonState) {
  const entry = seasonState.history[seasonState.currentIndex];
  renderSchedule(entry.schedule, seasonState.players, entry);
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
  });
  seasonState.currentIndex = seasonState.history.length - 1;
  saveSeason(seasonState);
  showHistoryEntry(seasonState);
}

document.getElementById("demoBtn").addEventListener("click", () => {
  document.getElementById("playersInput").value = "A\nB\nC\nD\nE\nF";
  document.getElementById("errorText").textContent = "";
});

document.getElementById("resetColorsBtn").addEventListener("click", () => {
  document.querySelectorAll(".game.done").forEach((card) => {
    card.classList.remove("done");
  });
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

  const seasonState = newSeason(players);
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
  clearSeason();
  updateNavControls(null);
  document.getElementById("errorText").textContent = "";
  document.getElementById("metaText").textContent = "Season reset. Enter player names and click Start.";
});

window.addEventListener("DOMContentLoaded", () => {
  const savedInputs = loadInputs();
  if (savedInputs) {
    document.getElementById("playersInput").value = savedInputs.playersRaw || "";
  }

  renderKnownPlayerChips();

  const players = parsePlayers(document.getElementById("playersInput").value);
  const seasonState = players.length ? loadSeason(players) : null;
  if (seasonState && seasonState.history.length) {
    showHistoryEntry(seasonState);
  } else {
    updateNavControls(null);
  }
});

