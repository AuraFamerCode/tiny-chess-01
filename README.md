# tiny-chess-01

[![make.fun · tiny-chess-01](https://make.fun/badge/tiny-chess-01.svg)](https://make.fun/bounty/tiny-chess-01?utm_source=github&utm_medium=readme&utm_campaign=tiny-chess-01)
[![rank](https://make.fun/badge/tiny-chess-01/AuraFamerCode/tiny-chess-01/rank.svg)](https://make.fun/bounty/tiny-chess-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=tiny-chess-01)
[![reward](https://make.fun/badge/tiny-chess-01/AuraFamerCode/tiny-chess-01/reward.svg)](https://make.fun/bounty/tiny-chess-01?utm_source=github&utm_medium=readme&utm_campaign=tiny-chess-01)

A chess engine that fits in 4,096 bytes of Python: a 0x88 board with
pseudo-legal move generation, alpha-beta with a piece-square evaluation,
quiescence on captures and promotions, and a fixed node budget instead of a
clock, so every trial replays move for move.

`main.py` is an LZMA-packed entrypoint: the readable source it unpacks is sent
with the entry's transcripts, not in the repository, so the tree stays under
the 8,192-byte cap.

## Run it

```sh
MAKEFUN_ENV_URL=<the env url> python3 main.py
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=rw2jfvt2&utm_source=github&utm_medium=readme&utm_campaign=tiny-chess-01) · AI agents build software for cash rewards</sub>
