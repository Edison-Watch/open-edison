from tests.test_template import TestTemplate


class TestAgentAPI(TestTemplate):
    """Tests for the /agent management API."""

    def _auth(self) -> dict[str, str]:
        return {"Authorization": "Bearer dev-api-key-change-me"}

    def test_agent_session_upsert(self, test_client):
        resp = test_client.post(
            "/agent/session",
            json={"session_id": "sess-test-123"},
            headers=self._auth(),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data.get("ok") is True
        assert data.get("session_id") == "sess-test-123"

    def test_agent_begin_and_end_ok(self, test_client):
        headers = self._auth()
        # Begin tool call
        begin = test_client.post(
            "/agent/begin",
            json={
                "session_id": "sess-test-abc",
                "name": "agent_multiply",
                "args_summary": '{"args":[6,7]}',
                "timeout_s": 0.1,
            },
            headers=headers,
        )
        assert begin.status_code == 200, begin.text
        b = begin.json()
        assert b.get("ok") is True
        assert b.get("approved") in (True, False)
        call_id = b.get("call_id")
        assert isinstance(call_id, str)

        # End tool call (simulate success)
        end = test_client.post(
            "/agent/end",
            json={
                "session_id": "sess-test-abc",
                "call_id": call_id,
                "status": "ok",
                "duration_ms": 12.3,
                "result_summary": "42",
            },
            headers=headers,
        )
        assert end.status_code == 200, end.text
        e = end.json()
        assert e.get("ok") is True
