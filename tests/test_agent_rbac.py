"""
Tests for Agent RBAC system.

Tests agent identity tracking, permission overrides, and multi-agent scenarios.
"""

from pathlib import Path

import pytest

from src.middleware.data_access_tracker import DataAccessTracker, SecurityError
from src.middleware.session_tracking import get_session_from_db
from src.permissions import Permissions, apply_agent_overrides
from tests.test_template import TestTemplate


class TestAgentRBAC(TestTemplate):
    """Tests for agent-based RBAC system."""

    @pytest.fixture(autouse=True)
    def _override_config_dir_for_agents(self, monkeypatch: pytest.MonkeyPatch):
        """Override config dir to use test-specific config with agent configs."""
        test_config_dir = Path(__file__).parent / "test_config_dir"
        monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(test_config_dir))

    def _auth(self) -> dict[str, str]:
        return {"Authorization": "Bearer dev-api-key-change-me"}

    def test_agent_identity_tracking(self, test_client):
        """Test 1: Verify agent_name is stored in sessions and survives round-trip."""
        headers = self._auth()

        # Create session with agent identity
        begin = test_client.post(
            "/agent/begin",
            json={
                "session_id": "sess-hr-test-1",
                "name": "hr_get_employee_profile",
                "agent_name": "hr_assistant",
                "agent_type": "hr",
                "timeout_s": 0.1,
            },
            headers=headers,
        )
        assert begin.status_code == 200
        b = begin.json()
        assert b["ok"] is True
        assert b["session_id"] == "sess-hr-test-1"

        # Verify session stored with agent identity
        session = get_session_from_db("sess-hr-test-1")
        assert session.agent_name == "hr_assistant"
        assert session.agent_type == "hr"
        assert session.data_access_tracker is not None
        assert session.data_access_tracker.agent_name == "hr_assistant"

    def test_agent_list_endpoint(self, test_client):
        """Verify /api/agents endpoint lists configured agents."""
        headers = self._auth()

        response = test_client.get("/api/agents", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert "agents" in data

        agents = data["agents"]
        agent_names = {a["name"] for a in agents}

        # Should include our example agents
        assert "hr_assistant" in agent_names
        assert "eng_copilot" in agent_names
        assert "rd_researcher" in agent_names
        assert "finance_analyst" in agent_names

        # Check override flags
        hr_agent = next(a for a in agents if a["name"] == "hr_assistant")
        assert hr_agent["has_tool_overrides"] is True

        eng_agent = next(a for a in agents if a["name"] == "eng_copilot")
        assert eng_agent["has_tool_overrides"] is False

    def test_permission_overrides_applied(self):
        """Test 2: Verify agent-specific permissions override base permissions."""
        # Base permissions should allow write
        base_perms = Permissions()
        base_write = base_perms.get_tool_permission("builtin_write")
        assert base_write.enabled is True

        # HR assistant should have write blocked
        hr_perms = apply_agent_overrides(base_perms, "hr_assistant")
        hr_write = hr_perms.get_tool_permission("builtin_write")
        assert hr_write.enabled is False

        # Engineering copilot should use base (no overrides)
        eng_perms = apply_agent_overrides(base_perms, "eng_copilot")
        eng_write = eng_perms.get_tool_permission("builtin_write")
        assert eng_write.enabled is True

    def test_data_access_tracker_with_agent(self):
        """Test 3: DataAccessTracker uses agent-specific permissions."""
        # Create tracker for HR assistant
        tracker_hr = DataAccessTracker(agent_name="hr_assistant")

        # Write should be blocked for HR
        with pytest.raises(SecurityError):
            tracker_hr.add_tool_call("builtin_write")

        # Read tools should work
        tracker_hr.add_tool_call("builtin_read_file")  # Should not raise

        # Create tracker for engineering (no agent restrictions)
        tracker_eng = DataAccessTracker(agent_name="eng_copilot")

        # Write should work for engineering
        tracker_eng.add_tool_call("builtin_write")  # Should not raise

    def test_missing_agent_config_error(self):
        """Test 6: Verify fail-fast behavior when agent folder missing."""
        base_perms = Permissions()

        with pytest.raises(FileNotFoundError) as exc_info:
            apply_agent_overrides(base_perms, "nonexistent_agent")

        error_msg = str(exc_info.value)
        assert "Agent config folder not found" in error_msg
        assert "nonexistent_agent" in error_msg

    def test_agent_session_persistence(self, test_client):
        """Verify agent identity persists across multiple tool calls."""
        headers = self._auth()

        # First call sets agent identity
        begin1 = test_client.post(
            "/agent/begin",
            json={
                "session_id": "sess-persist-test",
                "name": "tool_one",
                "agent_name": "rd_researcher",
                "agent_type": "rd",
                "timeout_s": 0.1,
            },
            headers=headers,
        )
        assert begin1.status_code == 200
        call1 = begin1.json()

        # End first call
        test_client.post(
            "/agent/end",
            json={
                "session_id": "sess-persist-test",
                "call_id": call1["call_id"],
                "status": "ok",
            },
            headers=headers,
        )

        # Second call should preserve agent identity
        begin2 = test_client.post(
            "/agent/begin",
            json={
                "session_id": "sess-persist-test",
                "name": "tool_two",
                # No agent_name provided - should use existing
                "timeout_s": 0.1,
            },
            headers=headers,
        )
        assert begin2.status_code == 200

        # Verify session still has agent identity
        session = get_session_from_db("sess-persist-test")
        assert session.agent_name == "rd_researcher"
        assert session.agent_type == "rd"

    def test_cached_property_performance(self):
        """Verify permissions are cached within a tracker instance."""
        tracker = DataAccessTracker(agent_name="hr_assistant")

        # First access computes permissions
        perms1 = tracker.permissions

        # Second access should return same object (cached)
        perms2 = tracker.permissions

        assert perms1 is perms2  # Same object reference

    def test_finance_analyst_permissions(self):
        """Test finance analyst has read-only permissions."""
        base_perms = Permissions()
        fin_perms = apply_agent_overrides(base_perms, "finance_analyst")

        # All write operations should be blocked
        assert fin_perms.get_tool_permission("builtin_write").enabled is False
        assert fin_perms.get_tool_permission("builtin_search_replace").enabled is False
        assert fin_perms.get_tool_permission("builtin_delete_file").enabled is False
        assert fin_perms.get_tool_permission("builtin_run_terminal_cmd").enabled is False

        # Read operations should work (use base)
        assert fin_perms.get_tool_permission("builtin_read_file").enabled is True

    def test_rd_researcher_permissions(self):
        """Test R&D researcher has selective restrictions."""
        base_perms = Permissions()
        rd_perms = apply_agent_overrides(base_perms, "rd_researcher")

        # Delete should be blocked
        assert rd_perms.get_tool_permission("builtin_delete_file").enabled is False

        # Other operations use base permissions
        assert rd_perms.get_tool_permission("builtin_read_file").enabled is True
        assert rd_perms.get_tool_permission("builtin_write").enabled is True

    def test_multiple_agents_same_session_ignored(self, test_client):
        """Verify that once agent_name is set, subsequent calls with different agent_name are ignored."""
        headers = self._auth()

        # First call with hr_assistant
        begin1 = test_client.post(
            "/agent/begin",
            json={
                "session_id": "sess-multi-agent",
                "name": "tool_one",
                "agent_name": "hr_assistant",
                "agent_type": "hr",
                "timeout_s": 0.1,
            },
            headers=headers,
        )
        assert begin1.status_code == 200

        # Second call tries to change agent (should be ignored)
        begin2 = test_client.post(
            "/agent/begin",
            json={
                "session_id": "sess-multi-agent",
                "name": "tool_two",
                "agent_name": "eng_copilot",  # Different agent
                "agent_type": "engineering",
                "timeout_s": 0.1,
            },
            headers=headers,
        )
        assert begin2.status_code == 200

        # Verify session still has first agent
        session = get_session_from_db("sess-multi-agent")
        assert session.agent_name == "hr_assistant"
        assert session.agent_type == "hr"


class TestAgentPermissionOverrides(TestTemplate):
    """Tests for permission override mechanics."""

    @pytest.fixture(autouse=True)
    def _override_config_dir_for_agents(self, monkeypatch: pytest.MonkeyPatch):
        """Override config dir to use test-specific config with agent configs."""
        test_config_dir = Path(__file__).parent / "test_config_dir"
        monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(test_config_dir))

    def test_override_merging(self):
        """Verify overrides merge correctly with base permissions."""
        base_perms = Permissions()

        # HR has 4 tool overrides (write, search_replace, delete_file, run_terminal_cmd)
        hr_perms = apply_agent_overrides(base_perms, "hr_assistant")

        # Check overridden tools are blocked
        assert hr_perms.get_tool_permission("builtin_write").enabled is False
        assert hr_perms.get_tool_permission("builtin_search_replace").enabled is False

        # Check non-overridden tools use base (enabled)
        assert hr_perms.get_tool_permission("builtin_read_file").enabled is True
        assert hr_perms.get_tool_permission("builtin_grep").enabled is True

    def test_empty_agent_folder(self):
        """Verify empty agent folder (eng_copilot) uses base permissions."""
        base_perms = Permissions()
        eng_perms = apply_agent_overrides(base_perms, "eng_copilot")

        # Should be identical to base
        assert eng_perms.get_tool_permission("builtin_write").enabled is True
        assert eng_perms.get_tool_permission("builtin_delete_file").enabled is True

    def test_partial_overrides(self):
        """Verify agents can override only specific permissions."""
        base_perms = Permissions()
        rd_perms = apply_agent_overrides(base_perms, "rd_researcher")

        # Only delete_file is overridden
        assert rd_perms.get_tool_permission("builtin_delete_file").enabled is False

        # Everything else uses base
        assert rd_perms.get_tool_permission("builtin_write").enabled is True
        assert rd_perms.get_tool_permission("builtin_read_file").enabled is True


class TestAgentSecurityEnforcement(TestTemplate):
    """Tests for security enforcement with agents."""

    @pytest.fixture(autouse=True)
    def _override_config_dir_for_agents(self, monkeypatch: pytest.MonkeyPatch):
        """Override config dir to use test-specific config with agent configs."""
        test_config_dir = Path(__file__).parent / "test_config_dir"
        monkeypatch.setenv("OPEN_EDISON_CONFIG_DIR", str(test_config_dir))

    def _auth(self) -> dict[str, str]:
        return {"Authorization": "Bearer dev-api-key-change-me"}

    def test_hr_agent_blocked_from_writes(self, test_client):
        """Verify HR agent session is created with agent identity."""
        headers = self._auth()

        # Create HR agent session
        begin = test_client.post(
            "/agent/begin",
            json={
                "session_id": "sess-hr-write-block",
                "name": "hr_lookup_policy",  # Use an agent tool
                "agent_name": "hr_assistant",
                "agent_type": "hr",
                "timeout_s": 0.1,
            },
            headers=headers,
        )
        assert begin.status_code == 200
        b = begin.json()
        assert b["ok"] is True

        # Verify HR agent identity was set
        session = get_session_from_db("sess-hr-write-block")
        assert session.agent_name == "hr_assistant"
        assert session.agent_type == "hr"

        # Verify HR agent has write blocked via permission check
        perms = (
            session.data_access_tracker.permissions
            if session.data_access_tracker
            else Permissions()
        )
        assert perms.get_tool_permission("builtin_write").enabled is False

    def test_eng_agent_allowed_writes(self, test_client):
        """Verify Engineering agent identity is set and uses base permissions."""
        headers = self._auth()

        # Create Engineering agent session
        begin = test_client.post(
            "/agent/begin",
            json={
                "session_id": "sess-eng-test",
                "name": "multiply",  # Use a safe demo tool
                "agent_name": "eng_copilot",
                "agent_type": "engineering",
                "timeout_s": 0.1,
            },
            headers=headers,
        )
        assert begin.status_code == 200
        b = begin.json()
        assert b["ok"] is True

        # Verify agent identity was set
        session = get_session_from_db("sess-eng-test")
        assert session.agent_name == "eng_copilot"
        assert session.agent_type == "engineering"

        # Verify eng_copilot has no overrides (uses base permissions)
        assert session.data_access_tracker is not None
        perms = session.data_access_tracker.permissions
        # Should have base permissions (write enabled)
        assert perms.get_tool_permission("builtin_write").enabled is True

    def test_no_agent_uses_base_permissions(self, test_client):
        """Verify sessions without agent_name use base permissions."""
        headers = self._auth()

        # Create session without agent identity (use safe tool)
        begin = test_client.post(
            "/agent/begin",
            json={
                "session_id": "sess-no-agent",
                "name": "builtin_read_file",
                # No agent_name/agent_type
                "timeout_s": 0.1,
            },
            headers=headers,
        )
        assert begin.status_code == 200
        b = begin.json()
        assert b["ok"] is True

        # Verify session has no meaningful agent identity
        session = get_session_from_db("sess-no-agent")
        assert session.agent_name in (None, "", "None")  # Any of these means "not set"
        assert session.agent_type in (None, "", "None")


def test_template_sanity():
    """Sanity check that base template works."""
    assert True
