#!/bin/bash
#
# Smoke Test Script for Trinket
# Run this after docker-compose up to verify basic functionality
#
# Usage: ./test/smoke-test.sh [base_url]
# Default: http://localhost:3000
#

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

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
        status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint" 2>/dev/null)
    else
        status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Content-Type: application/json" -d "$data" "$BASE_URL$endpoint" 2>/dev/null)
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

    response=$(curl -s "$BASE_URL$endpoint" 2>/dev/null)

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
# No route is registered for bare /api; it falls through to the static catch-all
# over ./public, which has no api entry, and renders 404. The route surface is
# unchanged by this migration - the route manifest is identical to baseline
# across all 233 entries - so the 404 is baseline behaviour rather than a
# regression, and it is asserted as a measurement in test/lib/api/pages.js.
# Adding a route or a public/ entry to manufacture a 200 would be a prohibited
# change to the route surface.
test_endpoint "API root" "GET" "/api" "404"

echo ""
echo "--- Auth Endpoints ---"
test_endpoint "Login page" "GET" "/login" "200"
test_endpoint "Signup page" "GET" "/signup" "200"

echo ""
echo "--- Trinket Pages ---"
test_endpoint "Python trinket page" "GET" "/python" "200"
# /html serves only when features.trinkets.html is enabled; the shipped default
# disables it, so the type check answers 404.
test_endpoint "HTML trinket page" "GET" "/html" "404"
# Only /library/trinkets and /library/folder are routes; bare /library is not,
# so it renders 404 through the static catch-all. Baseline behaviour, unchanged
# by this migration and asserted as a measurement in test/lib/api/pages.js.
test_endpoint "Library page" "GET" "/library" "404"

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
