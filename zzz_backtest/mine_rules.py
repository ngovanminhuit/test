"""Khai phá quy luật vào lệnh trên BTC 4h (huấn luyện <2023, kiểm tra >=2023), rồi thử trên SUI 4h (chưa từng dùng để chọn)."""
import os, itertools
import numpy as np, pandas as pd

RR = float(os.environ.get('RR', 1.5)); FEE = float(os.environ.get('FEE', 0.1))  # % phí khứ hồi
SPLIT = pd.Timestamp(os.environ.get('SPLIT', '2023-01-01'), tz='UTC')
OOS = os.environ.get('OOS', 'SUIUSDT')
FEATS = ['rsi', 'dist_sma64', 'dist_sma128', 'dist_ema20', 'sma_gap', 'bb_pos', 'bb_width', 'atr_pct', 'vol_rel',
         'pullback20', 'ret6', 'ret20', 'candle_dir', 'close_pos', 'rsi_d1', 'd1_age', 'tf_agree', 'range_atr']

def load(sym):
    d = pd.read_csv(f'results/zzz/mine_{sym}.csv')
    d['t'] = pd.to_datetime(d.t, unit='ms', utc=True)
    cost = FEE / d.risk_pct                      # phí tính theo R
    d['r'] = np.where(d.win == 1, RR, -1.0) - cost
    return d

btc, oos = load('BTCUSDT'), load(OOS)
tr, va = btc[btc.t < SPLIT].reset_index(drop=True), btc[btc.t >= SPLIT].reset_index(drop=True)

def run(d, mask):
    """Vào lệnh khi điều kiện đúng và chưa có lệnh đang mở (không chồng lệnh). Trả về mảng R ròng."""
    idx = np.flatnonzero(mask); i = d.i.values; o = d.out_idx.values; r = d.r.values
    busy = -1; res = []
    for k in idx:
        if i[k] > busy:
            res.append(r[k]); busy = o[k]
    return np.array(res)

def summ(x):
    n = len(x)
    if n < 2: return n, 0.0, 0.0, 0.0
    m = x.mean(); sd = x.std(ddof=1)
    return n, m, (m / (sd / np.sqrt(n)) if sd > 0 else 0.0), (x > 0).mean() * 100

qs = [0.2, 0.4, 0.6, 0.8]
conds = []
for f in FEATS:
    for q in qs:
        th = float(tr[f].quantile(q))
        conds += [(f, '>=', th), (f, '<=', th)]
def mk(d, c):
    f, op, th = c
    return (d[f] >= th).values if op == '>=' else (d[f] <= th).values
def name(rule): return ' & '.join(f'{f} {op} {th:.3g}' for f, op, th in rule)

rules = [(c,) for c in conds]
for a, b in itertools.combinations(conds, 2):
    if a[0] != b[0]: rules.append((a, b))
MT = {c: mk(tr, c) for c in conds}
MV = {c: mk(va, c) for c in conds}
MO = {c: mk(oos, c) for c in conds}
def mask(M, rule):
    m = M[rule[0]]
    for c in rule[1:]: m = m & M[c]
    return m

base_tr, base_va, base_oo = run(tr, np.ones(len(tr), bool)), run(va, np.ones(len(va), bool)), run(oos, np.ones(len(oos), bool))
out = [f'# Khai phá quy luật vào lệnh · huấn luyện BTC 4h → kiểm tra BTC → thử {OOS} 4h\n',
       f'- Hướng lệnh = hướng D1. SL = 1,5 ATR, TP = {RR} × SL (hòa vốn ở {100/(1+RR):.0f}% trước phí). Phí khứ hồi {FEE}% (đã trừ vào R). Không chồng lệnh. Nến chạm cả SL và TP = thua.',
       f'- Huấn luyện BTC: trước {SPLIT.date()}; kiểm tra BTC: từ ngày đó; **{OOS} không dùng để chọn quy luật** (chỉ để thử cuối).',
       f'- Số quy luật thử: {len(rules)} (1–2 điều kiện, ngưỡng theo phân vị 20/40/60/80% của huấn luyện BTC).\n',
       '## Đường cơ sở (vào mọi tín hiệu theo hướng D1, không điều kiện)\n',
       '| Tập | Lệnh | R/lệnh | t | Thắng% |', '|---|---|---|---|---|']
for nm, x in [('BTC huấn luyện', base_tr), ('BTC kiểm tra', base_va), (OOS, base_oo)]:
    n, m, t, w = summ(x); out.append(f'| {nm} | {n} | {m:.3f} | {t:.2f} | {w:.1f} |')

rows = []
for rl in rules:
    x = run(tr, mask(MT, rl))
    if len(x) < 60: continue
    n, m, t, w = summ(x)
    xv = run(va, mask(MV, rl)); xo = run(oos, mask(MO, rl))
    nv, mv, tv, wv = summ(xv); no, mo, to, wo = summ(xo)
    rows.append(dict(rule=name(rl), trn=n, trm=m, trt=t, van=nv, vam=mv, vat=tv, oon=no, oom=mo, oot=to, oow=wo, _rl=rl))
R = pd.DataFrame(rows).sort_values('trt', ascending=False)
sel = R[(R.trt >= 2)]
s2 = sel[(sel.van >= 15) & (sel.vam > 0)]
s3 = s2[(s2.oon >= 10) & (s2.oom > 0)]
out += ['\n## Phễu lọc\n',
        f'- Quy luật đủ lệnh huấn luyện (≥60): {len(R)}',
        f'- Có R/lệnh ròng > 0 và t ≥ 2 ở huấn luyện: {len(sel)} (kỳ vọng do may mắn thuần túy với {len(R)} phép thử: khoảng {0.0228*len(R):.0f})',
        f'- Trong đó vẫn > 0 ở BTC kiểm tra (≥15 lệnh): {len(s2)}',
        f'- Trong đó vẫn > 0 trên {OOS} (≥10 lệnh): {len(s3)}\n']
fmt = lambda r: f"| {r.rule} | {r.trn} | {r.trm:.3f} | {r.trt:.1f} | {r.van} | {r.vam:.3f} | {r.oon} | {r.oom:.3f} | {r.oow:.0f} |"
hdr = ['| Quy luật | HL lệnh | HL R/lệnh | HL t | KT lệnh | KT R/lệnh | ' + OOS + ' lệnh | ' + OOS + ' R/lệnh | ' + OOS + ' thắng% |', '|' + '---|' * 9]
out += ['## Top 15 theo huấn luyện (xem kiểm tra và ' + OOS + ')\n'] + hdr + [fmt(r) for r in R.head(15).itertuples()]
out += ['\n## Quy luật sống sót qua BTC kiểm tra (chọn tiếp theo t huấn luyện)\n'] + hdr + [fmt(r) for r in s2.head(15).itertuples()]
if len(s2):
    best = s2.iloc[0]; rl = best._rl
    xo = run(oos, mask(MO, rl)); oo = oos[mask(MO, rl)]
    n, m, t, w = summ(xo)
    # đối chứng ngẫu nhiên: n lệnh ngẫu nhiên từ mọi tín hiệu SUI
    rng = np.random.default_rng(1); allr = oos.r.values
    sims = np.array([rng.choice(allr, size=max(n, 1), replace=False).mean() for _ in range(10000)])
    p = (sims >= m).mean() if n else 1.0
    out += [f'\n## Thử cuối trên {OOS}: quy luật tốt nhất sau lọc BTC\n', f'`{best.rule}`\n',
            f'- Lệnh: {n}, R ròng/lệnh {m:.3f}, t {t:.2f}, thắng {w:.1f}% (hòa vốn ~{100/(1+RR):.0f}% + phí).',
            f'- Đối chứng ngẫu nhiên (cùng số lệnh, 10.000 lần): p = {p:.3f}. Số quy luật sống sót qua BTC: {len(s2)} → ngưỡng Bonferroni cho bước này ≈ {0.05/max(len(s2),1):.4f}.']
open('results/zzz/rules.md', 'w').write('\n'.join(out))
R.drop(columns=['_rl']).to_csv('results/zzz/rules_all.csv', index=False)
print('\n'.join(out))
