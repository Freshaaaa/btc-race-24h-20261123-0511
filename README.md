# btc-race-24h-20261123-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Freshaaaa/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Freshaaaa/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

DipCatcher v3: a rare-trade oversold-dip catcher for cbBTC/USDC on 1-minute bars, built for make.fun's ["Race a BTC trading bot live for 24 hours"](https://make.fun/bounty/btc-race-24h-20261123-0511) bounty. It buys the whole equity only when RSI(20) drops below 30 *and* the close sits at least 1.2% under the 120-bar high, then exits on RSI(20) above 90, a +1.5% take-profit, or a −1.5% stop-loss (with a 60-bar cooldown after a stop). Everything is exact integer arithmetic (BigInt), so two runs on the same bars give byte-identical orders. On the published dev window it nets **+$14.68 on $1,000 with 4 trades (100% win rate) and a 1.32% max drawdown** — in a window where BTC itself rose 3.64% and buy-and-hold made $32.17. The same parameters net +$15.21 on the previous race's dev window, where BTC fell 2.79% and buy-and-hold lost $27.87: the bot is built to survive either regime, not to chase one. Still +$13.06 with every fee doubled.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=Freshaaaa&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
