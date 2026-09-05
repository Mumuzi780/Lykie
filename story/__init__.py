# -*- coding: utf-8 -*-
"""剧情脚本：加载 data/stories 下的 StoryGraph JSON。"""
import json
import os

OUT_HANDLE = "out"
TIMEOUT_HANDLE = "timeout"


def stories_dir(base_dir):
    return os.path.join(base_dir, "data", "stories")


def list_stories(base_dir):
    d = stories_dir(base_dir)
    if not os.path.isdir(d):
        return []
    out = []
    for name in sorted(os.listdir(d)):
        if name.endswith(".json"):
            out.append(name[:-5])
    return out


def load_story(base_dir, story_id):
    safe = "".join(c for c in story_id if c.isalnum() or c in ("_", "-"))
    if not safe or safe != story_id:
        raise FileNotFoundError(story_id)
    path = os.path.join(stories_dir(base_dir), f"{safe}.json")
    if not os.path.isfile(path):
        raise FileNotFoundError(story_id)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data.get("nodes"), list) or not isinstance(data.get("edges"), list):
        raise ValueError("invalid story graph")
    return data
