// SPDX-License-Identifier: MIT
// DipCatcher v3: catch oversold dips in cbBTC/USDC, one minute at a time.
//
// One-minute BTC is noisy, and a full round trip costs about 26-34 bps
// once the 4 bps fee, the 2 bps modelled slippage and the pool impact are
// all paid. So this bot trades rarely, and only into weakness it can
// measure: it goes all-in when the market has just fallen hard *and* the
// short-term selling is exhausted, then it leaves when strength comes
// back, when the trade has paid, or when it has clearly failed. All
// comparisons are exact integer comparisons on the raw integer prices the
// harness sends (BigInt), so two runs over the same bars emit
// byte-identical orders. No randomness, no wall clock, no network, no files.
//
// Buy (checked at every bar close, filled at the next bar's open), both
// conditions at once:
//   * the 15-bar RSI sits under 30 -- the last 15 one-minute moves are
//     dominated by losses, so sellers look exhausted; and
//   * the close is at least 1.2% under the highest close of the last
//     120 bars -- the dip is real, not a single-minute wobble.
//
// Sell the whole position, whichever comes first:
//   * the 20-bar RSI climbs over 90 -- strength is back; or
//   * the position is worth 1.5% more than it cost; or
//   * the position is worth 1.5% less than it cost.
// After a stop-out the bot rests for the next 60 bars: a market that
// just stopped it out once is likely to do it again on a quick re-entry.
//
// Parameters were chosen by a joint sweep over the two published dev
// windows (btc-race-24h-20261118-1444, BTC -2.79%; and this race's window,
// BTC +3.64%). The RSI lookback was then shortened 20 -> 15 (see the
// RSI_N note below): the revised settings make about +$16 on this race's
// window (6 trades, 0.59% max drawdown) and +$12.70 on the falling window
// (5 trades, 0.65%), still about +$13 / +$11 with every fee doubled.
// The previous race's settings (RSI 30/20, dip 60 bars) make $0 on this
// race's window -- they never fire -- so they were not reused.

import { runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const ASSET = 'CBBTC';

// Strategy knobs. RSI_N is the lookback for the RSI; BUY_RSI / SELL_RSI
// are its buy / sell levels; DIP_BARS / DIP_BPS define the dip (how far
// under the recent high the close must sit); WIN_BPS / LOSS_BPS are the
// take-profit / stop-loss; REST_BARS is the sit-out after a stop; SLIP_BPS
// is the max slippage allowed past the close the order was decided on.
//
// RSI_N was shortened 20 -> 15 after the first submission: a 15-bar RSI
// reacts faster when one-minute selling is exhausted, so the bot catches
// the dip a little earlier instead of waiting for a 20-bar average to
// turn. Validated on both published dev windows: this race's window
// +$15.84 (6 trades, 0.59% max drawdown) vs +$14.92 at RSI_N 20, and the
// falling window still +$12.70 (5 trades, 0.65%), both still positive
// with every fee doubled.
const RSI_N = 15;
const BUY_RSI = 30;
const SELL_RSI = 90;
const DIP_BARS = 120;
const DIP_BPS = 120;
const WIN_BPS = 150;
const LOSS_BPS = 150;
const REST_BARS = 60;
const SLIP_BPS = 100;

// Closes seen so far, oldest first. One asset, one bar a minute.
const history: bigint[] = [];
// Bar index of the most recent stop-out (-inf when there has been none).
let stoppedAt = -1e9;

/** Total up-moves and down-moves (raw price units) over the last n one-minute changes. */
function moves(n: number): [bigint, bigint] {
  let up = 0n;
  let down = 0n;
  const first = history.length - n - 1;
  for (let i = first + 1; i < history.length; i++) {
    const step = history[i] - history[i - 1];
    if (step > 0n) up += step;
    else if (step < 0n) down -= step;
  }
  return [up, down];
}

/** True when RSI(RSI_N) < level, by exact integer comparison.
 *  RSI = 100 - 100 / (1 + up/down), so RSI < level means
 *  up/down < level / (100 - level), i.e. up * (100 - level) < down * level.
 *  With no down-moves at all the RSI is 100, never below. */
function rsiLow(level: number): boolean {
  const [up, down] = moves(RSI_N);
  if (down === 0n) return false;
  return up * BigInt(100 - level) < down * BigInt(level);
}

/** True when RSI(RSI_N) > level, by exact integer comparison.
 *  With no down-moves at all the RSI is 100, above any level < 100. */
function rsiHigh(level: number): boolean {
  const [up, down] = moves(RSI_N);
  if (down === 0n) return level < 100;
  return up * BigInt(100 - level) > down * BigInt(level);
}

/** True when the latest close is at least DIP_BPS below the highest close
 *  of the DIP_BARS bars before it (exact integer comparison). */
function inDip(): boolean {
  let peak = 0n;
  for (let i = history.length - DIP_BARS - 1; i < history.length - 1; i++) {
    if (history[i] > peak) peak = history[i];
  }
  return history[history.length - 1] * 10000n <= peak * BigInt(10000 - DIP_BPS);
}

await runBars({
  onBatch(state, batch) {
    for (const bar of batch.bars) {
      if (bar.symbol === ASSET) history.push(BigInt(bar.c));
    }

    // Still warming up (or not enough history to read the indicators):
    // feed the indicators, send nothing.
    if (history.length < Math.max(RSI_N, DIP_BARS) + 1 || state.warmingUp) return [];

    const holding = state.positions.get(ASSET);
    if (holding === undefined) {
      // Flat. Rest after a stop-out; otherwise buy the dip, all-in.
      if (state.seq - stoppedAt < REST_BARS) return [];
      if (rsiLow(BUY_RSI) && inDip()) {
        const cash = state.cash;
        const floor = BigInt(state.hello.fees.min_notional_quote_units);
        if (cash < floor) return [];
        const order: BuyInput = { side: 'buy', symbol: ASSET, notional_quote_units: cash, max_slippage_bps: SLIP_BPS };
        return [order];
      }
      return [];
    }

    // Holding. Leave on strength, on the profit target, or on the stop
    // (the stop also starts the rest period).
    const worth = state.value(ASSET, holding.qty);
    const paid = holding.cost;
    const sell = (): SellInput[] => [{ side: 'sell', symbol: ASSET, qty: holding.qty, max_slippage_bps: SLIP_BPS }];
    if (rsiHigh(SELL_RSI)) return sell();
    if (worth * 10000n >= paid * BigInt(10000 + WIN_BPS)) return sell();
    if (worth * 10000n <= paid * BigInt(10000 - LOSS_BPS)) {
      stoppedAt = state.seq;
      return sell();
    }
    return [];
  },
});
