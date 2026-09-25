# 部署文档

本文档介绍如何将 Golden Flower Poker AI 部署到云服务器（以 Azure VM + Ubuntu 24.04 为例）。

## 架构概览

```
浏览器 → nginx (:80) → FastAPI backend (:8000) → LLM API (云端)
              ↓                    ↓
        前端静态文件          SQLite 数据库
```

- **nginx**: 反向代理，serve 前端静态文件，转发 API/WebSocket 请求到后端
- **backend**: FastAPI 应用，处理游戏逻辑和 LLM 调用
- **数据库**: SQLite 文件存储，无需额外数据库服务
- **容器化**: Docker + Docker Compose 编排

## 服务器要求

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| CPU | 1 vCPU | 2 vCPU |
| 内存 | 2 GiB | 4 GiB |
| 磁盘 | 10 GB | 20 GB |
| 系统 | Ubuntu 22.04+ | Ubuntu 24.04 LTS |
| 网络 | 开放 22 (SSH)、80 (HTTP) 端口 | - |

> **注意**: CentOS 7 已 EOL，系统库过旧（GLIBC 2.17），无法直接运行 Node.js 18+ 和现代 Python 工具链，不推荐使用。

## 项目部署文件

```
项目根目录/
├── deploy.sh              # 一键部署脚本
├── Dockerfile             # 多阶段构建（Node 22 + Python 3.11）
├── docker-compose.yml     # 容器编排（backend + nginx）
└── deploy/
    └── nginx.conf         # Nginx 反向代理配置
```

## 首次部署

### 1. 创建服务器

以 Azure 为例，创建 VM 时选择：
- **Image**: Ubuntu Server 24.04 LTS - x64 Gen2
- **Size**: Standard_B2s (2 vCPU, 4 GiB)
- **认证**: SSH 公钥或密码

创建完成后，在 **Network settings** 中添加入站规则，开放 80 端口 (HTTP)。

### 2. SSH 登录

```bash
ssh azureuser@<你的公网IP>
```

### 3. 一键部署

```bash
# 下载部署脚本
curl -fsSL https://raw.githubusercontent.com/luyao618/golden-flower/main/deploy.sh -o deploy.sh
chmod +x deploy.sh

# 执行首次部署（自动安装 Docker、克隆代码、构建启动）
./deploy.sh --init
```

> 首次执行 `--init` 时，如果 Docker 是新安装的，脚本会提示你重新登录 SSH 以使 docker 用户组生效。重新登录后再次执行 `./deploy.sh --init` 即可。

### 4. 配置 LLM API Key

有两种方式：

**方式一：前端页面配置（推荐试玩）**

打开 `http://<你的公网IP>`，进入 Lobby 页面，点击「配置模型」，动态添加 API Key。此方式存储在内存中，服务重启后失效。

**方式二：环境变量文件（推荐生产）**

```bash
cd ~/golden-flower
nano backend/.env
```

按需填写 API Key：

```env
OPENROUTER_API_KEY=sk-or-your-key-here
SILICONFLOW_API_KEY=your-key-here
AZURE_OPENAI_API_KEY=your-key-here
ZHIPU_API_KEY=your-key-here
```

`backend/.env` 由 Compose 的 `env_file` 在创建容器时注入，不会进入 Docker 构建上下文或镜像。保存后重新创建后端容器，使新环境变量生效（无需重新构建镜像）：

```bash
docker compose up -d --no-deps --force-recreate backend
```

`./deploy.sh --restart` 只重启已有容器，不会重新加载环境变量文件。

### 5. 验证

浏览器访问 `http://<你的公网IP>`，看到游戏首页即为部署成功。

## 更新部署

代码有更新时，在服务器上执行：

```bash
cd ~/golden-flower
./deploy.sh
```

脚本会自动拉取最新代码、重新构建镜像、启动容器并做健康检查。

## deploy.sh 命令参考

| 命令 | 说明 |
|------|------|
| `./deploy.sh --init` | 首次部署（安装 Docker、克隆代码、构建启动） |
| `./deploy.sh` | 拉取最新代码并重新部署 |
| `./deploy.sh --restart` | 重启服务（不重新构建镜像） |
| `./deploy.sh --logs` | 查看实时日志 |
| `./deploy.sh --stop` | 停止所有服务 |
| `./deploy.sh --help` | 显示帮助信息 |

## 运维操作

### 查看日志

```bash
# 所有服务日志
cd ~/golden-flower && docker compose logs -f

# 仅后端日志
docker compose logs -f backend

# 仅 nginx 日志
docker compose logs -f nginx
```

### 查看服务状态

```bash
cd ~/golden-flower && docker compose ps
```

### 进入容器调试

```bash
# 进入后端容器
docker exec -it golden-flower-backend bash

# 查看数据库文件
docker exec golden-flower-backend ls -la /app/data/
```

### 备份数据库

```bash
# 将数据库文件复制到宿主机
docker cp golden-flower-backend:/app/data/golden_flower.db ./golden_flower_backup.db
```

### 清理磁盘空间

```bash
# 清理未使用的 Docker 资源（镜像、容器、网络）
docker system prune -af
```

## 常见问题

### Q: 构建失败，提示 tiktoken 找不到 Rust 编译器

这是因为宿主机直接安装 Python 依赖时会遇到的问题。使用 Docker 部署可以完全避免，因为构建在容器内完成，镜像自带所需编译环境。

### Q: 前端构建报 TypeScript 类型错误

Dockerfile 与 CI 均使用 `npm run build`，先执行 `tsc -b` 类型检查，再执行 `vite build`。类型检查包含测试文件；遇到类型错误时，请修复代码或过时的测试数据后重新构建。可在 `frontend/` 目录使用 Node.js 22 执行 `npm ci`、`npm test` 和 `npm run build` 复现检查。

### Q: Node.js 版本不兼容（需要 20.19+）

Dockerfile 使用 `node:22-slim` 镜像，已满足 Vite 7 的 Node.js 版本要求。

### Q: 服务启动后访问不了

检查以下几项：
1. 云服务商安全组/防火墙是否开放了 80 端口
2. `docker compose ps` 确认容器都在运行
3. `curl http://localhost/health` 在服务器本地测试是否通

### Q: 1 GiB 内存的机器能跑吗

可以跑但比较紧张。建议添加 swap：

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
```

推荐使用 4 GiB 内存的机器（如 Azure Standard_B2s）。
