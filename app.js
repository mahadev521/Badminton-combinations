function pairKey(team) {
  return [...team].sort().join("|");
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

function evaluateSchedule(schedule, players) {
  const playerGames = new Map(players.map((p) => [p, 0]));
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

function generateSchedule(players, attempts = 300) {
  const configs = makeGameConfigs(players);
  let bestSchedule = [];
  let bestScore = Infinity;

  for (let run = 0; run < attempts; run += 1) {
    const schedule = [];
    const playerGames = new Map(players.map((p) => [p, 0]));
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

    const finalScore = evaluateSchedule(schedule, players);
    if (finalScore < bestScore) {
      bestScore = finalScore;
      bestSchedule = schedule;
    }
  }

  return bestSchedule;
}

function renderSchedule(schedule, players) {
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
        <span class="team">${team1[0]} + ${team1[1]}</span>
        <span class="vs">VS</span>
        <span class="team">${team2[0]} + ${team2[1]}</span>
      </div>
      <div class="game-line rest-line">
        <span class="label">😴</span>
        <span>Rest: ${rest.join(", ") || "None"}</span>
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

  const statLines = players.map((p) => {
    const games = playerGames.get(p) || 0;
    const rests = schedule.length - games;
    return `${p.padEnd(14, " ")} Games: ${String(games).padEnd(2, " ")} Rest: ${rests}`;
  });

  const stat = document.createElement("div");
  stat.className = "stat";
  stat.textContent = [
    "📊 STATISTICS",
    ...statLines,
    "",
    `🤝 Unique partnerships: ${uniquePartners}/${totalPossible}`,
    `🔁 Repeated partnerships: ${repeated}`,
  ].join("\n");

  output.appendChild(stat);

  resetBtn.disabled = schedule.length === 0;

  metaText.textContent = `Generated ${schedule.length} game(s). Stops before partnership repetition.`;
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

  const attemptsRaw = Number.parseInt(document.getElementById("attemptsInput").value, 10);
  const attempts = Number.isFinite(attemptsRaw) && attemptsRaw > 0 ? attemptsRaw : 300;

  const schedule = generateSchedule(players, attempts);
  renderSchedule(schedule, players);
});
