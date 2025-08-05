# TODO for first release of open-edison

- [x] Proxy + API (fastmcp + FastAPI)
  - [x] Easy launch (PyPI package later), using Makefile
  - [x] Docker image
  - Notes: Use similar setup to edison.watch server.
- [x] No multi-user, no hosted tools
  - [ ] Single fastmcp server (basic structure done, needs MCP integration)
  - [x] No auth infra necessary (fixed API key, set in config, but that's it)
  - [x] JSON config
    - [ ] One config for trifecta tool descriptions (TODO: implement)
    - [x] One for general config
    - [x] One config for MCP servers (use MCP JSON standard for ease of use)
- [ ] Session tracking
  - [ ] Log to DB (sqlite local) - postponed for now
- [ ] Locally runnable frontend
  - [ ] Built with lovable
  - [ ] Sessions view, on/off servers, restart fastmcp
- [ ] Nice transition path to edison.watch
  - [x] Make all the config portable across projects

## Completed Scaffolding

- [x] Python project setup (pyproject.toml)
- [x] Main entry point (main.py)
- [x] Basic FastAPI server structure
- [x] JSON configuration system
- [x] MCP proxy structure (needs fastmcp integration)
- [x] Makefile for development workflow
- [x] Docker support
- [x] Basic tests
- [x] Updated README

## Next Steps

1. Integrate fastmcp for actual MCP communication
2. Implement proper MCP request routing and handling
3. Add session logging to SQLite
4. Build frontend for management
5. Add more comprehensive tests
