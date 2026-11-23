# SPDX-License-Identifier: MIT
"""DipCatcher v3: catch oversold dips in cbBTC/USDC, one minute at a time.

One-minute BTC is noisy, and a full round trip costs about 26-34 bps
once the 4 bps fee, the 2 bps modelled slippage and the pool impact are
all paid. So this bot trades rarely, and only into weakness it can
measure: it goes all-in when the market has just fallen hard *and* the
short-term selling is exhausted, then it leaves when strength comes
back, when the trade has paid, or when it has clearly failed. All
comparisons are exact integer comparisons on the raw integer prices the
harness sends, so two runs over the same bars emit byte-identical
orders. No randomness, no wall clock, no network, no files.

Buy (checked at every bar close, filled at the next bar's open), both
conditions at once:
  * the 20-bar RSI sits under 30 -- the last 20 one-minute moves are
    dominated by losses, so sellers look exhausted; and
  * the close is at least 1.2% under the highest close of the last
    120 bars -- the dip is real, not a single-minute wobble.

Sell the whole position, whichever comes first:
  * the 20-bar RSI climbs over 90 -- strength is back; or
  * the position is worth 1.5% more than it cost; or
  * the position is worth 1.5% less than it cost.
After a stop-out the bot rests for the next 60 bars: a market that
just stopped it out once is likely to do it again on a quick re-entry.

Parameters were chosen by a joint sweep over the two published dev
windows (btc-race-24h-20261118-1444, BTC -2.79%; and this race's window,
BTC +3.64%): these are the settings with the highest worst-window net
PnL of any DipCatcher combination -- about +$15 on BOTH windows
(5 trades, 0.64% max drawdown on the falling window; 4 trades, 1.30%
on the rising window), still about +$14 / +$13 with every fee doubled.
The previous race's settings (RSI 30/20, dip 60 bars) make $0 on this
race's window -- they never fire -- so they were not reused.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
import makefun_bars

ASSET = "CBBTC"

# Strategy knobs. RSI_N is the lookback for the RSI; BUY_RSI / SELL_RSI
# are its buy / sell levels; DIP_BARS / DIP_BPS define the dip (how far
# under the recent high the close must sit); WIN_BPS / LOSS_BPS are the
# take-profit / stop-loss; REST_BARS is the sit-out after a stop; SLIP_BPS
# is the max slippage allowed past the close the order was decided on.
RSI_N = 20
BUY_RSI = 30
SELL_RSI = 90
DIP_BARS = 120
DIP_BPS = 120
WIN_BPS = 150
LOSS_BPS = 150
REST_BARS = 60
SLIP_BPS = 100

# Closes seen so far, oldest first. One asset, one bar a minute.
_history = []
# Bar index of the most recent stop-out (-inf when there has been none).
_stopped_at = -10 ** 9


def _moves(n):
    """Total up-moves and down-moves (raw price units) over the last n
    one-minute changes, ending at the latest close."""
    up = 0
    down = 0
    first = len(_history) - n - 1
    for i in range(first + 1, len(_history)):
        step = _history[i] - _history[i - 1]
        if step > 0:
            up += step
        elif step < 0:
            down -= step
    return up, down


def _rsi_low(level):
    """True when RSI(RSI_N) < level, by exact integer comparison.

    RSI = 100 - 100 / (1 + up/down), so RSI < level means
    up/down < level / (100 - level), i.e. up * (100 - level) < down *
    level. With no down-moves at all the RSI is 100, never below.
    """
    up, down = _moves(RSI_N)
    if down == 0:
        return False
    return up * (100 - level) < down * level


def _rsi_high(level):
    """True when RSI(RSI_N) > level, by exact integer comparison.
    With no down-moves at all the RSI is 100, above any level < 100."""
    up, down = _moves(RSI_N)
    if down == 0:
        return level < 100
    return up * (100 - level) > down * level


def _in_dip():
    """True when the latest close is at least DIP_BPS below the highest
    close of the DIP_BARS bars before it (exact integer comparison)."""
    peak = max(_history[-DIP_BARS - 1:-1])
    return _history[-1] * 10000 <= peak * (10000 - DIP_BPS)


def _decide(state, batch):
    global _stopped_at
    for bar in batch["bars"]:
        if bar["symbol"] == ASSET:
            _history.append(int(bar["c"]))

    # Still warming up (or not enough history to read the indicators):
    # feed the indicators, send nothing.
    if len(_history) < max(RSI_N, DIP_BARS) + 1 or state.warming_up:
        return []

    holding = state.positions.get(ASSET)
    if holding is None:
        # Flat. Rest after a stop-out; otherwise buy the dip, all-in.
        if state.seq - _stopped_at < REST_BARS:
            return []
        if _rsi_low(BUY_RSI) and _in_dip():
            cash = state.cash
            floor = int(state.hello["fees"]["min_notional_quote_units"])
            if cash < floor:
                return []
            return [{"side": "buy", "symbol": ASSET,
                     "notional_quote_units": cash,
                     "max_slippage_bps": SLIP_BPS}]
        return []

    # Holding. Leave on strength, on the profit target, or on the stop
    # (the stop also starts the rest period).
    worth = state.value(ASSET, holding.qty)
    paid = holding.cost
    if _rsi_high(SELL_RSI):
        return [{"side": "sell", "symbol": ASSET, "qty": holding.qty,
                 "max_slippage_bps": SLIP_BPS}]
    if worth * 10000 >= paid * (10000 + WIN_BPS):
        return [{"side": "sell", "symbol": ASSET, "qty": holding.qty,
                 "max_slippage_bps": SLIP_BPS}]
    if worth * 10000 <= paid * (10000 - LOSS_BPS):
        _stopped_at = state.seq
        return [{"side": "sell", "symbol": ASSET, "qty": holding.qty,
                 "max_slippage_bps": SLIP_BPS}]
    return []


makefun_bars.run(_decide)
