# ============================================================
# Golden Flower Poker AI - 多阶段 Docker 构建
# 阶段1: 构建前端静态文件
# 阶段2: 运行后端 + serve 前端
# ============================================================

# ---- 阶段1: 构建前端 ----
FROM node:22-slim AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 阶段2: 后端运行环境 ----
FROM python:3.11-slim

# 安装系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# 安装 uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app/backend

# 先复制依赖文件，利用 Docker 缓存
COPY backend/pyproject.toml backend/uv.lock ./

# 安装依赖
RUN uv sync --frozen --no-dev --no-install-project

# 复制后端源码
COPY backend/ ./

# 安装项目自身
RUN uv sync --frozen --no-dev

# 从阶段1复制前端构建产物
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# 创建数据目录和日志目录
RUN mkdir -p /app/data /app/backend/logs

# 环境变量
ENV DATABASE_URL=sqlite+aiosqlite:////app/data/golden_flower.db
ENV DEBUG=false
ENV LOG_LEVEL=INFO

EXPOSE 8000

# 启动后端
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
