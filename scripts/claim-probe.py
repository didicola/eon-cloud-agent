#!/usr/bin/env python3
"""Claim-page probe: render claim URL in headless Firefox, report what CF serves."""
import os
import sys

from playwright.sync_api import sync_playwright

url = os.environ.get("CLAIM_URL", "")
print("URL-len:", len(url), flush=True)
with sync_playwright() as p:
    b = p.firefox.launch(headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    try:
        r = pg.goto(url, timeout=60000, wait_until="domcontentloaded")
        print("HTTP:", r.status if r else "no-response", flush=True)
    except Exception as e:
        print("GOTO-ERR:", str(e)[:200], flush=True)
    pg.wait_for_timeout(12000)
    pg.screenshot(path="claim.png", full_page=False)
    html = pg.content()
    print("TITLE:", pg.title()[:100], flush=True)
    low = html.lower()
    print("HAS-CHALLENGE:", any(k in html for k in
                                ["challenge-platform", "cf-challenge", "Just a moment",
                                 "Checking your browser"]), flush=True)
    print("HAS-CLAIM:", any(k in low for k in ["claim your account", "claim account"]), flush=True)
    print("HTML-LEN:", len(html), flush=True)
    b.close()
print("SHOT: claim.png", flush=True)
