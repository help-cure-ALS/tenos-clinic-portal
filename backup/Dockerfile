FROM postgres:16-alpine

RUN apk add --no-cache \
        bash \
        ca-certificates \
        curl \
        restic \
        tzdata \
    && update-ca-certificates

COPY scripts/*.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/*.sh

ENV RESTIC_CACHE_DIR=/cache/restic

ENTRYPOINT ["backup-entrypoint.sh"]
