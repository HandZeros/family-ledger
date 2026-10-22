#!/usr/bin/env bash
# 一键把本仓库发布到 GitHub。
#
#   bash scripts/publish-github.sh
#
# Token 只在本次 git push 的 URL 里出现，不会写入 .git/config，
# 也不会被记录到仓库文件。
set -euo pipefail

REPO_NAME="${REPO_NAME:-family-ledger}"
BRANCH="main"

command -v curl >/dev/null 2>&1 || { echo "缺少 curl，请先安装"; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "请在项目根目录运行本脚本"; exit 1; }
git rev-parse --verify "$BRANCH" >/dev/null 2>&1 || { echo "当前仓库没有 $BRANCH 分支"; exit 1; }

echo "——————————————————————————————"
echo "  发布家庭账本到 GitHub"
echo "——————————————————————————————"
echo "需要一个 PAT（个人访问令牌），不是账号密码。"
echo "生成地址：https://github.com/settings/tokens"
echo "  · Fine-grained token：Repository access 选 All repositories，"
echo "    权限勾选 Administration: Read and write、Contents: Read and write"
echo "  · 或 Classic token：勾选 repo"
echo

read -rp "GitHub 用户名 [HandZeros]: " GH_USER
GH_USER="${GH_USER:-HandZeros}"

read -rsp "粘贴 PAT（输入不显示）: " GH_TOKEN
echo
[ -n "$GH_TOKEN" ] || { echo "Token 不能为空"; exit 1; }

read -rp "仓库名 [$REPO_NAME]: " input_repo
REPO_NAME="${input_repo:-$REPO_NAME}"

read -rp "创建为私有仓库？[y/N]: " priv
PRIVATE=false
case "$priv" in y | Y) PRIVATE=true ;; esac

echo
echo "→ 创建仓库 $GH_USER/$REPO_NAME ..."
code=$(curl -s -o /tmp/gh_repo.json -w "%{http_code}" \
  -X POST https://api.github.com/user/repos \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d "{\"name\":\"$REPO_NAME\",\"private\":$PRIVATE,\"description\":\"家庭账本 · 家庭成员共同记账（Docker + FastAPI + Android）\",\"has_issues\":true}")

case "$code" in
  201) echo "  仓库已创建" ;;
  422) echo "  仓库已存在，继续推送" ;;
  *)
    echo "  创建失败（HTTP $code）："
    cat /tmp/gh_repo.json 2>/dev/null || true
    echo
    echo "  常见原因：token 权限不足、仓库名已被占用。"
    exit 1
    ;;
esac

echo "→ 推送 $BRANCH ..."
git push "https://x-access-token:$GH_TOKEN@github.com/$GH_USER/$REPO_NAME.git" "$BRANCH:$BRANCH"

git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$GH_USER/$REPO_NAME.git"
git config "branch.$BRANCH.remote" origin
git config "branch.$BRANCH.merge" "refs/heads/$BRANCH"

echo
echo "✔ 完成：https://github.com/$GH_USER/$REPO_NAME"
echo
echo "下一步（可选）："
echo "  1. 打开 Actions → Build Android APK → Run workflow，等几分钟下载 app-debug.apk"
echo "  2. 发版本：git tag v1.0.0 && git push origin v1.0.0"
echo
echo "提示：token 只在刚才那条 push 命令里用过，不会留在仓库配置中。"
