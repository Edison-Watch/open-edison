# TODO for first release of open-edison

- [ ] Proxy + API (fastmcp + FastAPI)
  - [ ] Easy launch (PyPI package later), using Makefile
  - [ ] Docker image
  - Notes: Use similar setup to edison.watch server.
- [ ] No multi-user, no hosted tools
  - [ ] Single fastmcp server
  - [ ] No auth infra necessary (fixed API key, set in config, but that's it)
  - [ ] JSON config
    - [ ] One config for trifecta tool descriptions
    - [ ] One for general config
    - [ ] One config for MCP servers (use MCP JSON standard for ease of use)
- [ ] Session tracking
  - [ ] Log to DB (sqlite local)
- [ ] Locally runnable frontend
  - [ ] Built with lovable
  - [ ] Sessions view, on/off servers, restart fastmcp
- [ ] Nice transition path to edison.watch
  - [ ] Make all the config portable across projects
