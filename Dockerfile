# CommentPulse 生产镜像，给 Hugging Face Spaces（Docker SDK）用。
# Spaces 的 Docker Space 约定：容器要监听 7860 端口。

FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY frontend/ frontend/
COPY assets/overview.png assets/overview.png

# 提前在构建阶段把 Twitter-RoBERTa 模型下载进镜像里，而不是等第一个访问的人来触发下载——
# 公开分享场景不能让第一个点进来的人干等几分钟模型下载（本地开发时才用"第一次用到再下"的懒加载）。
# HF_HUB_DISABLE_XET=1 是之前踩过的坑：hf_xet 传输协议在某些网络环境下会卡死在 0 字节
# （见项目日志 2026-09-11 踩坑记录），构建环境网络不确定，直接禁用更稳。
ENV HF_HUB_DISABLE_XET=1
RUN python -c "from transformers import pipeline; pipeline('sentiment-analysis', model='cardiffnlp/twitter-roberta-base-sentiment-latest')"

EXPOSE 7860
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
