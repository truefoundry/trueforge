#!/usr/bin/env python3

# /// script
# dependencies = ["pydantic==2.12.5"]
# ///

"""Materialize git skill directories into TFY_SKILLS_DIR (default /opt/tfy/skills). Requires `git`.

Each git skill (AGENT_GIT_SKILLS) is materialized with a SHA-pinned, blob-filtered sparse `git`
clone that fetches only the requested subdir at the requested commit, keyed by name. A single on-disk
state file records the installed commit + subdir per name so a skill whose ref hasn't moved (same
commit and subdir) is skipped instead of re-cloning every run, and skills no longer desired are
pruned from disk. A sparse clone is used instead of a full repo tarball because its cost is
~constant in the subdir size rather than the whole-repo size, which is dramatically faster for a
small skill living in a large monorepo.

Optional env:
  - AGENT_GIT_SKILLS (base64-encoded JSON list of {name, clone_url, subdir, commit_sha}; empty
    clears git downloads)
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
# A resolved git object id: sha1 (40 hex) or sha256 (64 hex). Validated here because commit_sha is
# passed as a `git fetch` argument, so it must never be interpretable as an option or injected arg.
COMMIT_SHA_RE = re.compile(r"^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$")
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
    """A git skill to materialize: its sandbox dir name, the repo clone URL, the subdir within the
    repo, and the resolved commit SHA. The clone URL and SHA are passed to `git`, so both are format-
    validated here (defense in depth — the gateway already validates and builds them) to keep an
    unexpected value from being interpreted as a git option or reaching a non-public host."""

    model_config = ConfigDict(extra="ignore")

    name: str
    clone_url: str
    subdir: str = ""
    commit_sha: str

    @field_validator("clone_url")
    @classmethod
    def _validate_clone_url(cls, v: str) -> str:
        # Only the two public hosts the gateway supports. Anchoring on the "https://<host>/" prefix
        # blocks non-https schemes (file://, ext::, ssh) and any other host, so this URL can't be
        # turned into an SSRF/local-file/command vector once it reaches `git`.
        if not (v.startswith("https://github.com/") or v.startswith("https://gitlab.com/")):
            raise ValueError(f"git skill clone_url must be a github.com/gitlab.com https URL: {v!r}")
        return v

    @field_validator("commit_sha")
    @classmethod
    def _validate_commit_sha(cls, v: str) -> str:
        if not COMMIT_SHA_RE.match(v):
            raise ValueError(f"git skill commit_sha must be a 40- or 64-char hex object id: {v!r}")
        return v

    @field_validator("subdir")
    @classmethod
    def _validate_subdir(cls, v: str) -> str:
        # Relative subpath within the repo. Reject absolute paths and ".." segments so it can't
        # escape the repo root. Leading/trailing slashes are stripped (repo root == ""). A leading
        # "-" is safe because subdirs are fed to `git sparse-checkout set` via stdin, never as args.
        if v.startswith("/"):
            raise ValueError(f"git skill subdir must be relative: {v!r}")
        stripped = v.strip("/")
        if stripped and ".." in stripped.split("/"):
            raise ValueError(f"git skill subdir must not contain '..': {v!r}")
        return stripped


class DownloadedGitSkill(BaseModel):
    """A git skill recorded on disk: its dir name, the commit it was installed at, and the repo
    subdir it was installed from. The commit lets a later run skip re-downloading when the requested
    commit is unchanged; the subdir is part of the identity so that changing the subdir at the same
    commit still triggers a re-download instead of serving the previously-installed layout."""

    model_config = ConfigDict(extra="ignore")

    name: str
    # Empty when migrated from a pre-commit-tracking state file — treated as "unknown", forcing a
    # one-time re-download while still keeping the name tracked for pruning.
    commit_sha: str = ""
    # Repo subdir the skill was installed from (repo root == ""). Empty on entries written before
    # subdir tracking; a mismatch against the requested subdir forces a one-time re-download.
    subdir: str = ""


class SkillDownloaderState(BaseModel):
    """Persisted next to skills; tracks what was downloaded so undesired skills can be pruned."""

    model_config = ConfigDict(extra="ignore")

    downloaded_git_skills: list[DownloadedGitSkill] = Field(
        default_factory=list,
        description="Git skills successfully downloaded (name + installed commit SHA).",
    )


def load_state() -> SkillDownloaderState:
    if not STATE_PATH.is_file():
        return SkillDownloaderState()
    try:
        raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return SkillDownloaderState()
    if not isinstance(raw, dict):
        return SkillDownloaderState()
    # Migrate a pre-commit-tracking state file: its `downloaded_git_names` (list of names, no commit)
    # becomes entries with an empty commit_sha. That keeps the names tracked so undesired skills are
    # still pruned, and forces a one-time re-download (empty != any requested commit). Skipped when
    # the new field is already present so we never clobber real commits.
    if "downloaded_git_skills" not in raw and isinstance(raw.get("downloaded_git_names"), list):
        raw["downloaded_git_skills"] = [
            {"name": n, "commit_sha": ""} for n in raw["downloaded_git_names"] if isinstance(n, str)
        ]
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


def _git_fetch_repo(
    clone_url: str, commit_sha: str, subdirs: list[str], parent_dir: Path
) -> Path:
    """SHA-pinned, shallow, blob-filtered sparse checkout of `subdirs` into a fresh repo under
    `parent_dir`, returning the repo working directory.

    When every requested subdir is the repo root ("") we can't sparse-restrict, so we do a full
    shallow checkout (all blobs). Otherwise we cone-sparse to just the requested subdirs and use
    --filter=blob:none so only those subdirs' blobs are fetched — the whole point of the approach.
    Subdirs are fed to `git sparse-checkout set` via stdin so a subdir value can never be read as an
    option/argument. Fetching by object id relies on the server allowing it, which github.com and
    gitlab.com both do."""
    repo = parent_dir / "repo"
    _run_git(["init", "-q", os.fspath(repo)], cwd=parent_dir)
    _run_git(["remote", "add", "origin", clone_url], cwd=repo)

    cone_dirs = [s for s in dict.fromkeys(subdirs) if s]  # de-duped, root ("") dropped
    want_full_tree = any(s == "" for s in subdirs)
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
    fetch_args += ["origin", commit_sha]
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
    src = (repo_root / skill.subdir).resolve() if skill.subdir else repo_root_resolved
    # Defense in depth: even though subdir is validated, ensure the resolved source stays within the
    # cloned repo (guards against a symlinked directory component pointing outside the checkout).
    if src != repo_root_resolved and not src.is_relative_to(repo_root_resolved):
        raise GitSkillError(
            f"Git skill {skill.name}: subdirectory '{skill.subdir}' escapes the repository"
        )
    if not src.is_dir():
        raise GitSkillError(
            f"Git skill {skill.name}: subdirectory '{skill.subdir}' not found in repository"
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


def _mark_git_downloaded(state: SkillDownloaderState, skill: GitSkill) -> None:
    """Upsert a git skill's installed commit + subdir so the next run can skip it when both are unchanged."""
    for entry in state.downloaded_git_skills:
        if entry.name == skill.name:
            entry.commit_sha = skill.commit_sha
            entry.subdir = skill.subdir
            return
    state.downloaded_git_skills.append(
        DownloadedGitSkill(name=skill.name, commit_sha=skill.commit_sha, subdir=skill.subdir)
    )


def _git_skill_already_installed(state: SkillDownloaderState, skill: GitSkill) -> bool:
    """True only when the skill is recorded at the requested commit AND subdir AND its directory is
    still present. Re-download otherwise (commit moved, subdir changed, first install, or the dir was
    removed out-of-band) so the prompt never points at a missing/stale skill dir."""
    dir_ = skill_dir(skill.name)
    if dir_ is None or not dir_.is_dir():
        return False
    return any(
        e.name == skill.name and e.commit_sha == skill.commit_sha and e.subdir == skill.subdir
        for e in state.downloaded_git_skills
    )


def download_git_skills(
    git_skills: list[GitSkill], state: SkillDownloaderState
) -> int:
    """Ensure desired git skills are installed at their requested commit, skipping any already present
    at that commit so an unchanged ref no longer re-clones every run.

    Failures are isolated per repo group and per skill so one bad repo/subdir doesn't prevent the
    rest from being attempted; each failure is logged to stderr. Returns the number of skills that are
    satisfied this run — freshly installed OR already present at the requested commit (never raises).
    The caller (run_git_download) compares this to the number requested and exits non-zero if any are
    missing, so the overall behaviour is fail-closed."""
    SKILLS_ROOT.mkdir(parents=True, exist_ok=True)

    # Skip skills already installed at the requested commit; only the rest need a clone.
    pending: list[GitSkill] = []
    satisfied = 0
    for skill in git_skills:
        if _git_skill_already_installed(state, skill):
            satisfied += 1
        else:
            pending.append(skill)

    # Group pending by (repo, commit) so a repo shared by several skills is cloned once and its
    # needed subdirs fetched together in a single sparse checkout.
    skills_by_repo: dict[tuple[str, str], list[GitSkill]] = {}
    for skill in pending:
        skills_by_repo.setdefault((skill.clone_url, skill.commit_sha), []).append(skill)

    for (clone_url, commit_sha), skills in skills_by_repo.items():
        try:
            with tempfile.TemporaryDirectory(
                prefix=".git-skill-dl-",
                dir=os.fspath(SKILLS_ROOT),
                ignore_cleanup_errors=True,
            ) as tmp_str:
                repo_root = _git_fetch_repo(
                    clone_url, commit_sha, [s.subdir for s in skills], Path(tmp_str)
                )
                # Install each skill independently so a bad subdir only skips that one skill.
                for skill in skills:
                    try:
                        _install_git_skill(repo_root, skill)
                        _mark_git_downloaded(state, skill)
                        satisfied += 1
                    except GitSkillError as e:
                        print(f"WARNING: {e}", file=sys.stderr)
        except GitSkillError as e:
            # Collect (don't abort-on-first) so EVERY failing skill is reported before the run exits;
            # run_git_download turns a non-zero failed count into a non-zero exit (fail-closed), which
            # fails the whole agent request. We still don't purge a previously installed copy here, so
            # a reused sandbox keeps the old files on disk even though this run is about to fail.
            names = ", ".join(s.name for s in skills)
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
