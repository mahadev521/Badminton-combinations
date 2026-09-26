import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "https://hipkcehrathwsvkmafku.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhpcGtjZWhyYXRod3N2a21hZmt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNzM3NTMsImV4cCI6MjEwNTk0OTc1M30.rfGPHGik27xEc820RU01tU1cyBZFBxUoRqwe3fWNPCE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getCurrentUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user || null;
}

export async function signUpUser(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signInUser(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function syncSessionToCloud(session) {
  const user = await getCurrentUser();
  if (!user || !session) return;

  const payload = {
    user_id: user.id,
    players: session.players,
    schedule: session.schedule,
    match_states: session.matchStates,
    completed_game_indexes: session.completedGameIndexes,
    court_price: session.courtPrice || 0,
    session_ended_at: session.sessionEndedAt,
    updated_at: new Date().toISOString(),
  };

  await supabase.from("badminton_sessions").upsert(payload, { onConflict: "user_id" });
}

export async function recordFinishedMatch(gameIndex, teamA, teamB, scoreA, scoreB) {
  const user = await getCurrentUser();
  if (!user) return;

  const winner = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "Draw";
  await supabase.from("badminton_matches").insert([{
    user_id: user.id,
    game_index: gameIndex,
    team_a: teamA,
    team_b: teamB,
    score_a: scoreA,
    score_b: scoreB,
    winner,
  }]);
}

export async function fetchLifetimeStats() {
  const user = await getCurrentUser();
  if (!user) return {};

  const { data: matches, error } = await supabase
    .from("badminton_matches")
    .select("*")
    .eq("user_id", user.id);

  if (error || !matches) return {};

  const stats = {};
  for (const m of matches) {
    const winners = m.winner === "A" ? m.team_a : m.winner === "B" ? m.team_b : [];
    const participants = [...m.team_a, ...m.team_b];

    for (const p of participants) {
      if (!stats[p]) stats[p] = { played: 0, won: 0, pointsScored: 0 };
      stats[p].played += 1;
      if (winners.includes(p)) stats[p].won += 1;
      stats[p].pointsScored += m.team_a.includes(p) ? m.score_a : m.score_b;
    }
  }
  return stats;
}
