# -*- coding: utf-8 -*-
"""Upload 20 short-answer questions to Baota server for all accounts."""
from __future__ import annotations

import importlib.util
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "给cursor看的图片" / "简答题截图" / "教资科二简答-短题子集.json"

spec = importlib.util.spec_from_file_location("dep", ROOT / "scripts" / "deploy_to_bt.py")
dep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dep)

data = json.loads(SRC.read_text(encoding="utf-8"))
qs = data["questions"]
print("local qs", len(qs))

remote_json = "C:/wwwroot/Lykie/data/short_sa_subset.json"
text = json.dumps(data, ensure_ascii=False, indent=2)
print("json bytes", len(text.encode("utf-8")))
print(
    "upload json",
    dep.brief(
        dep.post(
            "/files/save_file_body",
            {
                "filename": remote_json,
                "path": remote_json,
                "data": text,
                "encoding": "utf-8",
            },
            timeout=180,
        )
    ),
)

install_py = r'''# -*- coding: utf-8 -*-
import json, os, sys
os.chdir(r"C:\wwwroot\Lykie")
sys.path.insert(0, r"C:\wwwroot\Lykie")
from app import UserData
from lykie import short_answer as sa

src = r"C:\wwwroot\Lykie\data\short_sa_subset.json"
qs = json.loads(open(src, encoding="utf-8").read())["questions"]
users = ["LiZF", "ZhangPT", "Test"]
lines = ["n=" + str(len(qs))]
for u in users:
    store = UserData(u)
    bank = sa.install_short_bank(store, qs)
    store.save()
    lines.append("%s:%s:%d" % (u, bank.get("name"), len(bank.get("questions") or [])))
open(r"C:\wwwroot\Lykie\data\_install_sa_result.txt", "w", encoding="utf-8").write("\n".join(lines))
print("\n".join(lines))
'''

print(
    "save installer",
    dep.brief(
        dep.post(
            "/files/save_file_body",
            {
                "filename": "C:/wwwroot/Lykie/_install_short_sa_once.py",
                "path": "C:/wwwroot/Lykie/_install_short_sa_once.py",
                "data": install_py,
                "encoding": "utf-8",
            },
        )
    ),
)

py = r"C:\Program Files\python\python.exe"
print(
    "run",
    dep.brief(
        dep.post(
            "/other/create_project",
            {
                "title": "install-short-sa",
                "name": "install-short-sa",
                "domains": "install-short-sa.local",
                "path": "C:/wwwroot/Lykie",
                "port": "5097",
                "type_id": "0",
                "ps": "install short sa",
                "bind_extranet": "0",
                "command": f'"{py}" C:\\wwwroot\\Lykie\\_install_short_sa_once.py',
            },
        ),
        400,
    ),
)

time.sleep(6)
print(
    "result",
    dep.brief(
        dep.post(
            "/files/get_file_body",
            {"filename": "C:/wwwroot/Lykie/data/_install_sa_result.txt"},
        ),
        800,
    ),
)
