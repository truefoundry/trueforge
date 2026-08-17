#!/usr/bin/env python3

# /// script
# dependencies = ["pydantic==2.12.5"]
# ///

"""Materialize git skill directories into TFY_SKILLS_DIR (default /opt/tfy/skills). Requires `git`.

Each git skill (AGENT_GIT_SKILLS) is materialized with a blob-filtered sparse `git` clone that
fetches only the requested subdir at a resolved object id, keyed by name. Mount `ref` values
(branch, tag, or full object id) are resolved here via `git ls-remote` — the host never spawns
git. A single on-disk state file records the installed object id + subdir per name so a skill
whose tip hasn't moved is skipped instead of re-cloning every run, and skills no longer desired
are pruned from disk. A sparse clone is used instead of a full repo tarball because its cost is
~constant in the subdir size rather than the whole-repo size, which is dramatically faster for a
small skill living in a large monorepo.

Optional env:
  - AGENT_GIT_SKILLS (base64-encoded JSON list of {name, url, path, ref}; empty
    clears git downloads). `ref` is a branch, tag, or full object id.
  - TFY_SKILLS_DIR: override the skills directory (default /opt/tfy/skills).
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

DEFAULT_SKILLS_DIR = "/opt/tfy/skills"
STATE_FILE_NAME = ".tfy-skill-downloader-state.json"
# Per-git-invocation wall-clock cap so a hung/slow fetch can't stall sandbox init indefinitely.
GIT_CLONE_TIMEOUT_SECONDS = 120
# Cap the installed skill size so a huge repo-root skill can't fill the persistent skills dir. The
# sparse clone already bounds a subdir skill to its subdir; this also guards the whole-repo (root
# subdir) case where checkout hydrates every file.
GIT_SKILL_MAX_BYTES = 200 * 1024 * 1024  # 200MB installed
# Resolved object id used for fetch + skip state (sha1 / sha256).
OBJECT_ID_RE = re.compile(r"^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$")
# Mount ref (branch/tag/SHA) charset — must match host AgentSpec SkillMount.ref validation.
# Validated before the value is passed to `git ls-remote` / used as a fetch arg fallback.
GIT_REF_RE = re.compile(r"^[A-Za-z0-9._\-/]+$")
SKILLS_ROOT = Path(os.environ.get("TFY_SKILLS_DIR", DEFAULT_SKILLS_DIR))
STATE_PATH = SKILLS_ROOT / STATE_FILE_NAME


class GitSkillError(Exception):
    """Recoverable per-repo/per-skill git failure. Raised (not sys.exit) so a single bad repo or
    subdirectory doesn't abort the remaining repository groups (best-effort failure isolation)."""


def skill_dir(name: str) -> Path | None:
    """Resolve a skill's on-disk directory. This is the ONLY place a skill name becomes a path, so
    the safety check here is what guarantees that no name — freshly requested or read back from the
    (possibly corrupt) state file — can escape SKILLS_ROOT during delete/copy.

    Returns None for an unsafe name (empty, absolute, containing a path separator, "." / "..", or the
    reserved state-file name) so each caller can skip it per its own failure contract instead of
    touching an out-of-tree path. The state-file name is reserved because a skill whose name equals it
    would resolve to STATE_PATH and let a skill install clobber the reconciliation state.
    """
    if not name or name in (".", "..") or "/" in name or "\\" in name or name == STATE_FILE_NAME:
        return None
    return SKILLS_ROOT / name


class GitSkill(BaseModel):
    """A git skill to materialize: `name`, `url`, `path`, and mount `ref` (branch, tag, or object id).
    This script resolves `ref` via `git ls-remote` in the sandbox, then sparse-fetches the resolved
    object id. The url and ref are format-validated here (defense in depth) so an unexpected value
    can't be interpreted as a git option or reach a non-public host."""

    model_config = ConfigDict(extra="ignore")

    name: str
    url: str
    path: str = ""
    # Branch, tag, or full object id from the agent_spec mount (resolved in-sandbox before fetch).
    ref: str

    @field_validator("url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        # Only the two public hosts the gateway supports. Anchoring on the "https://<host>/" prefix
        # blocks non-https schemes (file://, ext::, ssh) and any other host, so this URL can't be
        # turned into an SSRF/local-file/command vector once it reaches `git`.
        if not (v.startswith("https://github.com/") or v.startswith("https://gitlab.com/")):
            raise ValueError(f"git skill url must be a github.com/gitlab.com https URL: {v!r}")
        return v

    @field_validator("ref")
    @classmethod
    def _validate_ref(cls, v: str) -> str:
        if not v or ".." in v.split("/") or not GIT_REF_RE.match(v):
            raise ValueError(f"git skill ref is invalid: {v!r}")
        if v.replace("/", "") == "":
            raise ValueError(f"git skill ref must not consist only of slashes: {v!r}")
        return v

    @field_validator("path")
    @classmethod
    def _validate_path(cls, v: str) -> str:
        # Relative subpath within the repo. Reject absolute paths and ".." segments so it can't
        # escape the repo root. Leading/trailing slashes are stripped (repo root == ""). A leading
        # "-" is safe because subdirs are fed to `git sparse-checkout set` via stdin, never as args.
        if v.startswith("/"):
            raise ValueError(f"git skill path must be relative: {v!r}")
        stripped = v.strip("/")
        if stripped and ".." in stripped.split("/"):
            raise ValueError(f"git skill path must not contain '..': {v!r}")
        return stripped


class DownloadedGitSkill(BaseModel):
    """A git skill recorded on disk: its dir name, the object id it was installed at, and the repo
    path it was installed from. The ref lets a later run skip re-downloading when the requested
    pin is unchanged; the path is part of the identity so that changing the path at the same
    pin still triggers a re-download instead of serving the previously-installed layout."""

    model_config = ConfigDict(extra="ignore")

    name: str
    # Empty when migrated from a pre-pin-tracking state file — treated as "unknown", forcing a
    # one-time re-download while still keeping the name tracked for pruning.
    ref: str = ""
    # Repo path the skill was installed from (repo root == ""). Empty on entries written before
    # path tracking; a mismatch against the requested path forces a one-time re-download.
    path: str = ""


class SkillDownloaderState(BaseModel):
    """Persisted next to skills; tracks what was downloaded so undesired skills can be pruned."""

    model_config = ConfigDict(extra="ignore")

    downloaded_git_skills: list[DownloadedGitSkill] = Field(
        default_factory=list,
        description="Git skills successfully downloaded (name + installed object id).",
    )


def _migrate_downloaded_git_skills(entries: list[object]) -> list[dict[str, object]]:
    """Normalize state entries: rename legacy `commit_sha` → `ref` and `subdir` → `path`."""
    migrated: list[dict[str, object]] = []
    for item in entries:
        if not isinstance(item, dict):
            continue
        entry = dict(item)
        if "ref" not in entry and isinstance(entry.get("commit_sha"), str):
            entry["ref"] = entry["commit_sha"]
        entry.pop("commit_sha", None)
        if "path" not in entry and isinstance(entry.get("subdir"), str):
            entry["path"] = entry["subdir"]
        entry.pop("subdir", None)
        migrated.append(entry)
    return migrated


def load_state() -> SkillDownloaderState:
    if not STATE_PATH.is_file():
        return SkillDownloaderState()
    try:
        raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return SkillDownloaderState()
    if not isinstance(raw, dict):
        return SkillDownloaderState()
    # Migrate a pre-pin-tracking state file: its `downloaded_git_names` (list of names, no pin)
    # becomes entries with an empty ref. That keeps the names tracked so undesired skills are
    # still pruned, and forces a one-time re-download (empty != any requested pin). Skipped when
    # the new field is already present so we never clobber real pins.
    if "downloaded_git_skills" not in raw and isinstance(raw.get("downloaded_git_names"), list):
        raw["downloaded_git_skills"] = [
            {"name": n, "ref": ""} for n in raw["downloaded_git_names"] if isinstance(n, str)
        ]
    if isinstance(raw.get("downloaded_git_skills"), list):
        raw["downloaded_git_skills"] = _migrate_downloaded_git_skills(raw["downloaded_git_skills"])
    try:
        return SkillDownloaderState.model_validate(raw)
    except ValidationError:
        return SkillDownloaderState()


def save_state(state: SkillDownloaderState) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_name(STATE_PATH.name + ".tmp")
    tmp.write_text(state.model_dump_json(indent=2), encoding="utf-8")
    os.replace(tmp, STATE_PATH)


def _rmtree(path: Path, ignore_errors: bool = True) -> None:
    try:
        shutil.rmtree(path, ignore_errors=ignore_errors)
    except OSError:
        pass


def _delete_skill_dir_by_name(name: str, label: str) -> None:
    """Fail-closed prune of a no-longer-desired skill's directory: abort the whole run if removal
    fails so we never silently leave a stale skill on disk. skill_dir() returns None for a
    corrupt/tampered name, so rmtree never runs on an out-of-tree path."""
    dir_ = skill_dir(name)
    if dir_ is None or not dir_.is_dir():
        return
    try:
        shutil.rmtree(dir_)
    except OSError as e:
        sys.exit(f"Could not remove skill directory {dir_} ({label}): {e}")


def git_skills_from_env(raw: str | None) -> list[GitSkill]:
    """Empty or missing env means "no desired git skills" (prune all git downloads)."""
    if raw is None or not str(raw).strip():
        return []
    try:
        data = json.loads(base64.b64decode(raw))
    except (ValueError, json.JSONDecodeError) as e:
        sys.exit(f"AGENT_GIT_SKILLS is not valid base64-encoded JSON: {e}")
    if not isinstance(data, list):
        sys.exit("AGENT_GIT_SKILLS must be a JSON list.")
    try:
        return [GitSkill.model_validate(item) for item in data]
    except ValidationError as e:
        sys.exit(f"Invalid AGENT_GIT_SKILLS entry: {e}")


def reconcile_git_skills(git_skills: list[GitSkill], state: SkillDownloaderState) -> list[str]:
    """Delete dirs for git skills no longer desired; prune them from state. Returns removed names."""
    desired_names = {g.name for g in git_skills}
    removed: list[str] = []
    for entry in state.downloaded_git_skills:
        if entry.name in desired_names:
            continue
        # Fail-closed prune: a failed delete aborts the run rather than leaving a stale skill on disk.
        # The name is dropped from tracking either way.
        _delete_skill_dir_by_name(entry.name, entry.name)
        removed.append(entry.name)
    state.downloaded_git_skills = [
        e for e in state.downloaded_git_skills if e.name in desired_names
    ]
    return removed


def _run_git(
    args: list[str], cwd: Path, input_text: str | None = None
) -> subprocess.CompletedProcess[str]:
    """Run a git subcommand non-interactively and fail-closed on error.

    Args are passed as a list (never a shell string) and git runs with a scrubbed environment:
    ambient global/system config and credential helpers are ignored (so nothing can rewrite the URL
    via insteadOf or inject creds) and prompting is disabled (so a private/typo repo fails fast
    instead of hanging on a username prompt)."""
    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",  # never prompt for credentials — fail fast on a non-public repo
        "GIT_CONFIG_NOSYSTEM": "1",  # ignore /etc/gitconfig
        "GIT_CONFIG_GLOBAL": "/dev/null",  # ignore ~/.gitconfig (insteadOf rewrites, cred helpers)
        "GCM_INTERACTIVE": "never",
    }
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=os.fspath(cwd),
            env=env,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=GIT_CLONE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        raise GitSkillError(f"git {args[0]} timed out after {GIT_CLONE_TIMEOUT_SECONDS}s")
    except OSError as e:
        raise GitSkillError(f"could not run git (is it installed in the sandbox?): {e}")
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[-500:]
        raise GitSkillError(f"git {args[0]} failed (exit {proc.returncode}): {detail}")
    return proc


def _parse_ls_remote_object_id(stdout: str) -> str | None:
    """Prefer a peeled `ref^{}` line (annotated tags), else the first object id."""
    first: str | None = None
    for line in stdout.splitlines():
        trimmed = line.strip()
        if not trimmed:
            continue
        parts = trimmed.split(None, 1)
        sha = parts[0]
        name = parts[1] if len(parts) > 1 else ""
        if name.endswith("^{}"):
            return sha
        if first is None:
            first = sha
    return first


def _resolve_object_id(url: str, ref: str, cwd: Path) -> str:
    """Resolve a mount ref (branch/tag/SHA) to an object id inside the sandbox.

    Full object ids are used as-is (`git ls-remote` does not advertise bare SHAs on
    GitHub/GitLab). Branches and tags are resolved via `git ls-remote` so a branch tip
    advances on later sandbox inits.
    """
    if OBJECT_ID_RE.match(ref):
        return ref
    proc = _run_git(["ls-remote", url, ref], cwd=cwd)
    oid = _parse_ls_remote_object_id(proc.stdout or "")
    if oid is None:
        raise GitSkillError(f"git ls-remote returned no commit for {url} ref {ref}")
    return oid


def _git_fetch_repo(
    url: str, object_id: str, paths: list[str], parent_dir: Path
) -> Path:
    """Object-id-pinned, shallow, blob-filtered sparse checkout of `paths` into a fresh repo under
    `parent_dir`, returning the repo working directory.

    When every requested path is the repo root ("") we can't sparse-restrict, so we do a full
    shallow checkout (all blobs). Otherwise we cone-sparse to just the requested paths and use
    --filter=blob:none so only those paths' blobs are fetched — the whole point of the approach.
    Paths are fed to `git sparse-checkout set` via stdin so a path value can never be read as an
    option/argument. Fetching by object id relies on the server allowing it, which github.com and
    gitlab.com both do."""
    repo = parent_dir / "repo"
    _run_git(["init", "-q", os.fspath(repo)], cwd=parent_dir)
    _run_git(["remote", "add", "origin", url], cwd=repo)

    cone_dirs = [s for s in dict.fromkeys(paths) if s]  # de-duped, root ("") dropped
    want_full_tree = any(s == "" for s in paths)
    if not want_full_tree and cone_dirs:
        _run_git(["sparse-checkout", "init", "--cone"], cwd=repo)
        _run_git(
            ["sparse-checkout", "set", "--stdin"],
            cwd=repo,
            input_text="".join(f"{d}\n" for d in cone_dirs),
        )

    fetch_args = ["-c", "protocol.file.allow=never", "fetch", "-q", "--depth", "1"]
    if not want_full_tree:
        fetch_args.append("--filter=blob:none")
    fetch_args += ["origin", object_id]
    _run_git(fetch_args, cwd=repo)

    _run_git(
        ["-c", "advice.detachedHead=false", "checkout", "-q", "--detach", "FETCH_HEAD"], cwd=repo
    )
    return repo


def _installed_size_bytes(path: Path) -> int:
    """Total size of regular files under `path`, excluding the repo's .git dir and without following
    symlinks (they're copied as links, not their targets), used to enforce GIT_SKILL_MAX_BYTES."""
    total = 0
    for root, dirs, files in os.walk(path, followlinks=False):
        if ".git" in dirs:
            dirs.remove(".git")
        for name in files:
            try:
                total += (Path(root) / name).lstat().st_size
            except OSError:
                continue
    return total


def _install_git_skill(repo_root: Path, skill: GitSkill) -> None:
    dest = skill_dir(skill.name)
    if dest is None:
        raise GitSkillError(f"Git skill: unsafe directory name {skill.name!r}")
    repo_root_resolved = repo_root.resolve()
    src = (repo_root / skill.path).resolve() if skill.path else repo_root_resolved
    # Defense in depth: even though path is validated, ensure the resolved source stays within the
    # cloned repo (guards against a symlinked directory component pointing outside the checkout).
    if src != repo_root_resolved and not src.is_relative_to(repo_root_resolved):
        raise GitSkillError(
            f"Git skill {skill.name}: path '{skill.path}' escapes the repository"
        )
    if not src.is_dir():
        raise GitSkillError(
            f"Git skill {skill.name}: path '{skill.path}' not found in repository"
        )
    if _installed_size_bytes(src) > GIT_SKILL_MAX_BYTES:
        raise GitSkillError(
            f"Git skill {skill.name}: content exceeds {GIT_SKILL_MAX_BYTES} bytes"
        )
    # Stage the fresh copy into a temp sibling dir, then swap it in with an atomic rename. `dest` is
    # only touched once the copy has fully succeeded, so a failed/partial copytree can never leave
    # the skill missing (which would contradict the path the gateway advertises in the prompt) — the
    # previously installed copy stays intact on failure. `.git` is excluded (only present for a repo-
    # root skill) and symlinks are copied as links, never followed, so a link inside the repo can't
    # pull external file contents into the skill dir at copy time.
    staging = dest.with_name(f".{dest.name}.new-{os.getpid()}")
    _rmtree(staging)  # clear any leftover staging dir from an earlier aborted run
    try:
        shutil.copytree(src, staging, symlinks=True, ignore=shutil.ignore_patterns(".git"))
    except (OSError, shutil.Error) as e:
        # shutil.Error (a multi-file copy error, NOT an OSError subclass) must be caught here too so a
        # bad copy is reported as a per-skill GitSkillError (WARNING + counted failure) instead of an
        # uncaught traceback that aborts the whole run and skips save_state for the group.
        _rmtree(staging)
        raise GitSkillError(f"Failed to stage git skill {skill.name}: {e}")
    try:
        if dest.exists():
            shutil.rmtree(dest)
        # Same filesystem (both under SKILLS_ROOT), so this is an atomic rename; the window where the
        # skill dir is absent shrinks from a full copy to a single near-instant rename.
        os.replace(staging, dest)
    except OSError as e:
        _rmtree(staging)
        raise GitSkillError(f"Failed to install git skill {skill.name}: {e}")


def _mark_git_downloaded(
    state: SkillDownloaderState, skill: GitSkill, object_id: str
) -> None:
    """Upsert a git skill's installed object id + path so the next run can skip when both match."""
    for entry in state.downloaded_git_skills:
        if entry.name == skill.name:
            entry.ref = object_id
            entry.path = skill.path
            return
    state.downloaded_git_skills.append(
        DownloadedGitSkill(name=skill.name, ref=object_id, path=skill.path)
    )


def _git_skill_already_installed(
    state: SkillDownloaderState, skill: GitSkill, object_id: str
) -> bool:
    """True only when the skill is recorded at the resolved object id AND path AND its directory is
    still present. Re-download otherwise (branch tip moved, path changed, first install, or the
    dir was removed out-of-band) so the prompt never points at a missing/stale skill dir."""
    dir_ = skill_dir(skill.name)
    if dir_ is None or not dir_.is_dir():
        return False
    return any(
        e.name == skill.name and e.ref == object_id and e.path == skill.path
        for e in state.downloaded_git_skills
    )


def download_git_skills(
    git_skills: list[GitSkill], state: SkillDownloaderState
) -> int:
    """Ensure desired git skills are installed at their resolved object id, skipping any already
    present at that pin so an unchanged tip no longer re-clones every run.

    Ref resolution (`git ls-remote`) runs here in the sandbox — the host never spawns git.
    Failures are isolated per repo group and per skill so one bad repo/subdir doesn't prevent the
    rest from being attempted; each failure is logged to stderr. Returns the number of skills that are
    satisfied this run — freshly installed OR already present at the resolved pin (never raises).
    The caller (run_git_download) compares this to the number requested and exits non-zero if any are
    missing, so the overall behaviour is fail-closed."""
    SKILLS_ROOT.mkdir(parents=True, exist_ok=True)

    # Resolve mount refs → object ids, then skip skills already installed at that pin.
    pending: list[tuple[GitSkill, str]] = []
    satisfied = 0
    for skill in git_skills:
        try:
            object_id = _resolve_object_id(skill.url, skill.ref, SKILLS_ROOT)
        except GitSkillError as e:
            print(f"WARNING: {e} (skill: {skill.name})", file=sys.stderr)
            continue
        if _git_skill_already_installed(state, skill, object_id):
            satisfied += 1
        else:
            pending.append((skill, object_id))

    # Group pending by (repo, object id) so a repo shared by several skills is cloned once and its
    # needed paths fetched together in a single sparse checkout.
    skills_by_repo: dict[tuple[str, str], list[tuple[GitSkill, str]]] = {}
    for skill, object_id in pending:
        skills_by_repo.setdefault((skill.url, object_id), []).append((skill, object_id))

    for (url, object_id), group in skills_by_repo.items():
        try:
            with tempfile.TemporaryDirectory(
                prefix=".git-skill-dl-",
                dir=os.fspath(SKILLS_ROOT),
                ignore_cleanup_errors=True,
            ) as tmp_str:
                repo_root = _git_fetch_repo(
                    url,
                    object_id,
                    [s.path for s, _ in group],
                    Path(tmp_str),
                )
                # Install each skill independently so a bad path only skips that one skill.
                for skill, oid in group:
                    try:
                        _install_git_skill(repo_root, skill)
                        _mark_git_downloaded(state, skill, oid)
                        satisfied += 1
                    except GitSkillError as e:
                        print(f"WARNING: {e}", file=sys.stderr)
        except GitSkillError as e:
            # Collect (don't abort-on-first) so EVERY failing skill is reported before the run exits;
            # run_git_download turns a non-zero failed count into a non-zero exit (fail-closed), which
            # fails the whole agent request. We still don't purge a previously installed copy here, so
            # a reused sandbox keeps the old files on disk even though this run is about to fail.
            names = ", ".join(s.name for s, _ in group)
            print(f"WARNING: {e} (skills: {names})", file=sys.stderr)
    save_state(state)
    return satisfied


def run_git_download() -> None:
    git_skills = git_skills_from_env(os.environ.get("AGENT_GIT_SKILLS"))
    state = load_state()
    removed = reconcile_git_skills(git_skills, state)
    save_state(state)  # persist pruning even when there is nothing to download

    if not git_skills:
        if removed:
            print(f"Removed {len(removed)} git skill(s) from disk. (AGENT_GIT_SKILLS empty.)")
        return

    satisfied = download_git_skills(git_skills, state)
    failed = len(git_skills) - satisfied
    suffix = f" Removed {len(removed)} stale git skill(s)." if removed else ""
    if failed:
        # Fail-closed: a requested skill that couldn't be installed exits non-zero so the gateway
        # (ensureExecSuccess) fails the whole agent request, matching the fail-closed SKILL.md fetch.
        # Per-skill WARNINGs above list exactly what failed.
        sys.exit(
            f"Failed to install {failed}/{len(git_skills)} git skill(s); see warnings above.{suffix}"
        )
    print(f"Ensured {satisfied} git skill(s) (downloaded or already up to date).{suffix}")


def main() -> None:
    run_git_download()


if __name__ == "__main__":
    main()
