#!/bin/bash
#
# Smoke Test Script for Trinket
# Run this after docker-compose up to verify basic functionality
#
# Usage: ./test/smoke-test.sh [base_url]
# Default: http://localhost:3000
#
# IDENTITY: every request below is made ANONYMOUSLY. This script has no
# credential store, no cookie jar and no fixtures, so it can only assert what an
# unauthenticated visitor sees. That is a deliberate boundary, not an oversight:
# the authenticated surface is covered by the database-backed Mocha suite
# (`npm test`), and duplicating identity and fixture mechanics in shell would
# duplicate that harness.
#
# It matters for two of the endpoints below. /login and /signup answer 200 to an
# anonymous visitor, which is what is asserted here, but they answer 500 to a
# LOGGED-IN one - the authenticated branch of both handlers evaluates
# `reply.redirect(...)`, and `reply` is not a binding in that scope, so the
# expression throws and the handler catch-all maps it to a 500. That outcome is
# a deliberately preserved 2013-era defect (see docs/preserved-quirks.md) and it
# is asserted, authenticated, in test/lib/api/pages.js. A 200 here and a 500
# there are both correct; they are different identities.
#

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

# Bounds for every request made by this script. Without them a dead or wedged
# endpoint holds the whole run open indefinitely - and this application has at
# least one route that is measured never to settle - so a hang would be reported
# as neither a pass nor a failure.
CONNECT_TIMEOUT=5
MAX_TIME=30

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "Trinket Smoke Test"
echo "Base URL: $BASE_URL"
echo "Identity: anonymous (no session)"
echo "Timeouts: connect ${CONNECT_TIMEOUT}s, total ${MAX_TIME}s per request"
echo "========================================"
echo ""

# Report a transport-level curl failure in full.
#
# Every check below treats a non-zero curl exit as a FAILURE IN ITS OWN RIGHT,
# regardless of what curl wrote to stdout. That rule is not defensive
# programming: `-w "%{http_code}"` prints whatever curl managed to observe, and
# a proxy, a wedged connection or an interposed binary can leave a plausible
# status on stdout while the transfer itself failed. Deciding a check on the
# status alone therefore lets a run in which NOTHING was actually fetched report
# a clean pass - which is precisely the failure mode this guard closes.
report_curl_failure() {
    local rc="$1"
    local err_file="$2"
    local message

    message=$(tr -d '\n' < "$err_file")
    echo -e "  ${YELLOW}curl exit $rc${NC}${message:+: $message}"

    case "$rc" in
        6)  echo -e "  ${YELLOW}note${NC}: could not resolve the host in $BASE_URL" ;;
        7)  echo -e "  ${YELLOW}note${NC}: connection refused - nothing is listening on $BASE_URL" ;;
        28) echo -e "  ${YELLOW}note${NC}: timed out (connect ${CONNECT_TIMEOUT}s, total ${MAX_TIME}s) - the request was not answered within its bounds, so any status printed above is not a served response" ;;
        35) echo -e "  ${YELLOW}note${NC}: TLS handshake failed" ;;
        52) echo -e "  ${YELLOW}note${NC}: the server closed the connection without replying" ;;
        56) echo -e "  ${YELLOW}note${NC}: the connection was reset while receiving the response" ;;
        *)  echo -e "  ${YELLOW}note${NC}: transport failed before a response was fully received; see 'man curl' EXIT CODES for $rc" ;;
    esac
}

# Test function
test_endpoint() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local expected_status="$4"
    local data="$5"
    local curl_err
    local curl_rc

    # Transport diagnostics are captured rather than discarded: curl's own
    # message is the only thing that distinguishes a refused connection from a
    # TLS failure, a DNS failure or a timeout, and all four otherwise present
    # identically as the empty status code below.
    curl_err=$(mktemp)

    if [ "$method" = "GET" ]; then
        status=$(curl -sS -o /dev/null -w "%{http_code}" \
            --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" \
            "$BASE_URL$endpoint" 2>"$curl_err")
        curl_rc=$?
    else
        status=$(curl -sS -o /dev/null -w "%{http_code}" -X "$method" \
            --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" \
            -H "Content-Type: application/json" -d "$data" \
            "$BASE_URL$endpoint" 2>"$curl_err")
        curl_rc=$?
    fi

    # A non-zero curl exit fails the check on its own, BEFORE the status is
    # consulted. Passing requires both: the transfer succeeded AND the status is
    # the expected one.
    if [ "$curl_rc" -ne 0 ]; then
        echo -e "${RED}✗ FAIL${NC}: $name (curl transport failure; expected $expected_status, curl reported status ${status:-none})"
        report_curl_failure "$curl_rc" "$curl_err"
        FAIL=$((FAIL + 1))
    elif [ "$status" = "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC}: $name (HTTP $status)"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗ FAIL${NC}: $name (Expected $expected_status, got ${status:-none})"
        FAIL=$((FAIL + 1))
    fi

    rm -f "$curl_err"
}

# Test function for checking response body contains text
test_endpoint_contains() {
    local name="$1"
    local endpoint="$2"
    local contains="$3"
    local curl_err
    local curl_rc

    curl_err=$(mktemp)
    response=$(curl -sS --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" \
        "$BASE_URL$endpoint" 2>"$curl_err")
    curl_rc=$?

    # Same rule as test_endpoint: the transfer has to have succeeded before the
    # body is worth inspecting. A partial or interposed response can contain the
    # expected text and still not be a response this application served.
    if [ "$curl_rc" -ne 0 ]; then
        echo -e "${RED}✗ FAIL${NC}: $name (curl transport failure; body not treated as served)"
        report_curl_failure "$curl_rc" "$curl_err"
        FAIL=$((FAIL + 1))
    elif echo "$response" | grep -q "$contains"; then
        echo -e "${GREEN}✓ PASS${NC}: $name (contains '$contains')"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗ FAIL${NC}: $name (missing '$contains')"
        FAIL=$((FAIL + 1))
    fi

    rm -f "$curl_err"
}

echo "--- Basic Connectivity ---"
test_endpoint "Homepage loads" "GET" "/" "200"
test_endpoint_contains "Homepage has content" "/" "<html"

echo ""
echo "--- Static Assets ---"
test_endpoint "CSS loads" "GET" "/css/base.css" "200"
test_endpoint "JS embed loads" "GET" "/js/embed/embed.js" "200"

echo ""
echo "--- Unrouted Paths ---"
# /api and /library are NOT registered routes. No literal declaration for either
# exists in config/, and the only /library-prefixed routes are deeper paths that
# bare /library does not match, so both fall through to the Inert catch-all over
# ./public - which contains no `api` or `library` entry - and answer 404 through
# the rendered error page. Measured, and asserted independently in
# test/lib/api/pages.js. This script previously required 200 for both, which
# contradicted that measurement; adding a route or a public/ directory to
# manufacture a 200 would be a prohibited change to the route surface, so the
# expectations are corrected to the measured value instead.
test_endpoint "API root is not a route" "GET" "/api" "404"
test_endpoint "Library root is not a route" "GET" "/library" "404"

echo ""
echo "--- Auth Endpoints (anonymous) ---"
test_endpoint "Login page" "GET" "/login" "200"
test_endpoint "Signup page" "GET" "/signup" "200"

echo ""
echo "--- Trinket Pages ---"
test_endpoint "Python trinket page" "GET" "/python" "200"
# /html answers 200 only when the html trinket type is enabled. The shipped
# default is `features.trinkets.html: false` (config/default.yaml), under which
# this path is not served, so this check reports the state of that flag in the
# deployment being smoke-tested rather than a defect in it.
test_endpoint "HTML trinket page (requires features.trinkets.html)" "GET" "/html" "200"

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
