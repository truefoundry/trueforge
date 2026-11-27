#!/usr/bin/env python3
"""Artifact push helper (stdlib only).

The server owns every limit. This script only measures files and moves bytes, so its output
is never trusted on its own: S3 signed headers bind size and sha256, and the server verifies
uploaded objects afterwards.

Usage:
  artifact_transfer_v1.py metadata <dir>
      -> {"success", "exit_code", "error", "files": [{relative_path, size_bytes, sha256_b64}]}
      (regular files only; symlinks and special files are skipped)
  artifact_transfer_v1.py upload <request_file_name.json>
      request: {"concurrency", "base_path", "files": [{relative_path, url, headers}], "created_at"}
      -> {"success", "exit_code", "files": [{path, status, error}]}   (never URLs)

The upload request holds presigned URLs, so it is deleted as soon as it is read. Request files
in the same folder whose `created_at` is older than the URL lifetime are deleted on every upload.

Exit codes: 0 success, 1 reading the dir or a transfer failed, 2 malformed input (stderr only).
"""

import base64
import hashlib
import http.client
import json
import os
import stat
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime

# Slightly above the 5 minute presigned URL lifetime, so older request files are useless.
STALE_REQUEST_SECONDS = 320
READ_CHUNK = 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 120
UPLOAD_TIMEOUT_SECONDS = 240
MAX_CONCURRENCY = 8


def _created_at(path: str) -> float | None:
    try:
        with open(path, encoding="utf-8") as fh:
            created_at = json.load(fh)["created_at"]
        return datetime.fromisoformat(created_at.replace("Z", "+00:00")).timestamp()
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        # Missing or half-written (upload in flight): leave it alone.
        return None


def _remove_stale_request_files(requests_dir: str) -> None:
    """Delete request files a failed cleanup left behind once their URLs have expired."""
    now = time.time()
    try:
        entries = list(os.scandir(requests_dir))
    except OSError:
        return
    for entry in entries:
        if not entry.name.endswith(".json") or not entry.is_file(follow_symlinks=False):
            continue
        created_at = _created_at(entry.path)
        if created_at is not None and now - created_at > STALE_REQUEST_SECONDS:
            try:
                os.remove(entry.path)
            except OSError:
                pass


def _open_nofollow(path: str) -> int:
    # O_NOFOLLOW fails on a final-component symlink, so the fd we read is the file we checked.
    return os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))


def _measure(root: str, path: str) -> tuple[dict | None, str | None]:
    """Returns (file, None), (None, error), or (None, None) for entries that are skipped."""
    relative_path = os.path.relpath(path, root)
    try:
        if not stat.S_ISREG(os.lstat(path).st_mode):
            # Symlinks and special files are not pushed.
            return None, None
        fd = _open_nofollow(path)
    except OSError as e:
        return None, f"cannot read {relative_path}: {e.strerror}"
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            return None, None
        digest = hashlib.sha256()
        read = 0
        while chunk := os.read(fd, READ_CHUNK):
            digest.update(chunk)
            read += len(chunk)
        if read != st.st_size:
            return None, f"changed while reading: {relative_path}"
        sha256_b64 = base64.b64encode(digest.digest()).decode()
        return {"relative_path": relative_path, "size_bytes": st.st_size, "sha256_b64": sha256_b64}, None
    finally:
        os.close(fd)


def _gather_metadata(directory: str) -> tuple[dict, bool]:
    if not os.path.isabs(directory):
        raise ValueError("dir must be an absolute path")
    if not os.path.isdir(directory):
        return {"error": f"not a directory: {directory}", "files": []}, False
    files = []
    # followlinks=False: symlinked dirs are listed in dirnames but never entered.
    for parent, _dirnames, filenames in os.walk(directory, followlinks=False):
        for name in filenames:
            file, error = _measure(directory, os.path.join(parent, name))
            if error is not None:
                return {"error": error, "files": []}, False
            if file is not None:
                files.append(file)
    files.sort(key=lambda f: f["relative_path"])
    return {"error": None, "files": files}, True


def _s3_error_code(e: urllib.error.HTTPError) -> str:
    try:
        body = e.read(4096).decode("utf-8", "replace")
    except OSError:
        return "http_error"
    start, end = body.find("<Code>"), body.find("</Code>")
    return body[start + 6 : end] if start != -1 and end > start else "http_error"


def _upload_one(base_path: str, f: dict) -> dict:
    rel = f["relative_path"]
    result = {"path": rel, "status": None, "error": None}
    try:
        with open(os.path.join(base_path, rel), "rb") as fh:
            body = fh.read()
    except OSError as e:
        result["error"] = f"read_failed: {e.strerror}"
        return result
    request = urllib.request.Request(f["url"], data=body, method="PUT", headers=f["headers"])
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
            result["status"] = resp.status
    except urllib.error.HTTPError as e:
        result["status"] = e.code
        result["error"] = _s3_error_code(e)
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as e:
        result["error"] = f"network: {getattr(e, 'reason', e)}"
    return result


def _upload(request_path: str) -> tuple[dict, bool]:
    _remove_stale_request_files(os.path.dirname(os.path.abspath(request_path)))
    try:
        with open(request_path, encoding="utf-8") as fh:
            req = json.load(fh)
    finally:
        try:
            os.remove(request_path)
        except OSError:
            pass
    base_path = req["base_path"]
    files = req["files"]
    if not isinstance(files, list) or not files:
        raise ValueError("files must be a non-empty list")
    concurrency = max(1, min(int(req["concurrency"]), MAX_CONCURRENCY))
    pool = ThreadPoolExecutor(max_workers=concurrency)
    futures = [pool.submit(_upload_one, base_path, f) for f in files]
    done, _ = wait(futures, timeout=UPLOAD_TIMEOUT_SECONDS)
    pool.shutdown(wait=False, cancel_futures=True)
    results = [
        future.result() if future in done else {"path": f["relative_path"], "status": None, "error": "timeout"}
        for future, f in zip(futures, files)
    ]
    ok = all(r["error"] is None and r["status"] is not None and 200 <= r["status"] < 300 for r in results)
    return {"files": results}, ok


MODES = {"metadata": _gather_metadata, "upload": _upload}


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in MODES:
        print("usage: artifact_transfer_v1.py metadata <dir> | upload <request_file_name.json>", file=sys.stderr)
        return 2
    mode, arg = sys.argv[1], sys.argv[2]
    try:
        result, ok = MODES[mode](arg)
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"malformed request: {e}", file=sys.stderr)
        return 2
    exit_code = 0 if ok else 1
    print(json.dumps({"success": ok, "exit_code": exit_code, **result}), flush=True)
    return exit_code


if __name__ == "__main__":
    # os._exit: timed-out upload threads must not keep the process alive.
    os._exit(main())
