import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "movies.json"
STATE_FILE = ROOT / "data" / "telegram-state.json"
POSTER_DIR = ROOT / "assets" / "posters"

BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHANNEL_USERNAME = os.environ["TELEGRAM_CHANNEL_USERNAME"].lstrip("@")
API = f"https://api.telegram.org/bot{BOT_TOKEN}"
FILE_API = f"https://api.telegram.org/file/bot{BOT_TOKEN}"

POSTER_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".webm"}


def telegram(method, **params):
    response = requests.get(f"{API}/{method}", params=params, timeout=30)
    response.raise_for_status()
    payload = response.json()

    if not payload.get("ok"):
        raise RuntimeError(payload.get("description", "Telegram API request failed"))

    return payload["result"]


def read_json(path, default):
    if not path.exists():
        return default

    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)

def caption_of(post):
    return (post.get("caption") or post.get("text") or "").strip()


def is_movie_poster(post):
    return bool(post.get("photo")) and "#MOVIE" in caption_of(post).upper()


def is_file_post(post):
    if post.get("video"):
        return True

    document = post.get("document", {})
    file_name = document.get("file_name", "").lower()
    mime_type = document.get("mime_type", "").lower()

    return bool(document) and (
        mime_type.startswith("video/")
        or Path(file_name).suffix.lower() in VIDEO_EXTENSIONS
    )


def normalize_key(label):
    return re.sub(r"[^a-z]", "", label.lower())


def parse_movie_caption(caption):
    fields = {
        "title": "",
        "rating": "N/A",
        "duration": "Not specified",
        "language": "Not specified",
        "genres": [],
        "releaseDate": "Not specified",
        "description": ""
    }

    label_mapping = {
        "title": "title",
        "movie": "title",
        "series": "title",
        "rating": "rating",
        "duration": "duration",
        "length": "duration",
        "language": "language",
        "languages": "language",
        "genre": "genres",
        "genres": "genres",
        "releasedate": "releaseDate",
        "release": "releaseDate",
        "releasedon": "releaseDate",
        "description": "description",
        "story": "description",
        "plot": "description"
    }

    description_lines = []

    for raw_line in caption.splitlines():
        line = raw_line.strip()

        if not line or line.upper() == "#MOVIE":
            continue

        cleaned = re.sub(r"^[^w#]*", "", line)
        match = re.match(r"(.+?)s*:s*(.+)$", cleaned)

        if match:
            raw_key, raw_value = match.groups()
            key = normalize_key(raw_key)
            value = raw_value.strip()
            mapped_key = label_mapping.get(key)

            if mapped_key == "genres":
                fields["genres"] = [
                    item.strip()
                    for item in value.split(",")
                    if item.strip()
                ]
            elif mapped_key:
                fields[mapped_key] = value
            else:
                description_lines.append(line)
        else:
            description_lines.append(line)

    if not fields["description"] and description_lines:
        fields["description"] = " ".join(description_lines)

    return fields


def poster_file_id(post):
    photos = post.get("photo", [])
    return photos[-1]["file_id"] if photos else None


def download_poster(file_id, movie_id):
    telegram_file = telegram("getFile", file_id=file_id)
    file_path = telegram_file["file_path"]
    extension = Path(file_path).suffix.lower()

    if extension not in POSTER_EXTENSIONS:
        extension = ".jpg"

    POSTER_DIR.mkdir(parents=True, exist_ok=True)
    local_path = POSTER_DIR / f"{movie_id}{extension}"

    response = requests.get(f"{FILE_API}/{file_path}", timeout=60)
    response.raise_for_status()
    local_path.write_bytes(response.content)

    return local_path.relative_to(ROOT).as_posix()


def build_movie_id(poster_post):
    channel_id = poster_post["chat"]["id"]
    message_id = poster_post["message_id"]
    unique = f"{channel_id}-{message_id}".encode("utf-8")
    return f"movie-{hashlib.sha1(unique).hexdigest()[:12]}"


def public_message_link(message_id):
    return f"https://t.me/{CHANNEL_USERNAME}/{message_id}"


def process_pair(poster_post, file_post, movies):
    details = parse_movie_caption(caption_of(poster_post))
    movie_id = build_movie_id(poster_post)

    existing = next((item for item in movies if item["id"] == movie_id), None)
    if existing:
        return False

    poster_path = download_poster(poster_file_id(poster_post), movie_id)

    movie = {
        "id": movie_id,
        "type": "series" if "#SERIES" in caption_of(poster_post).upper() else "movie",
        "title": details["title"] or "Untitled",
        "poster": poster_path,
        "rating": details["rating"],
        "duration": details["duration"],
        "language": details["language"],
        "genres": details["genres"],
        "releaseDate": details["releaseDate"],
        "description": details["description"] or "No description available.",
        "telegramLink": public_message_link(file_post["message_id"]),
        "watchLink": "https://youtube.com/@punisher_exe?si=sRQR7QMrAn6cjQZz",
        "posterMessageId": poster_post["message_id"],
        "fileMessageId": file_post["message_id"],
        "addedAt": datetime.now(timezone.utc).isoformat()
    }

    movies.insert(0, movie)
    print(f"Added: {movie['title']}")
    return True


def main():
    state = read_json(STATE_FILE, {"offset": 0, "pendingPoster": None})
    movies = read_json(DATA_FILE, [])

    offset = state.get("offset", 0)
    pending_poster = state.get("pendingPoster")
    changed = False

    updates = telegram(
        "getUpdates",
        offset=offset,
        timeout=0,
        allowed_updates=json.dumps(["channel_post"])
    )

    for update in updates:
        state["offset"] = update["update_id"] + 1
        post = update.get("channel_post")

        if not post:
            continue

        username = (post.get("chat", {}).get("username") or "").lower()
        if username != CHANNEL_USERNAME.lower():
            continue

        if is_movie_poster(post):
            pending_poster = post
            state["pendingPoster"] = post
            print(f"Pending poster: {post['message_id']}")
            continue

        if pending_poster and is_file_post(post):
            changed = process_pair(pending_poster, post, movies)
            pending_poster = None
            state["pendingPoster"] = None
            continue

        if pending_poster:
            pending_poster = None
            state["pendingPoster"] = None
            print("Pending poster cleared because next post was not a file.")

    write_json(STATE_FILE, state)

    if changed:
        write_json(DATA_FILE, movies)


if __name__ == "__main__":
    main()
