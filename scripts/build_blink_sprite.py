# -*- coding: utf-8 -*-
"""把 Lykie 眨眼序列帧拼成网页用的雪碧图，并用 00 帧替换登录页静态头像。

一次性脚本：
  1. 将 透明帧 目录下 11 帧 2160x2160 的 PNG 缩放到 300x300（登录页展示 150px，2x 屏足够），
     横向拼接为单张 WebP 雪碧图 -> static/lykie/blink/lykie-blink-sheet.webp
  2. 将 00 帧缩放到 1024x1024，覆盖 static/lykie/lykie_avatar.png
"""
import glob
import os

from PIL import Image

SRC_DIR = r"D:\Lykie-本地归档\杂项素材\视频处理\处理输出\透明帧"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "lykie", "blink")
AVATAR_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "lykie", "lykie_avatar.png")

FRAME_SIZE = 300  # 单帧边长（雪碧图内）
AVATAR_SIZE = 1024


def main():
    frames = sorted(glob.glob(os.path.join(SRC_DIR, "*.png")))
    if len(frames) != 11:
        raise SystemExit(f"期望 11 帧，实际找到 {len(frames)} 帧: {frames}")

    os.makedirs(OUT_DIR, exist_ok=True)

    resized = []
    for path in frames:
        img = Image.open(path).convert("RGBA")
        if img.size != (2160, 2160):
            raise SystemExit(f"帧尺寸异常 {path}: {img.size}")
        resized.append(img.resize((FRAME_SIZE, FRAME_SIZE), Image.LANCZOS))

    sheet = Image.new("RGBA", (FRAME_SIZE * len(resized), FRAME_SIZE))
    for i, img in enumerate(resized):
        sheet.paste(img, (i * FRAME_SIZE, 0), img)
    sheet_path = os.path.join(OUT_DIR, "lykie-blink-sheet.webp")
    sheet.save(sheet_path, "WEBP", quality=90, method=6)
    print(f"雪碧图 -> {sheet_path} ({os.path.getsize(sheet_path) / 1024:.0f} KB)")

    avatar = resized[0].resize((AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS)
    avatar.save(AVATAR_PATH, "PNG")
    print(f"头像   -> {AVATAR_PATH} ({os.path.getsize(AVATAR_PATH) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
