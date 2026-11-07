/** Provider-independent schema. Dates are source timestamps; fetchedAt is separate. */
export interface Sportsbook { id:string; name:string; logo:string; providerKey:string|null; providerKeys:string[]; providerCoverage:'documented'|'unsupported'|'returned_by_provider'; stateAvailability:Record<string,unknown>; deepLink:string|null }
export interface OddsQuote { id:string; groupId:string; eventId:string; sportsbookId:string; market:string; selection:string; subject:string|null; line:number|null; price:number; timestamp:string|null; timestampSource:'market'|'bookmaker'|null; source:string; fresh:boolean; available:boolean; suspended:boolean; link:string|null }
export interface Event { id:string; kind:'game'|'future'; title:string; league:string; homeTeam:string|null; awayTeam:string|null; startTime:string|null; status:'upcoming'|'live'|'completed'|'unknown'; scores:{name:string;score:string}[]|null; scoreTimestamp:string|null; period:null; clock:null }
export interface MarketAvailability { sportsbookId:string; market:string; timestamp:string|null }
export interface MovementPoint { timestamp:string; observedAt:string; price:number }
export interface MovementStorage { kind:'warm_instance'; durable:false; retentionHours:48; maxPointsPerSeries:240; openingPricesVerified:false }
export interface SportsbookCoverage { sportsbookId:string; returnedQuotes:number; freshQuotes:number; availableQuotes:number; oldestSourceTimestamp:string|null; newestSourceTimestamp:string|null }
/** A provider-published fixture; no price or live score is implied by a schedule. */
export interface CalendarEvent { id:string; sport_key:string; sport_title:string; home_team:string; away_team:string; commence_time:string; status:'upcoming'; bookmakers:never[] }
export interface CalendarLeagueCoverage { key:string; title:string; events:number }
export interface CalendarBatch { page:number; totalPages:number; nextPage:number|null; totalLeagues:number; loaded:CalendarLeagueCoverage[]; failed:{key:string;title:string;error:string;code:string}[]; halted:{code:string;retryAfter:number}|null }
export interface PlayerStats { playerId:string; gameId:string; statType:string; value:number; date:string; completed:true; source:string; timestamp:string|null }
export interface Injury { playerId:string; status:string; description:string; timestamp:string; source:string }
export type Availability<T>={available:true;source:string;fetchedAt:string;data:T}|{available:false;code:string;message:string};
export interface Analysis { marketImpliedProbability:number|null; modelProbability:number|null; modelConfidence:number|null; modelEdge:number|null; dataQuality:string; concerns:string[] }
