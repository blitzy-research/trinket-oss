#!/bin/bash
#
# Smoke Test Script for Trinket
# Run this after docker-compose up to verify basic functionality
#
# Usage: ./test/smoke-test.sh [base_url]
# Default: http://localhost:3001
# Note: 3001 does not match docker-compose.yml's 3000:3000 publish or the Dockerfile's EXPOSE 3000.
# That mismatch pre-dates this modernization and is preserved deliberately, not corrected; see
# docs/PRESERVED-QUIRKS.md (quirk 6) for the reasoning.
# To probe a default docker-compose stack, pass the base URL: ./test/smoke-test.sh http://localhost:3000
#

BASE_URL="${1:-http://localhost:3001}"
PASS=0
FAIL=0

# Every request is bounded, in both directions (review finding M-10).
#
# CONNECT_TIMEOUT bounds the TCP handshake, so pointing this script at a port nothing is listening on
# fails in seconds instead of waiting for the kernel to give up. MAX_TIME bounds the whole transfer,
# which matters because the baseline carries a documented no-response fate: a handler that never settles
# its response leaves the connection open forever, and docs/PRESERVED-QUIRKS.md records that this must not
# be repaired. Without a ceiling a single such route hangs the script - and any CI step running it -
# indefinitely. Both are overridable for a slow or remote target.
CONNECT_TIMEOUT="${SMOKE_CONNECT_TIMEOUT:-5}"
MAX_TIME="${SMOKE_MAX_TIME:-30}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "Trinket Smoke Test"
echo "Base URL: $BASE_URL"
echo "========================================"
echo ""

# Test function
test_endpoint() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local expected_status="$4"
    local data="$5"

    if [ "$method" = "GET" ]; then
        status=$(curl -s -o /dev/null -w "%{http_code}" \
            --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" \
            "$BASE_URL$endpoint" 2>/dev/null)
    else
        status=$(curl -s -o /dev/null -w "%{http_code}" \
            --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" \
            -X "$method" -H "Content-Type: application/json" -d "$data" \
            "$BASE_URL$endpoint" 2>/dev/null)
    fi

    if [ "$status" = "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC}: $name (HTTP $status)"
        ((PASS++))
    else
        echo -e "${RED}✗ FAIL${NC}: $name (Expected $expected_status, got $status)"
        ((FAIL++))
    fi
}

# Test function for checking response body contains text
test_endpoint_contains() {
    local name="$1"
    local endpoint="$2"
    local contains="$3"

    response=$(curl -s --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" \
        "$BASE_URL$endpoint" 2>/dev/null)

    if echo "$response" | grep -q "$contains"; then
        echo -e "${GREEN}✓ PASS${NC}: $name (contains '$contains')"
        ((PASS++))
    else
        echo -e "${RED}✗ FAIL${NC}: $name (missing '$contains')"
        ((FAIL++))
    fi
}

echo "--- Basic Connectivity ---"
test_endpoint "Homepage loads" "GET" "/" "200"
test_endpoint_contains "Homepage has content" "/" "<html"

echo ""
echo "--- Static Assets ---"
test_endpoint "CSS loads" "GET" "/css/base.css" "200"
test_endpoint "JS embed loads" "GET" "/js/embed/embed.js" "200"

echo ""
echo "--- API Endpoints ---"
# REVIEW FINDING M-10. This block used to assert `GET /api` -> 200. No such route exists and none ever
# did: the 233-row baseline route table registers 117 paths under /api/ and NOT the bare prefix, so the
# request falls through to the /{path*} catch-all and renders 404.html. The old expectation could not be
# met by any build, which made a permanently red check indistinguishable from a real regression.
#
# The statuses below are the MEASURED baseline, and the script is what adapts - never the application.
# Encoding what the server really does is required by R-6 (the base commit is the tie-breaker) and
# changing the server to match a wrong expectation would violate R-4.
test_endpoint "API prefix is not itself a route (catch-all 404)" "GET" "/api" "404"
# A far better API smoke signal than the bare prefix ever was: a real API route, unauthenticated. 401
# proves three things at once - the /api/ surface is mounted, the session strategy is enforcing, and the
# Boom JSON error contract is intact. This is the exact status and body the baseline corpus records for it.
test_endpoint "API route enforces the session strategy" "GET" "/api/courses" "401"
test_endpoint_contains "API errors are Boom JSON" "/api/courses" '"statusCode":401'

echo ""
echo "--- Auth Endpoints ---"
test_endpoint "Login page" "GET" "/login" "200"
test_endpoint "Signup page" "GET" "/signup" "200"

echo ""
echo "--- Trinket Pages ---"
test_endpoint "Python trinket page" "GET" "/python" "200"
# REVIEW FINDING M-10, second and third cases.
#
# /html answers 404 because the html trinket type is DISABLED by the shipped feature flags, and that 404
# is one of the 25 flag-gated 404s the baseline corpus records. lib/util/features.js resolves an unknown
# or disabled type to "not found" deliberately ("Unknown types default to disabled for safety"), which
# docs/PRESERVED-QUIRKS.md keeps as a preserved quirk. /python -> 200 immediately above is the contrast
# that makes this a real check rather than a blanket 404 expectation: the language landing machinery
# works, and html is switched off.
test_endpoint "HTML trinket page is feature-flagged off (404)" "GET" "/html" "404"
# /library is likewise not a registered path. The library surface is entirely parameterized -
# GET /library/folder/{slug} and GET /library/trinkets/{path*} - so the bare prefix reaches the catch-all.
test_endpoint "Library prefix is not itself a route (catch-all 404)" "GET" "/library" "404"

echo ""
echo "--- Error Handling ---"
test_endpoint "404 for missing page" "GET" "/this-page-does-not-exist-12345" "404"

echo ""
echo "========================================"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo "========================================"

if [ $FAIL -gt 0 ]; then
    exit 1
else
    exit 0
fi
