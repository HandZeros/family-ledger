FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=Asia/Shanghai \
    DATA_DIR=/data

# tzdata 让「今天」按中国时区计算，避免跨时区记错日期
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN mkdir -p /data

VOLUME ["/data"]
EXPOSE 5257

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5257/api/health',timeout=3).status==200 else 1)"

# 说明：容器内以 root 运行，是为了让 ./data 挂载目录在任何主机（含群晖/NAS 共享目录）
# 都不会出现写权限问题。仅建议在家庭内网使用；如需暴露到公网请置于反向代理之后。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5257", "--proxy-headers", "--forwarded-allow-ips", "*"]
