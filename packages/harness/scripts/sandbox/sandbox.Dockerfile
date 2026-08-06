FROM python:3.13-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ARG NATS_SERVER_VERSION=2.14.2

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
      && git config --global user.email "trueforge@example.org" \
      && git config --global user.name "TrueForge Agent" \
      && curl -L https://github.com/nats-io/nats-server/releases/download/v${NATS_SERVER_VERSION}/nats-server-v${NATS_SERVER_VERSION}-linux-amd64.tar.gz -o /tmp/nats-server.tar.gz \
      && tar -xzf /tmp/nats-server.tar.gz -C /tmp \
      && mv /tmp/nats-server-v${NATS_SERVER_VERSION}-linux-amd64/nats-server /usr/local/bin/nats-server \
      && rm -rf /tmp/nats-server.tar.gz /tmp/nats-server-v${NATS_SERVER_VERSION}-linux-amd64 \
      && mkdir -p /var/lib/nats /var/log/nats \
      && python -m pip install --no-cache-dir --upgrade pip \
      && python -m pip install --no-cache-dir \
        aiohttp==3.14.1 \
        fastmcp==3.2.4 \
        genson==1.3.0 \
        nats-py==2.15.0 \
        pydantic==2.12.5 \
        requests==2.33.1 \
      && rm -rf /var/lib/apt/lists/*

COPY nats.supervisor.conf /etc/supervisor/conf.d/nats.conf
COPY nats.conf /var/lib/nats/nats.conf
WORKDIR /home/trueforge
ENTRYPOINT ["/usr/bin/supervisord", "-n"]
