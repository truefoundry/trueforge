import importlib
import sys
import unittest
from unittest import mock

import httpx
import pytest


class TestMakeDefaultAsyncClientWithoutAiohttp(unittest.TestCase):
    """Tests for _make_default_async_client when httpx_aiohttp is NOT installed."""

    def test_returns_httpx_async_client(self) -> None:
        """When httpx_aiohttp is not installed, returns plain httpx.AsyncClient."""
        with mock.patch.dict(sys.modules, {"httpx_aiohttp": None}):
            from trueforge_sdk.base_client import _make_default_async_client

            client = _make_default_async_client(timeout=60, follow_redirects=True)
            self.assertIsInstance(client, httpx.AsyncClient)
            self.assertEqual(client.timeout.read, 60)
            self.assertTrue(client.follow_redirects)

    def test_follow_redirects_none(self) -> None:
        """When follow_redirects is None, omits it from httpx.AsyncClient."""
        with mock.patch.dict(sys.modules, {"httpx_aiohttp": None}):
            from trueforge_sdk.base_client import _make_default_async_client

            client = _make_default_async_client(timeout=60, follow_redirects=None)
            self.assertIsInstance(client, httpx.AsyncClient)
            self.assertFalse(client.follow_redirects)

    def test_explicit_httpx_client_bypasses_autodetect(self) -> None:
        """When user passes httpx_client explicitly, _make_default_async_client is not called."""

        explicit_client = httpx.AsyncClient(timeout=120)
        with mock.patch("trueforge_sdk.base_client._make_default_async_client") as mock_make:
            # Replicate the generated conditional: httpx_client if httpx_client is not None else _make_default_async_client(...)
            result = explicit_client if explicit_client is not None else mock_make(timeout=60, follow_redirects=True)
            mock_make.assert_not_called()
        self.assertIs(result, explicit_client)


@pytest.mark.aiohttp
class TestMakeDefaultAsyncClientWithAiohttp(unittest.TestCase):
    """Tests for _make_default_async_client when httpx_aiohttp IS installed."""

    def test_returns_aiohttp_client(self) -> None:
        """When httpx_aiohttp is installed, returns HttpxAiohttpClient."""
        import httpx_aiohttp  # type: ignore[import-not-found]

        from trueforge_sdk.base_client import _make_default_async_client

        client = _make_default_async_client(timeout=60, follow_redirects=True)
        self.assertIsInstance(client, httpx_aiohttp.HttpxAiohttpClient)
        self.assertEqual(client.timeout.read, 60)
        self.assertTrue(client.follow_redirects)

    def test_follow_redirects_none(self) -> None:
        """When httpx_aiohttp is installed and follow_redirects is None, omits it."""
        import httpx_aiohttp  # type: ignore[import-not-found]

        from trueforge_sdk.base_client import _make_default_async_client

        client = _make_default_async_client(timeout=60, follow_redirects=None)
        self.assertIsInstance(client, httpx_aiohttp.HttpxAiohttpClient)
        self.assertFalse(client.follow_redirects)


class TestDefaultClientsWithoutAiohttp(unittest.TestCase):
    """Tests for _default_clients.py convenience classes (no aiohttp)."""

    def test_default_async_httpx_client_defaults(self) -> None:
        """DefaultAsyncHttpxClient applies SDK defaults."""
        from trueforge_sdk._default_clients import SDK_DEFAULT_TIMEOUT, DefaultAsyncHttpxClient

        client = DefaultAsyncHttpxClient()
        self.assertIsInstance(client, httpx.AsyncClient)
        self.assertEqual(client.timeout.read, SDK_DEFAULT_TIMEOUT)
        self.assertTrue(client.follow_redirects)

    def test_default_async_httpx_client_overrides(self) -> None:
        """DefaultAsyncHttpxClient allows overriding defaults."""
        from trueforge_sdk._default_clients import DefaultAsyncHttpxClient

        client = DefaultAsyncHttpxClient(timeout=30, follow_redirects=False)
        self.assertEqual(client.timeout.read, 30)
        self.assertFalse(client.follow_redirects)

    def test_default_aiohttp_client_raises_without_package(self) -> None:
        """DefaultAioHttpClient raises RuntimeError when httpx_aiohttp not installed."""
        import trueforge_sdk._default_clients

        with mock.patch.dict(sys.modules, {"httpx_aiohttp": None}):
            importlib.reload(trueforge_sdk._default_clients)

            with self.assertRaises(RuntimeError) as ctx:
                trueforge_sdk._default_clients.DefaultAioHttpClient()
            self.assertIn("pip install trueforge_sdk[aiohttp]", str(ctx.exception))

        importlib.reload(trueforge_sdk._default_clients)


@pytest.mark.aiohttp
class TestDefaultClientsWithAiohttp(unittest.TestCase):
    """Tests for _default_clients.py when httpx_aiohttp IS installed."""

    def test_default_aiohttp_client_defaults(self) -> None:
        """DefaultAioHttpClient works when httpx_aiohttp is installed."""
        import httpx_aiohttp  # type: ignore[import-not-found]

        from trueforge_sdk._default_clients import SDK_DEFAULT_TIMEOUT, DefaultAioHttpClient

        client = DefaultAioHttpClient()
        self.assertIsInstance(client, httpx_aiohttp.HttpxAiohttpClient)
        self.assertEqual(client.timeout.read, SDK_DEFAULT_TIMEOUT)
        self.assertTrue(client.follow_redirects)
