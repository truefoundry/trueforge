#!/usr/bin/env python3
"""Re-export the hand-written event helpers from the generated Python barrel after Fern regen."""

from __future__ import annotations

from pathlib import Path

INIT = Path(__file__).resolve().parents[1] / "python/trueforge_sdk/src/trueforge_sdk/__init__.py"

# Appended rather than spliced into the generated lists, so a regen that reorders
# or renames entries cannot silently drop these exports.
BLOCK = '''

# Hand-written helpers (see .fernignore), registered into the lazy barrel above.
if typing.TYPE_CHECKING:
    from .events import is_event_delta, merge_event_delta

_dynamic_imports["is_event_delta"] = ".events"
_dynamic_imports["merge_event_delta"] = ".events"
__all__ += ["is_event_delta", "merge_event_delta"]
'''

text = INIT.read_text()
if "_dynamic_imports" not in text or "__all__" not in text:
    raise SystemExit(f"{INIT} is not the expected Fern barrel")
if BLOCK not in text:
    INIT.write_text(text + BLOCK)
