"""Dev harness: perft correctness and search speed for src/engine.py."""
import sys
import time

sys.path.insert(0, "src")
import engine


def perft(b, side, cast, ep, depth):
    if depth == 0:
        return 1
    n = 0
    for m in engine.gen(b, side, ep, cast):
        nb, nep, ncast, nev = engine.apply(b, m, ep, cast, 0)
        if engine.attacked(nb, nb.index(side * engine.KING), -side):
            continue
        n += perft(nb, -side, ncast, nep, depth - 1)
    return n


EXPECT = {1: 20, 2: 400, 3: 8902, 4: 197281}
b, side, cast, ep = engine.parse(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
for d, want in EXPECT.items():
    t = time.time()
    got = perft(b, side, cast, ep, d)
    print(f"perft {d}: {got} (want {want}) {'OK' if got == want else 'MISMATCH'} "
          f"{time.time() - t:.2f}s")

# Kiwipete, a position with castling, pins and en passant.
b, side, cast, ep = engine.parse(
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1")
for d, want in {1: 48, 2: 2039}.items():
    got = perft(b, side, cast, ep, d)
    print(f"kiwipete {d}: {got} (want {want}) {'OK' if got == want else 'MISMATCH'}")

FEN = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1"
for budget in (90000, 200000):
    engine.NODE_BUDGET = budget
    t = time.time()
    best = engine.think(FEN)
    dt = time.time() - t
    print(f"budget {budget}: {best} in {dt:.2f}s -> {budget / dt:,.0f} nodes/s")
