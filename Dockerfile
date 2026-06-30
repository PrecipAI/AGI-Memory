# AGI-Memory Render 部署 Dockerfile
# 单 stage 构建（处理 npm workspace + file: 依赖）

FROM node:20-alpine

WORKDIR /app

# 复制整个项目（.dockerignore 已过滤 node_modules/dist/.env/.git）
COPY . .

# 安装全部依赖（workspace + file: 依赖需要 libs/ 源码在位）
RUN npm install --no-audit --no-fund

# 编译 TypeScript（全 workspace）
RUN npm run build

# 容器环境必须监听 0.0.0.0
ENV HOST=0.0.0.0
ENV NODE_ENV=production
EXPOSE 3101

# 启动：先跑数据库 migration，再启动服务
# Render 会注入 PORT 和 DB_URL 环境变量
CMD npm run db:migrate && node dist/services/memory-service/src/index.js
