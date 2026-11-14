"""tiny-chess-01: an alpha-beta chess engine over a 0x88 board.

The entry is main.py, packed from this file: standard library only, no clock
in the search (a fixed node budget per move), so every trial replays exactly.
"""
import json
import os
import sys
import urllib.request

PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING = 1, 2, 3, 4, 5, 6
VALUE = (0, 100, 320, 330, 500, 900, 0)
KNIGHT_OFF = (-33, -31, -18, -14, 14, 18, 31, 33)
KING_OFF = (-17, -16, -15, -1, 1, 15, 16, 17)
BISHOP_OFF = (-17, -15, 15, 17)
ROOK_OFF = (-16, -1, 1, 16)
STEP = {KNIGHT: KNIGHT_OFF, KING: KING_OFF}
SLIDE = {BISHOP: BISHOP_OFF, ROOK: ROOK_OFF, QUEEN: BISHOP_OFF + ROOK_OFF}
PIECES = {"P": 1, "N": 2, "B": 3, "R": 4, "Q": 5, "K": 6,
          "p": -1, "n": -2, "b": -3, "r": -4, "q": -5, "k": -6}
CASTLE_RIGHTS = {7: 1, 0: 2, 119: 4, 112: 8}
FILES = "abcdefgh"
INF = 30000
MATE = 20000
NODE_BUDGET = int(os.environ.get("ENGINE_NODES") or 90000)

NODES = 0


def flatten(rows):
    """Rank-8-first rows to a table indexed from a1."""
    return tuple(v for row in reversed(rows) for v in row)


PST = {
    PAWN: flatten((
        (0, 0, 0, 0, 0, 0, 0, 0),
        (50, 50, 50, 50, 50, 50, 50, 50),
        (10, 10, 20, 30, 30, 20, 10, 10),
        (5, 5, 10, 25, 25, 10, 5, 5),
        (0, 0, 0, 20, 20, 0, 0, 0),
        (5, -5, -10, 0, 0, -10, -5, 5),
        (5, 10, 10, -20, -20, 10, 10, 5),
        (0, 0, 0, 0, 0, 0, 0, 0))),
    KNIGHT: flatten((
        (-50, -40, -30, -30, -30, -30, -40, -50),
        (-40, -20, 0, 0, 0, 0, -20, -40),
        (-30, 0, 10, 15, 15, 10, 0, -30),
        (-30, 5, 15, 20, 20, 15, 5, -30),
        (-30, 0, 15, 20, 20, 15, 0, -30),
        (-30, 5, 10, 15, 15, 10, 5, -30),
        (-40, -20, 0, 5, 5, 0, -20, -40),
        (-50, -40, -30, -30, -30, -30, -40, -50))),
    BISHOP: flatten((
        (-20, -10, -10, -10, -10, -10, -10, -20),
        (-10, 0, 0, 0, 0, 0, 0, -10),
        (-10, 0, 5, 10, 10, 5, 0, -10),
        (-10, 5, 5, 10, 10, 5, 5, -10),
        (-10, 0, 10, 10, 10, 10, 0, -10),
        (-10, 10, 10, 10, 10, 10, 10, -10),
        (-10, 5, 0, 0, 0, 0, 5, -10),
        (-20, -10, -10, -10, -10, -10, -10, -20))),
    ROOK: flatten((
        (0, 0, 0, 0, 0, 0, 0, 0),
        (5, 10, 10, 10, 10, 10, 10, 5),
        (-5, 0, 0, 0, 0, 0, 0, -5),
        (-5, 0, 0, 0, 0, 0, 0, -5),
        (-5, 0, 0, 0, 0, 0, 0, -5),
        (-5, 0, 0, 0, 0, 0, 0, -5),
        (-5, 0, 0, 0, 0, 0, 0, -5),
        (0, 0, 0, 5, 5, 0, 0, 0))),
    QUEEN: flatten((
        (-20, -10, -10, -5, -5, -10, -10, -20),
        (-10, 0, 0, 0, 0, 0, 0, -10),
        (-10, 0, 5, 5, 5, 5, 0, -10),
        (-5, 0, 5, 5, 5, 5, 0, -5),
        (0, 0, 5, 5, 5, 5, 0, -5),
        (-10, 5, 5, 5, 5, 5, 0, -10),
        (-10, 0, 5, 0, 0, 0, 0, -10),
        (-20, -10, -10, -5, -5, -10, -10, -20))),
    KING: flatten((
        (-30, -40, -40, -50, -50, -40, -40, -30),
        (-30, -40, -40, -50, -50, -40, -40, -30),
        (-30, -40, -40, -50, -50, -40, -40, -30),
        (-30, -40, -40, -50, -50, -40, -40, -30),
        (-20, -30, -30, -40, -40, -30, -30, -20),
        (-10, -20, -20, -20, -20, -20, -20, -10),
        (20, 20, 0, 0, 0, 0, 20, 20),
        (20, 30, 10, 0, 0, 10, 30, 20))),
}


def square64(s):
    return (s >> 4) * 8 + (s & 7)


WHITE_VALUE = {t: tuple(0 if s & 0x88 else VALUE[t] + PST[t][square64(s)]
                        for s in range(128)) for t in PST}
BLACK_VALUE = {t: tuple(0 if s & 0x88 else VALUE[t] + PST[t][square64(s ^ 0x70)]
                        for s in range(128)) for t in PST}


def pv(p, s):
    """The white-relative value of piece p on square s."""
    return WHITE_VALUE[p][s] if p > 0 else -BLACK_VALUE[-p][s]


def evaluate(b):
    e = 0
    for s in range(128):
        p = b[s]
        if p:
            e += pv(p, s)
    return e


def parse(fen):
    """A FEN to (board, side, castling rights, en passant square)."""
    parts = fen.split()
    b = [0] * 128
    rank, file = 7, 0
    for c in parts[0]:
        if c == "/":
            rank, file = rank - 1, 0
        elif c.isdigit():
            file += int(c)
        else:
            b[rank * 16 + file] = PIECES[c]
            file += 1
    side = 1 if parts[1] == "w" else -1
    cast = 0
    for c, bit in (("K", 1), ("Q", 2), ("k", 4), ("q", 8)):
        if c in parts[2]:
            cast |= bit
    ep = 0
    if len(parts) > 3 and parts[3] != "-":
        ep = (int(parts[3][1]) - 1) * 16 + FILES.index(parts[3][0])
    return b, side, cast, ep


def attacked(b, s, by):
    """Is square s attacked by the side `by` (1 white, -1 black)?"""
    for d in KNIGHT_OFF:
        q = s + d
        if not q & 0x88 and b[q] == by * KNIGHT:
            return True
    for d in KING_OFF:
        q = s + d
        if not q & 0x88 and b[q] == by * KING:
            return True
    for d in (-15, -17) if by > 0 else (15, 17):
        q = s + d
        if not q & 0x88 and b[q] == by * PAWN:
            return True
    for d in ROOK_OFF:
        q = s + d
        while not q & 0x88:
            v = b[q]
            if v:
                if v == by * ROOK or v == by * QUEEN:
                    return True
                break
            q += d
    for d in BISHOP_OFF:
        q = s + d
        while not q & 0x88:
            v = b[q]
            if v:
                if v == by * BISHOP or v == by * QUEEN:
                    return True
                break
            q += d
    return False


def gen(b, side, ep, cast):
    """Every pseudo-legal move as (from, to, promotion piece, flag)."""
    moves = []
    for s in range(128):
        if s & 0x88:
            continue
        p = b[s]
        if not p or (p > 0) != (side > 0):
            continue
        t = p if p > 0 else -p
        if t == PAWN:
            d = 16 if p > 0 else -16
            last = 7 if p > 0 else 0
            one = s + d
            if not one & 0x88 and not b[one]:
                if one >> 4 == last:
                    for pr in (QUEEN, ROOK, BISHOP, KNIGHT):
                        moves.append((s, one, pr, 0))
                else:
                    moves.append((s, one, 0, 0))
                    two = one + d
                    if s >> 4 == (1 if p > 0 else 6) and not b[two]:
                        moves.append((s, two, 0, 0))
            for d in (d - 1, d + 1):
                to = s + d
                if to & 0x88:
                    continue
                q = b[to]
                if q and (q > 0) != (p > 0):
                    if to >> 4 == last:
                        for pr in (QUEEN, ROOK, BISHOP, KNIGHT):
                            moves.append((s, to, pr, 0))
                    else:
                        moves.append((s, to, 0, 0))
                elif to == ep and ep:
                    moves.append((s, to, 0, 1))
        elif t in STEP:
            for d in STEP[t]:
                to = s + d
                if to & 0x88:
                    continue
                q = b[to]
                if not q or (q > 0) != (p > 0):
                    moves.append((s, to, 0, 0))
        else:
            for d in SLIDE[t]:
                to = s + d
                while not to & 0x88:
                    q = b[to]
                    if q:
                        if (q > 0) != (p > 0):
                            moves.append((s, to, 0, 0))
                        break
                    moves.append((s, to, 0, 0))
                    to += d
    if side > 0:
        if cast & 1 and not b[5] and not b[6] and not (
                attacked(b, 4, -1) or attacked(b, 5, -1) or attacked(b, 6, -1)):
            moves.append((4, 6, 0, 2))
        if cast & 2 and not b[1] and not b[2] and not b[3] and not (
                attacked(b, 4, -1) or attacked(b, 3, -1) or attacked(b, 2, -1)):
            moves.append((4, 2, 0, 2))
    else:
        if cast & 4 and not b[117] and not b[118] and not (
                attacked(b, 116, 1) or attacked(b, 117, 1) or attacked(b, 118, 1)):
            moves.append((116, 118, 0, 2))
        if cast & 8 and not b[113] and not b[114] and not b[115] and not (
                attacked(b, 116, 1) or attacked(b, 115, 1) or attacked(b, 114, 1)):
            moves.append((116, 114, 0, 2))
    return moves


def apply(b, m, ep, cast, ev):
    """Play a move: (board, en passant, castling rights, evaluation) after it."""
    f, t, pr, fl = m
    p = b[f]
    nb = b[:]
    nb[f] = 0
    ev -= pv(p, f)
    cap = b[t]
    if cap:
        ev -= pv(cap, t)
    if fl == 1:
        cs = t - 16 if p > 0 else t + 16
        victim = b[cs]
        ev -= pv(victim, cs)
        nb[cs] = 0
    if fl == 2:
        rs = t + (1 if t > f else -2)
        rd = t + (-1 if t > f else 1)
        rp = nb[rs]
        nb[rs] = 0
        nb[rd] = rp
        ev += pv(rp, rd) - pv(rp, rs)
    np_ = p if not pr else (pr if p > 0 else -pr)
    nb[t] = np_
    ev += pv(np_, t)
    ncast = cast
    if abs(p) == KING:
        ncast &= 12 if p > 0 else 3
    if f in CASTLE_RIGHTS:
        ncast &= ~CASTLE_RIGHTS[f]
    if t in CASTLE_RIGHTS:
        ncast &= ~CASTLE_RIGHTS[t]
    nep = 0
    if abs(p) == PAWN and abs(t - f) == 32:
        nep = (f + t) // 2
    return nb, nep, ncast, ev


def order(moves, b):
    """Captures first by MVV-LVA, then promotions, then the rest."""
    def key(m):
        victim = b[m[1]]
        s = 0
        if victim:
            s = 10 * VALUE[victim if victim > 0 else -victim] - VALUE[abs(b[m[0]])]
        if m[2]:
            s += 800
        return -s
    moves.sort(key=key)


class Limit(Exception):
    pass


def search(b, side, depth, alpha, beta, ep, cast, ev, ply, hist):
    global NODES
    NODES += 1
    if NODES > BUDGET:
        raise Limit
    check = attacked(b, b.index(side * KING), -side)
    if depth <= 0:
        return quiesce(b, side, alpha, beta, ep, cast, ev, ply, hist)
    key = (tuple(b), side, cast, ep)
    if key in hist:
        return 0
    hist = hist + [key]
    moves = gen(b, side, ep, cast)
    order(moves, b)
    best = -INF
    legal = 0
    for m in moves:
        nb, nep, ncast, nev = apply(b, m, ep, cast, ev)
        if attacked(nb, nb.index(side * KING), -side):
            continue
        legal += 1
        score = -search(nb, -side, depth - 1, -beta, -alpha,
                        nep, ncast, nev, ply + 1, hist)
        if score > best:
            best = score
        if score > alpha:
            alpha = score
        if alpha >= beta:
            break
    if not legal:
        return -MATE + ply if check else 0
    return best


def quiesce(b, side, alpha, beta, ep, cast, ev, ply, hist):
    global NODES
    NODES += 1
    if NODES > BUDGET:
        raise Limit
    stand = ev if side > 0 else -ev
    if stand >= beta or ply > 24:
        return stand
    if stand > alpha:
        alpha = stand
    moves = [m for m in gen(b, side, ep, cast) if b[m[1]] or m[2] or m[3] == 1]
    order(moves, b)
    for m in moves:
        nb, nep, ncast, nev = apply(b, m, ep, cast, ev)
        if attacked(nb, nb.index(side * KING), -side):
            continue
        score = -quiesce(nb, -side, -beta, -alpha, nep, ncast, nev, ply + 1, hist)
        if score >= beta:
            return beta
        if score > alpha:
            alpha = score
    return alpha


def uci(m):
    f, t, pr, _ = m
    s = FILES[f & 7] + str((f >> 4) + 1) + FILES[t & 7] + str((t >> 4) + 1)
    return s + (" pnbrqk"[pr] if pr else "")


def think(fen, allowed=None):
    """The best move in the position, searched to a fixed node budget."""
    global NODES, BUDGET
    b, side, cast, ep = parse(fen)
    ev = evaluate(b)
    root = gen(b, side, ep, cast)
    if allowed:
        root = [m for m in root if uci(m) in allowed] or root
    if not root:
        return None
    order(root, b)
    best = root[0]
    NODES = 0
    BUDGET = NODE_BUDGET
    for depth in range(1, 10):
        alpha = -INF
        current = None
        try:
            for m in root:
                nb, nep, ncast, nev = apply(b, m, ep, cast, ev)
                if attacked(nb, nb.index(side * KING), -side):
                    continue
                score = -search(nb, -side, depth - 1, -INF, -alpha,
                                nep, ncast, nev, 1, [])
                if current is None or score > alpha:
                    alpha = score
                    current = m
        except Limit:
            break
        if current is None:
            break
        best = current
        root.remove(best)
        root.insert(0, best)
        if abs(alpha) > MATE - 200:
            break
    return uci(best)


def post(path, body):
    """POST a JSON body to the env and return its JSON answer."""
    req = urllib.request.Request(
        ENV + path, data=json.dumps(body).encode(),
        headers={"content-type": "application/json"})
    with urllib.request.urlopen(req) as res:
        return json.load(res)


def main():
    while True:
        g = post("/game", {})
        if g.get("status") == "done":
            break
        while g.get("status") == "your_move":
            move = think(g["fen"], set(g.get("legal_moves") or ()))
            if not move:
                break
            g = post("/move", {"game": g["game"], "move": move})
    print("done", g.get("wins"), g.get("draws"), g.get("losses"), file=sys.stderr)


ENV = os.environ.get("MAKEFUN_ENV_URL", "")
BUDGET = NODE_BUDGET

if __name__ == "__main__":
    main()
