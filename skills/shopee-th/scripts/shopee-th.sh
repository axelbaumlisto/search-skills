#!/usr/bin/env bash
# Shopee Thailand (shopee.co.th) — same engine as the VN skill, region pinned to TH.
# All logic lives in ~/.pi/agent/skills/shopee-search/scripts (regions.cjs holds the
# country table). Do not fork that code: add a region key instead.
export SHOPEE_REGION=th
exec "$HOME/.pi/agent/skills/shopee-search/scripts/shopee.sh" "$@"
