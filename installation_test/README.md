# Installation Test (Ubuntu)

This directory contains a Dockerfile that validates the README curl | bash installer on a clean Ubuntu environment.

How it works:

- Uses `ubuntu:24.04`
- Installs minimal prerequisites (`curl`, `ca-certificates`, etc.)
- Runs the documented installer: `curl -fsSL https://raw.githubusercontent.com/Edison-Watch/open-edison/main/curl_pipe_bash.sh | bash -s -- -h`
  - The `-h` flag is forwarded to `open-edison`, so the installer prints help and exits 0, making the Docker build fast and non-interactive.

Build locally:

```bash
make install_curl_test
```

If the build completes successfully, the installer path is healthy. If it fails, the build will error and show logs with the failing step (e.g., uv install, Python 3.12, or `uvx open-edison`).
