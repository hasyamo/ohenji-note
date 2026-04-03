#!/bin/bash
# KVデータをすべてエクスポートするスクリプト
# Usage: ./scripts/export-kv.sh

PROXY_URL="https://falling-mouse-736b.hasyamo.workers.dev"
OUTPUT_DIR="docs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "=== KV データエクスポート ==="

# JSON形式でエクスポート
echo "Fetching JSON..."
curl -s "${PROXY_URL}/api/ohenjicho/users/export?format=json" -o "${OUTPUT_DIR}/kv-users-${TIMESTAMP}.json"
echo "  -> ${OUTPUT_DIR}/kv-users-${TIMESTAMP}.json"

# CSV形式でエクスポート
echo "Fetching CSV..."
curl -s "${PROXY_URL}/api/ohenjicho/users/export" -o "${OUTPUT_DIR}/kv-users-${TIMESTAMP}.csv"
echo "  -> ${OUTPUT_DIR}/kv-users-${TIMESTAMP}.csv"

# userlist（輪に表示されるリスト）もエクスポート
echo "Fetching userlist (ring members)..."
curl -s "${PROXY_URL}/api/ohenjicho/users" -o "${OUTPUT_DIR}/kv-userlist-${TIMESTAMP}.json"
echo "  -> ${OUTPUT_DIR}/kv-userlist-${TIMESTAMP}.json"

echo ""
echo "=== 集計 ==="
TOTAL=$(jq 'length' "${OUTPUT_DIR}/kv-users-${TIMESTAMP}.json")
ACTIVE=$(jq '[.[] | select(.optOut != true)] | length' "${OUTPUT_DIR}/kv-users-${TIMESTAMP}.json")
OPTOUT=$(jq '[.[] | select(.optOut == true)] | length' "${OUTPUT_DIR}/kv-users-${TIMESTAMP}.json")
RING=$(jq '.userUrlnames | length' "${OUTPUT_DIR}/kv-userlist-${TIMESTAMP}.json")

echo "全ユーザー数: ${TOTAL}"
echo "アクティブ (optOut=false): ${ACTIVE}"
echo "オプトアウト (optOut=true): ${OPTOUT}"
echo "輪に表示中 (userlist): ${RING}"

if [ "$ACTIVE" != "$RING" ]; then
  echo ""
  echo "⚠ アクティブ数(${ACTIVE})と輪の表示数(${RING})が一致しません！"
  echo "差分を確認中..."

  # アクティブユーザーのurlname一覧
  jq -r '[.[] | select(.optOut != true)] | .[].urlname' "${OUTPUT_DIR}/kv-users-${TIMESTAMP}.json" | sort > /tmp/kv_active.txt
  # userlistのurlname一覧
  jq -r '.userUrlnames[]' "${OUTPUT_DIR}/kv-userlist-${TIMESTAMP}.json" | sort > /tmp/kv_ring.txt

  echo ""
  echo "アクティブだが輪に未表示:"
  comm -23 /tmp/kv_active.txt /tmp/kv_ring.txt

  echo ""
  echo "輪に表示されているがアクティブでない:"
  comm -13 /tmp/kv_active.txt /tmp/kv_ring.txt

  rm -f /tmp/kv_active.txt /tmp/kv_ring.txt
fi

echo ""
echo "完了！"
