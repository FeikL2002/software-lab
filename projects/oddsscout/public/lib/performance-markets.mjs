/** Exact provider statistic mapping shared by player-history adapters and analysis. */
export const PLAYER_STAT_MARKETS=Object.freeze({
 basketball_nba:Object.freeze({player_points:'pts',player_rebounds:'reb',player_assists:'ast',player_threes:'fg3m',player_steals:'stl',player_blocks:'blk',player_turnovers:'turnover',player_points_rebounds_assists:'pts_reb_ast'}),
 americanfootball_nfl:Object.freeze({player_pass_yds:'passing_yards',player_pass_tds:'passing_touchdowns',player_rush_yds:'rushing_yards',player_rush_tds:'rushing_touchdowns',player_reception_yds:'receiving_yards',player_receptions:'receptions',player_reception_tds:'receiving_touchdowns'}),
 baseball_mlb:Object.freeze({batter_hits:'hits',batter_runs_scored:'runs',batter_rbis:'rbi',batter_home_runs:'hr',batter_total_bases:'total_bases',batter_stolen_bases:'stolen_bases',pitcher_strikeouts:'p_k',pitcher_outs:'pitching_outs'}),
 icehockey_nhl:Object.freeze({player_goals:'goals',player_assists:'assists',player_points:'points',player_shots_on_goal:'shots_on_goal',player_total_saves:'saves',player_blocked_shots:'blocked_shots'})
});
export const playerStatForMarket=(league,market)=>PLAYER_STAT_MARKETS[league]?.[typeof market==='string'?market.replace(/_alternate$/,''):market]||null;
