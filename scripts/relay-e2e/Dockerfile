FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl qemu-system-x86 qemu-utils cloud-image-utils \
    openssh-client python3 && apt-get clean
WORKDIR /experiment
