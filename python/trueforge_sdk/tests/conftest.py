import pytest


def _has_httpx_aiohttp() -> bool:
    """Check if httpx_aiohttp is importable."""
    try:
        import httpx_aiohttp  # type: ignore[import-not-found]  # noqa: F401

        return True
    except ImportError:
        return False


def pytest_collection_modifyitems(config: pytest.Config, items: list) -> None:
    """Auto-skip @pytest.mark.aiohttp tests when httpx_aiohttp is not installed."""
    if _has_httpx_aiohttp():
        return
    skip_aiohttp = pytest.mark.skip(reason="httpx_aiohttp not installed")
    for item in items:
        if "aiohttp" in item.keywords:
            item.add_marker(skip_aiohttp)
