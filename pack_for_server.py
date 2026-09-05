# -*- coding: utf-8 -*-
"""打一份给 Windows 宝塔服务器用的压缩包（不含剧情编辑器和 node_modules）。"""
import os
import zipfile
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ROOT, "dist")
STAMP = datetime.now().strftime("%Y%m%d-%H%M")
OUT_ZIP = os.path.join(OUT_DIR, f"Lykie-server-{STAMP}.zip")

INCLUDE_ALWAYS = {
    ".env",
    ".env.example",
    "add_user.py",
    "app.py",
    "requirements.txt",
    "启动背题助手.bat",
    "启动生产服务.bat",
}

SKIP_DIR_NAMES = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    "story-editor",
    "dist",
    ".cursor",
    "agent-transcripts",
}

SKIP_FILE_NAMES = {
    "pack_for_server.py",
    "upload.docx",
}


def wanted(rel):
    rel = rel.replace("\\", "/")
    parts = rel.split("/")
    if any(p in SKIP_DIR_NAMES for p in parts):
        return False
    name = parts[-1]
    if name in SKIP_FILE_NAMES:
        return False
    if name.endswith(".pyc"):
        return False
    if rel.startswith("docs/") and rel.endswith(".md"):
        # 角色构想等作者文档不放公网机器
        if "角色" in rel or "构想" in rel:
            return False
    return True


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    count = 0
    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES]
            for fn in filenames:
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, ROOT)
                if not wanted(rel):
                    continue
                zf.write(full, "Lykie/" + rel.replace("\\", "/"))
                count += 1
        # 空目录占位
        zf.writestr("Lykie/data/users/.keep", "")
    size_mb = os.path.getsize(OUT_ZIP) / (1024 * 1024)
    print(f"已打包 {count} 个文件 -> {OUT_ZIP}")
    print(f"大小约 {size_mb:.1f} MB")
    print("含 .env 和账号数据，不要发到群里。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
