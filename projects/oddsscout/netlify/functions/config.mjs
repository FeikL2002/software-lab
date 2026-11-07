import {getEntrySession} from '../../server/entry-session.mjs';
import {env,json,handleError,authorize} from '../../server/common.mjs';
import {configuredBooks,coverageParameters} from '../../server/provider.mjs';
import {SPORTSBOOKS} from '../../public/lib/sportsbooks.mjs';
import {accountConfig,accountProvider} from '../../server/accounts.mjs';
import {formProvider} from '../../server/form-provider.mjs';
export default async function(request) {
  if (request.method !== 'GET') return json({error:'Method not allowed.',code:'METHOD_NOT_ALLOWED'},405);
  try {
    authorize(request);
    const entrySession=getEntrySession(request,env('ACCESS_CODE'));
    const oddsConfigured = Boolean(env('ODDS_API_KEY').trim());
    return json({
      accountsConfigured:Boolean(accountConfig()), accountProvider:accountProvider(), liveQuoteMaxAgeSeconds:90, apiVersion: 3, calendarAvailable:true, calendarRefreshSeconds:300, allLeaguesAvailable: true, eventMarketsAvailable:true, futuresAvailable:true, mode: oddsConfigured ? 'configured' : 'unconfigured',
      oddsConfigured, aiEnabled: Boolean(env('OPENAI_API_KEY').trim()),
      formConfigured: formProvider()==='public'||(formProvider()==='balldontlie'&&Boolean(env('BALLDONTLIE_API_KEY').trim())), formProvider:formProvider(), researchAvailable: true, formLeagues: ['basketball_nba','americanfootball_nfl','baseball_mlb','icehockey_nhl'],
      roomLocked: Boolean(env('ACCESS_CODE')), entryAuthenticated:Boolean(entrySession), entryExpiresAt:entrySession?.expiresAt??null, configuredBooks: configuredBooks(), coverageRequest:coverageParameters(), sportsbookRegistry:SPORTSBOOKS,
      // These are configuration flags, NOT a successful provider connectivity check.
      providerVerified: false, demoAvailable: false, refreshSeconds: 60, liveRefreshSeconds:30,
      performanceConfigured:true, performanceProvider:env('BALLDONTLIE_API_KEY').trim()?'BALLDONTLIE':'Public source adapters', performanceLeagues:['basketball_nba','americanfootball_nfl','baseball_mlb','icehockey_nhl'], lineMovementSource:'Real observations retained by a warm server instance',
      unsupportedProviderBooks:SPORTSBOOKS.filter(book=>book.providerCoverage==='unsupported').map(book=>book.id)
    });
  } catch (error) { return handleError(error); }
}
export const config={rateLimit:{action:'rate_limit',windowLimit:60,windowSize:60,aggregateBy:['domain','ip']}};
