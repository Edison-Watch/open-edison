# Ubuntu-based verification of README curl | bash installer
# This image builds if the installer succeeds on a clean Ubuntu environment.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Basic utilities required by the installer and uv
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       bash \
       xz-utils \
       tar \
    && rm -rf /var/lib/apt/lists/*

# Run the documented installer from README, but pass -h so the CLI exits quickly.
# The script will:
#  - install uv if missing
#  - install a managed Python 3.12 via uv
#  - exec `uvx open-edison -h` which prints help and exits 0
RUN curl -fsSL https://raw.githubusercontent.com/Edison-Watch/open-edison/main/curl_pipe_bash.sh | bash -s -- -h

# No default CMD; this image is only for build validation of the installer.

