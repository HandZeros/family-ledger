#!/usr/bin/env bash
# 组装并打包飞牛 fnOS 安装包（.fpk）
#
#   bash scripts/build-fpk.sh
#
# 产物：dist/family-ledger-<version>.fpk
# 需要：python3 + pip（下载 Linux/Python3.12 的依赖 wheel）、curl
# 说明：在 Linux / macOS 上运行；Windows 建议用 Git Bash + WSL，或直接用 GitHub Actions。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TPL="$ROOT/fnos/family-ledger"
OUT="$ROOT/dist"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

VERSION="$(grep -E '^version[[:space:]]*=' "$TPL/manifest" | head -n1 | cut -d'=' -f2 | tr -d '[:space:]')"
echo "==> 打包 家庭账本 $VERSION"

if [ ! -d "$ROOT/app" ]; then
    echo "找不到 app/ 目录" >&2
    exit 1
fi

# 1) 组装包目录：模板 + 服务端代码
cp -R "$TPL" "$WORK/pkg"
mkdir -p "$WORK/pkg/app/server/app"
cp -R "$ROOT/app/." "$WORK/pkg/app/server/app/"
find "$WORK/pkg/app/server/app" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
cp "$ROOT/requirements.txt" "$WORK/pkg/app/server/requirements.txt"

# 2) 下载目标平台依赖（离线安装用）
echo "==> 下载 Linux x86_64 / Python 3.12 依赖"
mkdir -p "$WORK/pkg/app/server/wheels"
python3 -m pip download -q -r "$ROOT/requirements.txt" \
    -d "$WORK/pkg/app/server/wheels" \
    --platform manylinux2014_x86_64 --python-version 312 \
    --implementation cp --abi cp312 --only-binary=:all:

# 3) 准备 fnpack
FNPACK="$ROOT/tools/bin/fnpack"
if [ ! -x "$FNPACK" ]; then
    case "$(uname -s)" in
        Linux)  os=linux ;;
        Darwin) os=darwin ;;
        *) echo "不支持的系统：$(uname -s)" >&2; exit 1 ;;
    esac
    case "$(uname -m)" in
        x86_64 | amd64) arch=amd64 ;;
        arm64 | aarch64) arch=arm64 ;;
        *) echo "不支持的架构：$(uname -m)" >&2; exit 1 ;;
    esac
    echo "==> 下载 fnpack ($os-$arch)"
    mkdir -p "$ROOT/tools/bin"
    curl -fsSL -o "$FNPACK" "https://static2.fnnas.com/fnpack/fnpack-1.2.1-${os}-${arch}"
    chmod +x "$FNPACK"
fi

# 4) 生命周期脚本必须可执行
chmod 755 "$WORK/pkg/cmd"/*

# 5) 打包
echo "==> fnpack build"
(cd "$WORK" && "$FNPACK" build -d pkg)

mkdir -p "$OUT"
mv "$WORK/family-ledger.fpk" "$OUT/family-ledger-${VERSION}.fpk"

# 6) 简单自检：cmd 可执行位、app.tgz 结构
python3 - "$OUT/family-ledger-${VERSION}.fpk" <<'PY'
import io, sys, tarfile
fpk = sys.argv[1]
with tarfile.open(fpk, 'r:gz') as t:
    mode = t.getmember('cmd/main').mode
    assert mode & 0o111, f'cmd/main 不可执行：{oct(mode)}'
    inner = t.extractfile('app.tgz').read()
with tarfile.open(fileobj=io.BytesIO(inner), mode='r:gz') as t:
    names = set(t.getnames())
    for need in ['server/app/main.py', 'server/requirements.txt', 'ui/config']:
        assert need in names, f'app.tgz 缺少 {need}'
print('自检通过：cmd/main 可执行，app.tgz 结构完整')
PY

echo "==> 完成：$OUT/family-ledger-${VERSION}.fpk"
