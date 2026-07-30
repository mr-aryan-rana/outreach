import asyncio
import logging

from request_logging import RequestLoggingMiddleware, configure_json_logging


class DummyResponse:
    def __init__(self):
        self.status_code = 200
        self.headers = {}


class DummyRequest:
    def __init__(self, headers=None, method="POST", path="/validate"):
        self.headers = headers or {}
        self.method = method

        class URL:
            def __init__(self, path):
                self.path = path

        self.url = URL(path)


async def _fake_app(scope, receive, send):
    pass


def test_configure_json_logging_returns_named_logger():
    logger = configure_json_logging("validator")
    assert logger.name == "validator"
    assert logger.level == logging.INFO


def test_dispatch_generates_and_echoes_request_id():
    logger = configure_json_logging("validator")
    middleware = RequestLoggingMiddleware(_fake_app, logger=logger, service_name="validator")

    async def call_next(_request):
        return DummyResponse()

    request = DummyRequest()
    response = asyncio.run(middleware.dispatch(request, call_next))

    assert "x-request-id" in response.headers
    assert response.headers["x-request-id"]


def test_dispatch_preserves_incoming_request_id():
    logger = configure_json_logging("validator")
    middleware = RequestLoggingMiddleware(_fake_app, logger=logger, service_name="validator")

    async def call_next(_request):
        return DummyResponse()

    request = DummyRequest(headers={"x-request-id": "abc-123"})
    response = asyncio.run(middleware.dispatch(request, call_next))

    assert response.headers["x-request-id"] == "abc-123"
