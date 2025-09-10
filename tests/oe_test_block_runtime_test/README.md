Runtime test of Open-edison preventing data-exflitration 

- Edit config.json filesystem tool's working path to your current directory or a tmp directory
- (Optional for Claude Code) Add the tool deny instructions from the file claude_code_deny.md into .claude/settings.json
- run open-edison using the following command, replacing the path with the path of open-edison
 OPEN_EDISON_CONFIG_DIR={your path to}/open-edison/tests/oe_test_block_runtime_test uv run open-edison
- wait for the servers to come live and open the dashboard on http://localhost:3001
- run your agent and use the prompt from prompt.txt
- wait for the commands to finish and verify the Approve/Deny prompt on the dashboard when the agent attempts to write the file
