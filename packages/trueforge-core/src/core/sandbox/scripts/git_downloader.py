#!/usr/bin/env python3

# /// script
# dependencies = ["pydantic==2.12.5"]
# ///

"""Materialize skill dirs into TFY_SKILLS_DIR from `.tfy-desired-skills.json`.

Desired file (uploaded by the host):
  { "skills": [ { "type": "git", ... } | { "type": "registry", ... } ] }

Git = sparse clone; registry = presigned tar. State tracks both arms for prune.
Desired file is deleted after reconcile. Env: TFY_SKILLS_DIR.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

DEFAULT_SKILLS_DIR = "/opt/tfy/skills"
STATE_FILE_NAME = ".tfy-skill-downloader-state.json"
DESIRED_FILE_NAME = ".tfy-desired-skills.json"
# Per-git-invocation wall-clock cap so a hung/slow fetch can't stall sandbox init indefinitely.
GIT_CLONE_TIMEOUT_SECONDS = 120
REGISTRY_DOWNLOAD_TIMEOUT_SECONDS = 120
REGISTRY_SKILL_MAX_BYTES = 200 * 1024 * 1024  # 200MB installed
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
    """Map skill name → path under SKILLS_ROOT, or None if unsafe (incl. state/desired filenames)."""
    if not name or name in (".", "..") or "/" in name or "\\" in name or name in (
        STATE_FILE_NAME,
        DESIRED_FILE_NAME,
    ):
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
    # Installed object id; empty = unknown → reinstall. Name still tracked for prune.
    ref: str = ""
    # Installed repo path ("" = root); mismatch vs desired forces reinstall.
    path: str = ""


class DownloadedRegistrySkill(BaseModel):
    """A registry skill recorded on disk: its FQN and name."""

    model_config = ConfigDict(extra="ignore")

    fqn: str
    name: str


class SkillDownloaderState(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Persisted git installs: name, object id, repo path.
    downloaded_git_skills: list[DownloadedGitSkill] = Field(default_factory=list)
    # Persisted registry installs: fqn + on-disk name.
    downloaded_fqns: list[DownloadedRegistrySkill] = Field(default_factory=list)


class RegistrySkillDesired(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: Literal["registry"] = "registry"
    name: str
    fqn: str = Field(min_length=1)
    presigned_url: str = Field(min_length=1)


class DesiredGitSkillEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: Literal["git"] = "git"
    name: str
    url: str
    path: str = ""
    ref: str


DesiredSkillEntry = Annotated[
    DesiredGitSkillEntry | RegistrySkillDesired,
    Field(discriminator="type"),
]


class DesiredSkillsFile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    skills: list[DesiredSkillEntry] = Field(default_factory=list)


def load_state() -> SkillDownloaderState:
    if not STATE_PATH.is_file():
        return SkillDownloaderState()
    try:
        return SkillDownloaderState.model_validate_json(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValidationError):
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


def load_desired_skills() -> tuple[list[GitSkill], list[RegistrySkillDesired]]:
    """Read desired file. Missing → empty (prune both arms)."""
    path = SKILLS_ROOT / DESIRED_FILE_NAME
    if not path.is_file():
        return [], []
    try:
        desired = DesiredSkillsFile.model_validate_json(path.read_text(encoding="utf-8"))
    except OSError as e:
        sys.exit(f"Could not read {DESIRED_FILE_NAME}: {e}")
    except ValidationError as e:
        sys.exit(f"Invalid {DESIRED_FILE_NAME}: {e}")

    git_skills: list[GitSkill] = []
    registry_skills: list[RegistrySkillDesired] = []
    for item in desired.skills:
        if isinstance(item, DesiredGitSkillEntry):
            try:
                git_skills.append(
                    GitSkill(name=item.name, url=item.url, path=item.path, ref=item.ref)
                )
            except ValidationError as e:
                sys.exit(f"Invalid git entry in {DESIRED_FILE_NAME}: {e}")
            continue
        if skill_dir(item.name) is None:
            sys.exit(f"Invalid registry skill name: {item.name!r}")
        registry_skills.append(item)
    return git_skills, registry_skills


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


def reconcile_registry_skills(
    registry_skills: list[RegistrySkillDesired], state: SkillDownloaderState
) -> list[str]:
    """Delete dirs for registry skills no longer desired; prune them from state."""
    desired_fqns = {s.fqn for s in registry_skills}
    removed: list[str] = []
    for entry in list(state.downloaded_fqns):
        if entry.fqn in desired_fqns:
            continue
        _delete_skill_dir_by_name(entry.name, label=f"stale registry fqn {entry.fqn}")
        removed.append(entry.fqn)
    state.downloaded_fqns = [e for e in state.downloaded_fqns if e.fqn in desired_fqns]
    return removed


def _registry_already_installed(state: SkillDownloaderState, skill: RegistrySkillDesired) -> bool:
    dir_ = skill_dir(skill.name)
    if dir_ is None or not dir_.is_dir():
        return False
    return any(e.fqn == skill.fqn and e.name == skill.name for e in state.downloaded_fqns)


def _mark_registry_downloaded(state: SkillDownloaderState, skill: RegistrySkillDesired) -> None:
    for entry in state.downloaded_fqns:
        if entry.fqn == skill.fqn:
            entry.name = skill.name
            return
    state.downloaded_fqns.append(DownloadedRegistrySkill(fqn=skill.fqn, name=skill.name))


def _install_registry_tar(skill: RegistrySkillDesired) -> None:
    dir_ = skill_dir(skill.name)
    if dir_ is None:
        raise RuntimeError(f"invalid skill name {skill.name!r}")
    if dir_.exists():
        shutil.rmtree(dir_)
    dir_.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(skill.presigned_url, timeout=REGISTRY_DOWNLOAD_TIMEOUT_SECONDS) as resp:
            data = resp.read(REGISTRY_SKILL_MAX_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise RuntimeError(f"download failed for {skill.fqn}: {e}") from e
    if len(data) > REGISTRY_SKILL_MAX_BYTES:
        raise RuntimeError(f"tar for {skill.fqn} exceeds {REGISTRY_SKILL_MAX_BYTES} bytes")
    with tempfile.TemporaryDirectory(prefix="tfy-skill-tar-") as tmp:
        tar_path = Path(tmp) / "skill.tar"
        tar_path.write_bytes(data)
        try:
            with tarfile.open(tar_path, mode="r:*") as tar:
                tar.extractall(path=dir_, filter="data")
        except (tarfile.TarError, OSError) as e:
            shutil.rmtree(dir_, ignore_errors=True)
            raise RuntimeError(f"extract failed for {skill.fqn}: {e}") from e


def download_registry_skills(
    registry_skills: list[RegistrySkillDesired], state: SkillDownloaderState
) -> int:
    satisfied = 0
    for skill in registry_skills:
        if _registry_already_installed(state, skill):
            satisfied += 1
            continue
        try:
            _install_registry_tar(skill)
            _mark_registry_downloaded(state, skill)
            satisfied += 1
        except RuntimeError as e:
            print(f"WARNING: {e}", file=sys.stderr)
    return satisfied


def _delete_desired_file() -> None:
    path = SKILLS_ROOT / DESIRED_FILE_NAME
    try:
        if path.is_file():
            path.unlink()
    except OSError as e:
        print(f"WARNING: could not delete {DESIRED_FILE_NAME}: {e}", file=sys.stderr)


def run_git_download() -> None:
    git_skills, registry_skills = load_desired_skills()
    state = load_state()
    removed_git = reconcile_git_skills(git_skills, state)
    removed_registry = reconcile_registry_skills(registry_skills, state)

    if not git_skills and not registry_skills:
        bits: list[str] = []
        if removed_git:
            bits.append(f"Removed {len(removed_git)} git skill(s)")
        if removed_registry:
            bits.append(f"Removed {len(removed_registry)} registry skill(s)")
        if bits:
            print(f"{'; '.join(bits)}. (desired empty.)")
        save_state(state)
        _delete_desired_file()
        return

    # Registry first: presigned URLs expire; git sparse clones can take much longer.
    registry_satisfied = download_registry_skills(registry_skills, state) if registry_skills else 0
    git_satisfied = download_git_skills(git_skills, state) if git_skills else 0
    registry_failed = len(registry_skills) - registry_satisfied
    git_failed = len(git_skills) - git_satisfied
    save_state(state)
    _delete_desired_file()

    suffix_parts: list[str] = []
    if removed_registry:
        suffix_parts.append(f"Removed {len(removed_registry)} stale registry skill(s)")
    if removed_git:
        suffix_parts.append(f"Removed {len(removed_git)} stale git skill(s)")
    suffix = f" {'; '.join(suffix_parts)}." if suffix_parts else ""

    if registry_failed or git_failed:
        parts: list[str] = []
        if registry_failed:
            parts.append(f"{registry_failed}/{len(registry_skills)} registry")
        if git_failed:
            parts.append(f"{git_failed}/{len(git_skills)} git")
        sys.exit(f"Failed to install {' and '.join(parts)} skill(s); see warnings above.{suffix}")

    ensured: list[str] = []
    if registry_skills:
        ensured.append(f"{registry_satisfied} registry")
    if git_skills:
        ensured.append(f"{git_satisfied} git")
    print(f"Ensured {' and '.join(ensured)} skill(s) (downloaded or already up to date).{suffix}")


def main() -> None:
    run_git_download()


if __name__ == "__main__":
    main()
