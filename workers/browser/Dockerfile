FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY dist/ ./dist/

# Non-root user — browser automation must never run as root
RUN groupadd --gid 1001 mammoth && \
    useradd --uid 1001 --gid mammoth --shell /bin/bash --create-home mammoth

USER mammoth

# 256MB RAM, 30s timeout enforced at Docker run level:
# docker run --memory=256m --cpus=0.5 ...
EXPOSE 3003

CMD ["node", "dist/index.js"]
