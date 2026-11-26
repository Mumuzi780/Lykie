# -*- coding: utf-8 -*-
"""对比市场文件夹内 banks 顺序 vs 本地文件夹内顺序。"""
import json

ob = json.load(open('/opt/lykie/data/official_banks.json', encoding='utf-8'))
folder = next(e for e in ob['official'] if e.get('kind') == 'folder' and e.get('name') == '操作系统')
print('=== 市场「操作系统」文件夹内 banks 顺序 ===')
banks = folder.get('banks') or []
print('banks 类型:', type(banks).__name__, '长度:', len(banks))
if isinstance(banks, list):
    for i, e in enumerate(banks):
        if isinstance(e, dict):
            print(i, e.get('id'), e.get('name'), '| questions:', len(e.get('questions') or []))
        else:
            print(i, repr(e))
print('papers:', len(folder.get('papers') or []))
print('version:', folder.get('version'), 'published_at:', folder.get('published_at'))

d = json.load(open('/opt/lykie/data/users/LiZF/bank.json', encoding='utf-8'))
print('=== 本地 LiZF「操作系统」文件夹 ===')
for f in d.get('folders', []):
    if f.get('id') == '179174221450863' or f.get('name') == '操作系统':
        print('folder:', f.get('id'), f.get('name'))
        print(json.dumps(f, ensure_ascii=False)[:600])
