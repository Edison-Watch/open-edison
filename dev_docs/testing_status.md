# Installation and Testing Status Matrix

Simple matrix of install method by platform, with current testing/infra status and exact commands where manual steps are needed.

| Install method       | macOS                                                                                                         | Linux (debian-based)                                                                                                                            | Windows                                                                                                                                                                  |
|----------------------|---------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| direct uvx           | uvx open-edison; if uv missing: sh -c "$(curl -fsSL <https://astral.sh/uv/install.sh>)"; then uvx open-edison | uvx open-edison; if uv missing: sh -c "$(curl -fsSL <https://astral.sh/uv/install.sh>)"; then uvx open-edison                                   | PowerShell: powershell -ExecutionPolicy ByPass -c "iex (irm <https://astral.sh/uv/install.ps1>)"; then uvx open-edison                                                   |
| curl pipe bash       | bash -lc "$(curl -fsSL <https://raw.githubusercontent.com/Edison-Watch/open-edison/main/curl_pipe_bash.sh>)"  | make install_curl_test; or: bash -lc "$(curl -fsSL <https://raw.githubusercontent.com/Edison-Watch/open-edison/main/curl_pipe_bash.sh>)" -- -h  | no current setup                                                                                                                                                         |
| clone & make run     | git clone <https://github.com/Edison-Watch/open-edison.git> && cd open-edison && make setup && make run       | git clone <https://github.com/Edison-Watch/open-edison.git> && cd open-edison && make setup && make run                                         | no current setup                                                                                                                                                         |
| clone & docker_run   | git clone <https://github.com/Edison-Watch/open-edison.git> && cd open-edison && make docker_run              | git clone <https://github.com/Edison-Watch/open-edison.git> && cd open-edison && make docker_run                                                | PowerShell: git clone <https://github.com/Edison-Watch/open-edison.git>; cd open-edison; docker build -t open-edison .; docker run -p 3000:3000 -p 3001:3001 open-edison |

Notes:

- The Linux curl test uses the installer validation image via `make install_curl_test` (`installation_test/Dockerfile`).
- Docker volume mounts and config overrides are optional; see `docs/deployment/docker.md` for details.
- To pass flags to `open-edison` through the curl installer, you can use the pipe form `curl ... \| bash -s -- -h`, or with the subshell form: `bash -lc "$(curl -fsSL <https://raw.githubusercontent.com/Edison-Watch/open-edison/main/curl_pipe_bash.sh>)" -- -h`.

## CI and Make Target Summary

High-level summary of automation coverage for each install path and platform.

| Install method       | macOS                           | Linux (debian-based) | Windows     |
|----------------------|---------------------------------|----------------------|-------------|
| direct uvx           | CI                              | CI                   | Manual only |
| curl pipe bash       | CI                              | CI                   | None        |
| clone & make run     | CI                              | CI                   | None        |
| clone & docker_run   | None (no nested virtualization) | CI                   | Manual only |

Notes:

- macOS has CI coverage for the "clone & make run" path via GitHub Actions runners.
- Linux has CI coverage for the "direct uvx" path (Ubuntu 22.04, 24.04 matrix) via package build + `uvx ... --help` smoke.
- curl|bash installer runs as a smoke test on macOS and Ubuntu.
- Docker on GitHub-hosted macOS runners is not supported due to virtualization limitations; job is disabled by default. Ubuntu uses native Docker on hosted runners. See `setup-docker-on-macos` action notes [link](https://github.com/marketplace/actions/setup-docker-on-macos).
- "Make target" indicates a reproducible local target exists in the `Makefile` (e.g., `make install_curl_test`, `make run`, `make docker_run`).
