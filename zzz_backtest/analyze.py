"""Phân tích điểm chung / khác biệt giữa lệnh thắng và thua của zzz (BTC 4h), có kiểm chứng ngoài mẫu."""
import os
import pandas as pd, numpy as np
TAG = os.environ.get('TAG', '')
SPLIT_STR = os.environ.get('SPLIT', '2023-01-01')
from scipy import stats
from statsmodels.stats.multitest import multipletests

df = pd.read_csv(f'results/zzz/trades_features{TAG}.csv')
RR = 1.5
df['win'] = (df.result == 'win').astype(int)
df['t'] = pd.to_datetime(df.entry_time)
SPLIT = pd.Timestamp(SPLIT_STR, tz='UTC')
train, test = df[df.t < SPLIT], df[df.t >= SPLIT]
out = []
P = out.append

def stat(d):
    n = len(d); w = d.win.sum()
    return n, w, (w / n * 100 if n else 0), (w * RR - (n - w)), ((w * RR - (n - w)) / n if n else 0)

P('# Phân tích lệnh thắng / thua · zzz BTC 4h (R:R 1,5)\n')
n, w, wr, tot, ex = stat(df)
P(f'- Tổng {n} lệnh đã đóng: thắng {w} ({wr:.1f}%), tổng R {tot:.1f}, R/lệnh {ex:.3f}. Hòa vốn ở 40%.')
P(f'- Huấn luyện (trước mốc tách): {stat(train)[0]} lệnh, thắng {stat(train)[2]:.1f}%, R/lệnh {stat(train)[4]:.3f}. Kiểm tra (từ mốc tách): {stat(test)[0]} lệnh, thắng {stat(test)[2]:.1f}%, R/lệnh {stat(test)[4]:.3f}.\n')

# 1. Mô tả MFE/MAE
P('## 1. Hành vi sau khi vào lệnh (MFE/MAE tính theo R)')
for name, d in [('Thắng', df[df.win == 1]), ('Thua', df[df.win == 0])]:
    P(f'- {name} ({len(d)}): MFE trung vị {d.mfe_r.median():.2f}R, MAE trung vị {d.mae_r.median():.2f}R, số nến giữ lệnh trung vị {d.bars_held.median():.0f}')
los = df[df.win == 0]
P(f'- Trong các lệnh thua: {(los.mfe_r >= 0.5).mean()*100:.0f}% từng chạy ≥ +0,5R, {(los.mfe_r >= 1.0).mean()*100:.0f}% từng chạy ≥ +1R trước khi bị cắt lỗ.')
P(f'- Thua mất ≤ 3 nến: {(los.bars_held <= 3).mean()*100:.0f}%; ≤ 6 nến: {(los.bars_held <= 6).mean()*100:.0f}%.\n')

# 2. So sánh đặc điểm thắng vs thua (Mann-Whitney + FDR) toàn bộ, rồi kiểm tra ngoài mẫu
feats = ['risk_pct', 'risk_atr', 'rsi', 'rsi_d1', 'dist_sma128_pct', 'sma_gap_pct', 'bb_width_pct', 'bb_pos', 'ema20_dist_pct', 'atr_pct',
         'vol_rel', 'body_atr', 'range_atr', 'd1_age', 'ret_20_pct', 'ret_d1_10_pct', 'hour', 'dow']
rows = []
for f in feats:
    a = df[df.win == 1][f].dropna(); b = df[df.win == 0][f].dropna()
    if len(a) < 5 or len(b) < 5: continue
    u, p = stats.mannwhitneyu(a, b)
    auc = u / (len(a) * len(b))
    rows.append((f, a.median(), b.median(), auc, p))
res = pd.DataFrame(rows, columns=['đặc điểm', 'trung vị THẮNG', 'trung vị THUA', 'AUC', 'p'])
res['p_FDR'] = multipletests(res.p, method='fdr_bh')[1]
res = res.sort_values('p')
P('## 2. Đặc điểm khác biệt giữa thắng và thua (toàn bộ lệnh)')
P('AUC 0,5 = không phân biệt được; càng xa 0,5 càng phân biệt. p_FDR đã hiệu chỉnh nhiều phép thử.\n')
P(res.round(4).to_markdown(index=False) + '\n')

# 3. Tỷ lệ thắng theo nhóm rời rạc
P('## 3. Tỷ lệ thắng theo nhóm')
def grp(name, col):
    t = df.groupby(col).apply(lambda d: pd.Series({'lệnh': len(d), 'thắng%': d.win.mean()*100, 'R/lệnh': (d.win.sum()*RR-(len(d)-d.win.sum()))/len(d)}), include_groups=False)
    P(f'\n**{name}**\n\n' + t.round(2).to_markdown() + '\n')
grp('Kênh', 'channel'); grp('Hướng', 'direction'); grp('Xu hướng khung 4h khi vào', 'tf_trend'); grp('Năm', 'year')
df['d1_age_bin'] = pd.cut(df.d1_age, [0, 20, 60, 120, 250, 5000])
grp('Tuổi xu hướng D1 (số ngày)', 'd1_age_bin')
df['hour_bin'] = pd.cut(df.hour, [-1, 3, 7, 11, 15, 19, 23])
grp('Giờ UTC', 'hour_bin')
df['risk_bin'] = pd.qcut(df.risk_atr, 4, duplicates='drop')
grp('Rủi ro (SL) theo ATR - tứ phân vị', 'risk_bin')

# 4. Bộ lọc thử nghiệm: chọn ngưỡng trên huấn luyện, kiểm tra ngoài mẫu
P('## 4. Thử bộ lọc đơn giản (ngưỡng chọn trên huấn luyện, đánh giá trên kiểm tra)')
P('Với mỗi đặc điểm, thử giữ lại lệnh nằm ở nửa trên hoặc nửa dưới theo trung vị của huấn luyện. Chỉ xét bộ lọc giữ ≥ 40% lệnh.\n')
cand = []
for f in feats:
    med = train[f].median()
    if np.isnan(med): continue
    for side, fn in [('>=', lambda d: d[d[f] >= med]), ('<', lambda d: d[d[f] < med])]:
        a, b = fn(train), fn(test)
        if len(a) < 0.4 * len(train) or len(b) < 10: continue
        cand.append((f'{f} {side} {med:.3f}', len(a), stat(a)[4], len(b), stat(b)[2], stat(b)[3], stat(b)[4]))
c = pd.DataFrame(cand, columns=['bộ lọc', 'HL lệnh', 'HL R/lệnh', 'KT lệnh', 'KT thắng%', 'KT tổng R', 'KT R/lệnh'])
if len(c):
    c = c.sort_values('HL R/lệnh', ascending=False)
    P(c.head(12).round(3).to_markdown(index=False) + '\n')
    P(f'- Số bộ lọc thử: {len(c)}; có R/lệnh > 0 ở HL: {(c["HL R/lệnh"]>0).sum()}; trong đó vẫn > 0 ở KT: {((c["HL R/lệnh"]>0)&(c["KT R/lệnh"]>0)).sum()}.')
    P(f'- Không lọc: KT R/lệnh {stat(test)[4]:.3f} ({len(test)} lệnh).\n')

# 5. Cây quyết định nông: chấm walk-forward
from sklearn.tree import DecisionTreeClassifier, export_text
X = df[feats].fillna(df[feats].median()); y = df.win
mask = df.t < SPLIT
tree = DecisionTreeClassifier(max_depth=2, min_samples_leaf=15, random_state=0).fit(X[mask], y[mask])
P('## 5. Cây quyết định nông (độ sâu 2, học từ huấn luyện)\n')
P('```\n' + export_text(tree, feature_names=feats) + '```')
pred = tree.predict_proba(X[~mask])[:, 1]
auc_te = stats.mannwhitneyu(pred[y[~mask] == 1], pred[y[~mask] == 0])[0] / ((y[~mask] == 1).sum() * (y[~mask] == 0).sum())
P(f'\n- AUC trên kiểm tra: {auc_te:.3f} (0,5 = không có khả năng dự đoán).\n')

open(f'results/zzz/analysis{TAG}.md', 'w').write('\n'.join(out))
print('\n'.join(out))
