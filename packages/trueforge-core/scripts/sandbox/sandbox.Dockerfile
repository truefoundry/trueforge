FROM python:3.13-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ARG NATS_SERVER_VERSION="v2.14.2"
ARG HELM_VERSION="v4.2.3"

RUN apt-get update \
      && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        jq \
        ripgrep \
        supervisor \
        tree \
        unzip \
        zip \
      && curl -LO https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz \
      && tar -zxvf helm-${HELM_VERSION}-linux-amd64.tar.gz \
      && mv linux-amd64/helm /usr/local/bin/helm \
      && rm -rf helm-${HELM_VERSION}-linux-amd64.tar.gz linux-amd64 \
      && helm version \
      && curl -L https://github.com/nats-io/nats-server/releases/download/${NATS_SERVER_VERSION}/nats-server-${NATS_SERVER_VERSION}-linux-amd64.tar.gz -o /tmp/nats-server.tar.gz \
      && tar -xzf /tmp/nats-server.tar.gz -C /tmp \
      && mv /tmp/nats-server-${NATS_SERVER_VERSION}-linux-amd64/nats-server /usr/local/bin/nats-server \
      && rm -rf /tmp/nats-server.tar.gz /tmp/nats-server-${NATS_SERVER_VERSION}-linux-amd64 \
      && mkdir -p /var/lib/nats /var/log/nats \
      && nats-server --version \
      && git config --global user.email "trueforge@example.org" \
      && git config --global user.name "TrueForge Agent" \
      && python -m pip install --no-cache-dir --upgrade pip \
      && python -m pip install --no-cache-dir \
        aiohttp==3.14.1 \
        genson==1.3.0 \
        mcp==1.29.0 \
        nats-py==2.15.0 \
        openpyxl==3.1.5 \
        pandas==3.0.5 \
        pydantic==2.12.5 \
        requests==2.33.1 \
      && rm -rf /var/lib/apt/lists/*

COPY nats.supervisor.conf /etc/supervisor/conf.d/nats.conf
COPY nats.conf /var/lib/nats/nats.conf
WORKDIR /home/trueforge
ENTRYPOINT ["/usr/bin/supervisord", "-n"]
