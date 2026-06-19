/**
 * Bundled infrastructure compose file.
 * Written to ~/.mammoth/docker-compose.yml on first init.
 * Contains only stateless infra services — api/workers run separately.
 */
export const DOCKER_COMPOSE_TEMPLATE = `version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    container_name: mammoth_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: mammoth
      POSTGRES_PASSWORD: mammoth_dev
      POSTGRES_DB: mammoth
    ports:
      - "5432:5432"
    volumes:
      - mammoth_postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mammoth -d mammoth"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: mammoth_redis
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    volumes:
      - mammoth_redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  qdrant:
    image: qdrant/qdrant:v1.9.0
    container_name: mammoth_qdrant
    restart: unless-stopped
    ports:
      - "6333:6333"
    volumes:
      - mammoth_qdrant:/qdrant/storage
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:6333/healthz || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10

  minio:
    image: minio/minio:latest
    container_name: mammoth_minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin_dev
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - mammoth_minio:/data
    healthcheck:
      test: ["CMD-SHELL", "mc ready local || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  mammoth_postgres:
  mammoth_redis:
  mammoth_qdrant:
  mammoth_minio:
`;
