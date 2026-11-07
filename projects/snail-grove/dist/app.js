import { makeReels, pickOutcome, resolveRound } from './engine.js';

const $ = (selector) => document.querySelector(selector);
const shell = $('.game-shell');
const reelWindow = $('#reel-window');
const spinButton = $('#spin-button');
const modes = [...document.querySelectorAll('input[name="mode"]')];
const stakeButtons = [...document.querySelectorAll('[data-stake]')];
const editableControls = [...document.querySelectorAll('button, input, select')];
const credits = (value) => Number(value).toFixed(2);
const signed = (value) => `${value >= 0 ? '+' : '−'}${credits(Math.abs(value))}`;
const randomBuffer = new Uint32Array(1);
const cryptoFloat = () => {
  crypto.getRandomValues(randomBuffer);
  return randomBuffer[0] / 4294967296;
};
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let balance = 100;
let stake = 1;
let round = 0;
let mode = 'directed';
let scheduleCounter = 0;
let busy = false;
let history = [];

function renderColumn(index, symbols) {
  const reel = $(`#reel-${index}`);
  reel.replaceChildren(...symbols.map((name) => {
    const cell = document.createElement('div');
    cell.className = 'symbol';
    cell.setAttribute('role', 'img');
    cell.setAttribute('aria-label', name);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${name}`);
    svg.append(use);
    cell.append(svg);
    return cell;
  }));
}

function settings() {
  return {
    every: Number($('#schedule-every').value),
    scheduledMultiplier: Number($('#schedule-outcome').value),
    directedMultiplier: Number($('#directed-outcome').value),
  };
}

function previewMultiplier() {
  const config = settings();
  if (mode === 'random') return null;
  if (mode === 'directed') return config.directedMultiplier;
  return (scheduleCounter + 1) % config.every === 0 ? config.scheduledMultiplier : 0;
}

function refresh() {
  const config = settings();
  const preview = previewMultiplier();
  for (const name of ['directed', 'schedule', 'random']) $(`#${name}-settings`).hidden = name !== mode;
  $('#mode-indicator').textContent = { directed: 'DIRECTED DEMO', schedule: 'SCHEDULED DEMO', random: 'RANDOM DEMO' }[mode];
  $('#next-preview-value').textContent = preview === null ? 'Unknown · Random draw' : `${preview}× · ${mode === 'directed' ? 'Directed' : 'Scheduled'}`;
  $('#next-preview-detail').textContent = balance < stake
    ? 'Use Reset demo to restore 100 pretend credits.'
    : preview === null ? `${credits(stake)} cr played · outcome drawn when you spin`
      : `${credits(stake)} cr played → ${credits(stake * preview)} cr returned`;
  const position = scheduleCounter % config.every;
  $('#schedule-progress').replaceChildren(...Array.from({ length: config.every }, (_, index) => {
    const pip = document.createElement('span');
    pip.className = `progress-pip${index < position ? ' complete' : ''}${index === config.every - 1 ? ' payout' : ''}`;
    pip.textContent = index === config.every - 1 ? '✦' : index + 1;
    return pip;
  }));
  $('#schedule-progress').setAttribute('aria-label', `${position} of ${config.every} rounds completed toward the next scheduled payout`);
  stakeButtons.forEach((button) => button.setAttribute('aria-pressed', Number(button.dataset.stake) === stake ? 'true' : 'false'));
  for (const control of editableControls) control.disabled = busy;
  spinButton.disabled = busy || balance < stake;
  $('#spin-label').textContent = busy ? 'REVEALING THE RESULT…' : balance < stake ? (balance < 0.1 ? 'RESET FOR MORE CREDITS' : 'RESET OR LOWER AMOUNT') : 'SPIN THE GROVE';
  if (!busy && round === 0) {
    $('#result-kicker').textContent = mode === 'directed' ? "YOU'RE THE DIRECTOR" : mode === 'schedule' ? 'A VISIBLE PAYOUT SCHEDULE' : 'THE SAMPLE ODDS ARE IN CONTROL';
    $('#result-text').textContent = preview === null ? 'A fresh random draw each spin.' : `Your next result is ${preview}×`;
    $('#result-detail').textContent = mode === 'random' ? 'See the math to inspect every probability.' : 'Set the outcome in the controls. Then give it a spin.';
  }
}

function updateStats(lastReturn = 0) {
  $('#balance').innerHTML = `${credits(balance)} <small>cr</small>`;
  $('#last-return').innerHTML = `${credits(lastReturn)} <small>cr</small>`;
  const sessionProfit = Math.round((balance - 100) * 100) / 100;
  const profitElement = $('#session-profit');
  profitElement.innerHTML = `${signed(sessionProfit)} <small>cr</small>`;
  profitElement.classList.toggle('positive', sessionProfit > 0);
  profitElement.classList.toggle('negative', sessionProfit < 0);
  $('#round-count').textContent = String(round).padStart(2, '0');
}

function renderHistory() {
  const body = $('#history-body');
  if (history.length === 0) {
    body.innerHTML = '<tr class="empty-history"><td colspan="6">Your first spin starts the story. All results stay in this session.</td></tr>';
    return;
  }
  body.replaceChildren(...history.slice(-8).reverse().map((item) => {
    const tr = document.createElement('tr');
    const values = [String(item.round).padStart(2, '0'), item.source, credits(item.stake), `${item.multiplier}×`, credits(item.returned), signed(item.profit)];
    values.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = value;
      if (index === 1) td.className = 'source-cell';
      if (index === 5) td.className = item.profit > 0 ? 'positive' : item.profit < 0 ? 'negative' : '';
      tr.append(td);
    });
    return tr;
  }));
  $('.history-note').textContent = `Latest ${Math.min(history.length, 8)} of ${history.length} rounds · pretend credits`;
}

function showResult(multiplier, settlement, source) {
  const banner = $('#result-banner');
  banner.className = `result-banner ${multiplier > 1 ? 'win' : multiplier === 1 ? 'break-even' : 'loss'}`;
  $('#result-kicker').textContent = multiplier > 1 ? `${multiplier}× RETURN · ${source.toUpperCase()}` : multiplier === 1 ? `BET RETURNED · ${source.toUpperCase()}` : `NO RETURN · ${source.toUpperCase()}`;
  $('#result-text').textContent = multiplier > 1 ? `+${credits(settlement.profit)} pretend credits` : multiplier === 1 ? 'Back where you started.' : `−${credits(settlement.stake)} pretend credits`;
  $('#result-detail').textContent = `${credits(settlement.stake)} played · ${credits(settlement.returned)} returned, including your play amount`;
}

async function spin() {
  if (busy || balance < stake) return;
  busy = true;
  const multiplier = mode === 'random' ? pickOutcome(cryptoFloat()) : previewMultiplier();
  const settlement = resolveRound({ balance, stake, multiplier });
  const reels = makeReels(multiplier, cryptoFloat);
  const source = mode === 'directed' ? 'Directed' : mode === 'schedule' ? 'Scheduled' : 'Random draw';
  // The result and settlement are selected before any animation starts.
  $('#result-kicker').textContent = 'OUTCOME SELECTED · REELS REVEAL IT NEXT';
  $('#result-text').textContent = mode === 'random' ? 'A random result is on its way.' : `${multiplier}× has been selected by the code.`;
  $('#result-detail').textContent = 'The animation does not change the selected outcome.';
  $('#result-banner').className = 'result-banner';
  reelWindow.classList.remove('is-winning');
  document.querySelectorAll('.reel').forEach((reel) => reel.classList.remove('settled'));
  shell.classList.add('is-spinning');
  shell.setAttribute('aria-busy', 'true');
  refresh();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  await pause(reducedMotion ? 0 : 650);
  for (let index = 0; index < 3; index++) {
    renderColumn(index, reels[index]);
    $(`#reel-${index}`).classList.add('settled');
    if (index < 2) await pause(reducedMotion ? 0 : 160);
  }
  shell.classList.remove('is-spinning');
  shell.setAttribute('aria-busy', 'false');
  reelWindow.classList.toggle('is-winning', multiplier > 0);
  balance = settlement.balance;
  round++;
  if (mode === 'schedule') scheduleCounter++;
  history.push({ round, source, multiplier, ...settlement });
  showResult(multiplier, settlement, source);
  updateStats(settlement.returned);
  renderHistory();
  busy = false;
  refresh();
}

function resetDemo() {
  if (busy) return;
  balance = 100;
  round = 0;
  stake = 1;
  scheduleCounter = 0;
  history = [];
  mode = 'directed';
  modes.forEach((input) => input.checked = input.value === mode);
  $('#directed-outcome').value = '10';
  $('#schedule-every').value = '5';
  $('#schedule-outcome').value = '5';
  makeReels(10, cryptoFloat).forEach((symbols, index) => renderColumn(index, symbols));
  reelWindow.classList.remove('is-winning');
  $('#result-banner').className = 'result-banner';
  $('#result-kicker').textContent = "YOU'RE THE DIRECTOR";
  $('#result-text').textContent = 'Your next result is 10×';
  $('#result-detail').textContent = 'Set the outcome in the controls. Then give it a spin.';
  $('.history-note').textContent = 'Every decision, in the open.';
  updateStats();
  renderHistory();
  refresh();
}

modes.forEach((input) => input.addEventListener('change', () => {
  mode = input.value;
  scheduleCounter = 0;
  refresh();
}));
stakeButtons.forEach((button) => button.addEventListener('click', () => {
  stake = Number(button.dataset.stake);
  refresh();
}));
$('#directed-outcome').addEventListener('change', refresh);
['#schedule-every', '#schedule-outcome'].forEach((selector) => $(selector).addEventListener('change', () => {
  scheduleCounter = 0;
  refresh();
}));
spinButton.addEventListener('click', spin);
$('#reset-button').addEventListener('click', resetDemo);
document.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && !event.repeat && event.target === document.body) {
    event.preventDefault();
    spin();
  }
});
resetDemo();
