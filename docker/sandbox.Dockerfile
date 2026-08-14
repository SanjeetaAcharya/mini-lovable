# Throwaway image used to validate LLM-generated static sites before they
# are ever deployed. Build once, ahead of time, and reuse the image for
# every generation:
#
#   docker build -f docker/sandbox.Dockerfile -t mini-lovable-sandbox docker/
#
# services/sandbox.service.ts then runs one short-lived, disposable
# container per generation from this image, with no network access, hard
# memory/CPU/pids/time limits, and no bind-mount write access — see that
# file for the exact `docker run` flags.
#
# --- What this protects against ------------------------------------------
#
# - The container never executes anything from the generated file set. It
#   only opens files as text to size- and extension-check them, and
#   structurally parses index.html with Python's stdlib HTML parser. There
#   is no interpreter in this image capable of running the generated JS,
#   and no build step is invoked (the system prompt already forbids
#   frameworks and build tooling, so there is nothing to build).
# - Runs as a non-root, shell-less user, so even a bug in validate.py
#   itself has no meaningful privilege to abuse inside the container.
# - The caller runs this image with `--network none`, `--read-only`,
#   `--cap-drop ALL`, `--security-opt no-new-privileges`, and a
#   `--pids-limit`, so even a compromised process in the container cannot
#   reach the network, write to the filesystem, gain capabilities, or
#   fork-bomb the host.
# - The caller also enforces a hard wall-clock timeout and always removes
#   the container afterward (success, failure, or timeout), so a hung or
#   malicious process can't tie up resources indefinitely.
#
# --- What this does NOT protect against, compared to a purpose-built
#     sandbox like E2B or Blaxel -----------------------------------------
#
# - This is a shared-kernel Linux container, not a hardware-virtualized
#   microVM. Every container on the host shares the same kernel. A kernel
#   exploit or a container-runtime escape vulnerability could reach the
#   host or other containers in a way that a microVM's hardware boundary
#   is specifically designed to prevent. Docker's isolation is namespace-
#   and cgroup-based, not a security boundary against a truly adversarial,
#   sandbox-aware payload.
# - There is no per-request tenant isolation beyond the container itself —
#   e.g. no dedicated VM, no seccomp profile tuned beyond Docker's default,
#   no gVisor/Kata-style user-space kernel between the container and the
#   host kernel. A production system handling untrusted code at scale
#   would want one of those.
# - This container is never given anything to execute in the first place
#   (static files only, read-only mount, no interpreter for the generated
#   JS), so most of the above gap matters less here than it would for a
#   sandbox whose whole job is to *run* untrusted code. That's a
#   deliberate scope choice, not a claim that this is equivalently safe —
#   documented honestly rather than assumed.

FROM python:3.12-alpine

# No shell, no home directory, no login — just enough identity to own the
# process the entrypoint runs as.
RUN adduser -D -H -s /sbin/nologin sandbox

# Baked into the image at build time, not fetched at container-run time —
# the container needs zero network access to do its job, which is part of
# why `--network none` is safe to enforce unconditionally.
COPY validate.py /usr/local/bin/validate.py
RUN chmod 555 /usr/local/bin/validate.py

USER sandbox
WORKDIR /workspace

ENTRYPOINT ["python3", "/usr/local/bin/validate.py"]
