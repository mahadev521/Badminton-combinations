import random
import itertools
from collections import Counter


# ============================================================
# BADMINTON ROTATION GENERATOR
# ============================================================

def all_partnerships(players):
    """Return all possible 2-player partnerships."""
    return list(itertools.combinations(players, 2))


def make_game_configs(players):
    """
    Generate possible games.

    A game consists of:
        Team 1 = 2 players
        Team 2 = 2 players
        Rest   = everyone else

    We generate all possible 4-player selections and
    all 3 possible ways to split them into two teams.
    """

    configs = []

    for four in itertools.combinations(players, 4):
        a, b, c, d = four

        pairings = [
            ((a, b), (c, d)),
            ((a, c), (b, d)),
            ((a, d), (b, c)),
        ]

        for team1, team2 in pairings:
            configs.append((team1, team2))

    return configs


def calculate_score(
    game,
    history,
    player_games,
    partner_count,
    last_played,
    consecutive
):
    """
    Lower score = better game.

    We penalize:
        - repeated partnerships
        - unequal number of games
        - consecutive games
        - players who just played
    """

    team1, team2 = game
    participants = set(team1 + team2)

    score = 0

    # --------------------------------------------------------
    # 1. Partner repetition
    # --------------------------------------------------------

    partners = [
        tuple(sorted(team1)),
        tuple(sorted(team2))
    ]

    for pair in partners:
        count = partner_count[pair]

        if count == 0:
            score -= 100       # strongly prefer new partner
        elif count == 1:
            score += 80
        else:
            score += 200 * count

    # --------------------------------------------------------
    # 2. Opponent repetition is mildly penalized
    # --------------------------------------------------------

    opponent_pairs = [
        (team1[0], team2[0]),
        (team1[0], team2[1]),
        (team1[1], team2[0]),
        (team1[1], team2[1])
    ]

    # Not as important as partner variety
    # but still useful for variety.
    # We don't maintain opponent history separately,
    # so this is intentionally omitted from scoring.
    
    # --------------------------------------------------------
    # 3. Consecutive games
    # --------------------------------------------------------

    for p in participants:
        if consecutive[p] >= 2:
            score += 1000
        elif consecutive[p] == 1:
            score += 100

    # --------------------------------------------------------
    # 4. Rest/recovery preference
    # --------------------------------------------------------

    for p in participants:
        if last_played[p] == 0:
            # First game — no penalty
            continue

        games_since_rest = consecutive[p]

        if games_since_rest >= 2:
            score += 500

    # --------------------------------------------------------
    # 5. Balance total games
    # --------------------------------------------------------

    current_games = [player_games[p] for p in last_played]
    min_games = min(current_games)
    max_games = max(current_games)

    for p in participants:
        if player_games[p] > min_games:
            score += 20

    score += (max_games - min_games) * 50

    # --------------------------------------------------------
    # 6. Small randomness
    # --------------------------------------------------------

    score += random.uniform(0, 15)

    return score


def generate_schedule(players, attempts=200):
    """
    Generate several candidate schedules and keep the best one.

    Games are generated until adding another game would force
    a repeated partnership.
    """

    best_schedule = None
    best_score = float("inf")

    configs = make_game_configs(players)

    for _ in range(attempts):

        schedule = []

        player_games = Counter()
        partner_count = Counter()

        last_played = {p: 0 for p in players}
        consecutive = {p: 0 for p in players}

        game_number = 0

        while True:

            candidates = []

            # Random subset of configurations to prevent
            # the algorithm from becoming deterministic.
            sample_size = min(150, len(configs))
            sampled_configs = random.sample(configs, sample_size)

            for config in sampled_configs:

                team1, team2 = config
                pair1 = tuple(sorted(team1))
                pair2 = tuple(sorted(team2))

                # Stop before any partnership is repeated.
                if partner_count[pair1] > 0 or partner_count[pair2] > 0:
                    continue

                score = calculate_score(
                    config,
                    schedule,
                    player_games,
                    partner_count,
                    last_played,
                    consecutive
                )

                candidates.append((score, config))

            # In case random sampling misses valid non-repeating games,
            # scan the full config list before stopping.
            if not candidates:
                for config in configs:
                    team1, team2 = config
                    pair1 = tuple(sorted(team1))
                    pair2 = tuple(sorted(team2))

                    if partner_count[pair1] > 0 or partner_count[pair2] > 0:
                        continue

                    score = calculate_score(
                        config,
                        schedule,
                        player_games,
                        partner_count,
                        last_played,
                        consecutive
                    )

                    candidates.append((score, config))

            if not candidates:
                break

            candidates.sort(key=lambda x: x[0])

            # Randomly choose among the best candidates.
            top = candidates[:min(8, len(candidates))]

            _, selected = random.choice(top)

            team1, team2 = selected
            participants = set(team1 + team2)

            schedule.append(selected)

            # Update statistics
            for p in players:

                if p in participants:
                    player_games[p] += 1

                    if consecutive[p] == 0:
                        consecutive[p] = 1
                    else:
                        consecutive[p] += 1

                    last_played[p] = game_number + 1

                else:
                    consecutive[p] = 0

            partner_count[tuple(sorted(team1))] += 1
            partner_count[tuple(sorted(team2))] += 1
            game_number += 1

        # Evaluate complete schedule
        final_score = evaluate_schedule(
            schedule,
            players
        )

        if final_score < best_score:
            best_score = final_score
            best_schedule = schedule

    return best_schedule


def evaluate_schedule(schedule, players):
    """
    Evaluate the quality of a complete schedule.
    Lower = better.
    """

    player_games = Counter()
    partner_count = Counter()

    consecutive = {p: 0 for p in players}
    max_consecutive = 0

    for team1, team2 in schedule:

        participants = set(team1 + team2)

        for p in players:
            if p in participants:
                player_games[p] += 1
                consecutive[p] += 1

                max_consecutive = max(
                    max_consecutive,
                    consecutive[p]
                )
            else:
                consecutive[p] = 0

        partner_count[tuple(sorted(team1))] += 1
        partner_count[tuple(sorted(team2))] += 1

    # --------------------------------------------------------
    # Game balance
    # --------------------------------------------------------

    games = [player_games[p] for p in players]

    game_imbalance = max(games) - min(games)

    score = game_imbalance * 1000

    # --------------------------------------------------------
    # Partner variety
    # --------------------------------------------------------

    unique_partners = len(partner_count)

    total_possible = len(players) * (len(players) - 1) // 2

    repeated_partnerships = sum(
        max(0, count - 1)
        for count in partner_count.values()
    )

    score += repeated_partnerships * 500
    score -= unique_partners * 100

    # --------------------------------------------------------
    # Consecutive games
    # --------------------------------------------------------

    if max_consecutive >= 4:
        score += 5000
    elif max_consecutive == 3:
        score += 1500
    elif max_consecutive == 2:
        score += 200

    return score


def print_schedule(schedule, players):
    """Pretty console output."""

    print()
    print("=" * 55)
    print("🏸 BADMINTON ROTATION")
    print("=" * 55)

    player_games = Counter()
    partner_count = Counter()

    for i, (team1, team2) in enumerate(schedule, start=1):

        participants = set(team1 + team2)

        rest = [
            p for p in players
            if p not in participants
        ]

        print()
        print(f"🏸 GAME {i}")
        print(
            f"   {team1[0]} + {team1[1]}"
            f"   🆚   "
            f"{team2[0]} + {team2[1]}"
        )

        print(
            "   😴 Rest: "
            + ", ".join(rest)
        )

        for p in participants:
            player_games[p] += 1

        partner_count[tuple(sorted(team1))] += 1
        partner_count[tuple(sorted(team2))] += 1

    # --------------------------------------------------------
    # Statistics
    # --------------------------------------------------------

    print()
    print("=" * 55)
    print("📊 STATISTICS")
    print("=" * 55)

    print()

    for p in players:
        games = player_games[p]
        rests = len(schedule) - games

        print(
            f"{p:<15} "
            f"Games: {games:<3} "
            f"Rest: {rests}"
        )

    total_possible = len(players) * (len(players) - 1) // 2

    unique_partners = len(partner_count)

    repeated = sum(
        max(0, count - 1)
        for count in partner_count.values()
    )

    print()
    print(
        f"🤝 Unique partnerships: "
        f"{unique_partners}/{total_possible}"
    )

    print(
        f"🔄 Repeated partnerships: "
        f"{repeated}"
    )

    print()
    print("💡 Run the program again for a different randomized rotation.")

    print("=" * 55)


# ============================================================
# MAIN PROGRAM
# ============================================================

def main():

    print()
    print("🏸 BADMINTON ROTATION GENERATOR")
    print("=" * 40)

    # --------------------------------------------------------
    # Number of players
    # --------------------------------------------------------

    while True:
        try:
            n = int(input("\nNumber of players: "))

            if n < 4:
                print("❌ Need at least 4 players.")
                continue

            break

        except ValueError:
            print("❌ Enter a valid number.")

    # --------------------------------------------------------
    # Names
    # --------------------------------------------------------

    players = []

    print("\nEnter player names:")

    for i in range(n):

        while True:

            name = input(f"{i + 1}. ").strip()

            if not name:
                print("❌ Name cannot be empty.")
                continue

            if name in players:
                print("❌ Name already exists.")
                continue

            players.append(name)
            break

    # --------------------------------------------------------
    # Generate
    # --------------------------------------------------------

    print()
    print("🎲 Generating randomized rotation...")
    print("⚙️ Optimizing partners, rest and game balance...")
    print("🛑 Stops automatically before partner repetition starts.")

    schedule = generate_schedule(
        players,
        attempts=300
    )

    # --------------------------------------------------------
    # Display
    # --------------------------------------------------------

    print_schedule(
        schedule,
        players
    )


if __name__ == "__main__":
    main()