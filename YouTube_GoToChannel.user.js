// ==UserScript==
// @name         YouTube — Go to Video on Channel
// @namespace    http://tampermonkey.net/
// @version      1
// @description  "On Channel" button — parallel search + scroll, blur overlay with click-blocking, highlight animation. No status text under spinner unless error.
// @author       yeamu
// @match        https://www.youtube.com/*
// @icon         https://www.youtube.com/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      www.youtube.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'yt_find_video';
  const DEBUG = false;
  function log(...a) { if (DEBUG) console.log('[YT-Nav]', ...a); }

  // ─── Styles ───────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ytnav-styles')) return;
    const style = document.createElement('style');
    style.id = 'ytnav-styles';
    style.textContent = `
      #yt-goto-channel-video-btn {
        margin-left: 8px;
      }
      #yt-goto-channel-video-btn.ytnav-loading {
        opacity: .6;
        pointer-events: none;
      }

      /* ── Overlay: blurs everything and blocks all pointer events ── */
      .ytnav-overlay {
        position: fixed;
        inset: 0;
        z-index: 99998;
        background: rgba(15,15,15,.55);
        backdrop-filter: blur(7px) saturate(115%);
        -webkit-backdrop-filter: blur(7px) saturate(115%);
        opacity: 0;
        pointer-events: all;
        transition: opacity .35s ease;
        cursor: default;
      }
      .ytnav-overlay.ytnav-show { opacity: 1; }

      /* ── Highlighted card: sits above the overlay, clickable ── */
      .ytnav-highlight-card {
        position: relative;
        z-index: 99999;
        border-radius: 16px;
        background: var(--yt-spec-base-background, #0f0f0f);
        filter: brightness(1.12) saturate(1.2);
        pointer-events: all;
        animation: ytnav-pop .45s cubic-bezier(.34,1.56,.64,1) 1,
                   ytnav-pulse 1.1s ease-in-out .45s infinite;
      }
      .ytnav-highlight-card.ytnav-fade {
        animation: none;
        box-shadow: 0 0 0 0 rgba(62,166,255,0), 0 0 0 0 rgba(255,77,77,0);
        transform: scale(1);
        filter: brightness(1) saturate(1);
        transition: box-shadow .6s ease, transform .6s ease, filter .6s ease;
      }
      @keyframes ytnav-pop {
        0%   { transform: scale(.94); box-shadow: 0 0 0 0 rgba(62,166,255,0); }
        60%  { transform: scale(1.045); }
        100% { transform: scale(1.02); box-shadow: 0 0 0 3px #3ea6ff, 0 8px 45px 12px rgba(62,166,255,.6); }
      }
      @keyframes ytnav-pulse {
        0%, 100% {
          transform: scale(1.02);
          box-shadow: 0 0 0 3px #3ea6ff, 0 8px 45px 12px rgba(62,166,255,.6);
        }
        50% {
          transform: scale(1.035);
          box-shadow: 0 0 0 5px #ff4d4d, 0 10px 55px 18px rgba(255,77,77,.65);
        }
      }

      /* ── Loader: only the ring, no text by default ── */
      .ytnav-loader {
        position: fixed;
        top: 50%;
        left: 50%;
        z-index: 100000;
        transform: translate(-50%, -50%) scale(.85);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        opacity: 0;
        pointer-events: none;
        transition: opacity .25s ease, transform .25s ease;
      }
      .ytnav-loader.ytnav-show {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      .ytnav-loader-ring {
        width: 110px;
        height: 110px;
        border-radius: 50%;
        border: 8px solid rgba(255,255,255,.18);
        border-top-color: #ff0000;
        border-right-color: #ff0000;
        box-shadow: 0 0 45px rgba(255,0,0,.55);
        animation: ytnav-spin-big .75s cubic-bezier(.5,.15,.5,.85) infinite;
      }
      @keyframes ytnav-spin-big { to { transform: rotate(360deg); } }

      /* Error text — only visible when .ytnav-has-error is set */
      .ytnav-loader-text {
        display: none;
        color: #fff;
        font: 500 14px/1.4 "Roboto", Arial, sans-serif;
        text-align: center;
        max-width: 320px;
        text-shadow: 0 2px 10px rgba(0,0,0,.7);
      }
      .ytnav-loader.ytnav-has-error .ytnav-loader-text {
        display: block;
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function getCurrentVideoId() {
    return new URLSearchParams(window.location.search).get('v') || null;
  }

  const CHANNEL_SELECTORS = [
    'ytd-channel-name a', '#owner #channel-name a', '#owner a[href]',
    'ytd-video-owner-renderer a[href]',
    'a.yt-simple-endpoint[href^="/@"]', 'a.yt-simple-endpoint[href^="/channel/"]',
    'a[href^="/@"]', 'a[href^="/channel/"]',
  ];

  function getChannelHandle() {
    for (const s of CHANNEL_SELECTORS) {
      const el = document.querySelector(s);
      if (el) { const h = el.getAttribute('href'); if (h) return h; }
    }
    return null;
  }

  // ─── Network ──────────────────────────────────────────────────────────────
  function gmFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url,
        headers: options.headers || {},
        data: options.body || undefined,
        timeout: 15000,
        onload: r => resolve(r.responseText),
        onerror: e => reject(new Error('gmFetch: ' + JSON.stringify(e))),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  // ─── Load channel config ──────────────────────────────────────────────────
  async function loadChannelPage(channelHandle) {
    const path = channelHandle.startsWith('/') ? channelHandle : '/' + channelHandle;
    const url = 'https://www.youtube.com' + path + '/videos';
    log('Loading:', url);
    const html = await gmFetch(url);

    const apiKey        = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1];
    const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1];
    const visitorData   = html.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/)?.[1] || '';
    const browseId      = (html.match(/"browseId"\s*:\s*"(UC[^"]+)"/) || html.match(/"channelId"\s*:\s*"(UC[^"]+)"/))?.[1];

    if (!apiKey || !clientVersion || !browseId)
      throw new Error(`Config not found: apiKey=${!!apiKey} ver=${!!clientVersion} browseId=${!!browseId}`);

    const dataMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s)
                   || html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
    let initialData = null;
    if (dataMatch) {
      try { initialData = JSON.parse(dataMatch[1]); } catch (e) {}
    }

    return { apiKey, clientVersion, visitorData, browseId, initialData };
  }

  // ─── Extract video IDs + continuation token ───────────────────────────────
  function extractAll(data) {
    const videoIds = [];
    const idSet = new Set();
    let contToken = null;
    const seen = new WeakSet();
    const stack = [data];

    while (stack.length) {
      const obj = stack.pop();
      if (!obj || typeof obj !== 'object') continue;
      if (seen.has(obj)) continue;
      seen.add(obj);

      if (Array.isArray(obj)) {
        for (let i = obj.length - 1; i >= 0; i--) stack.push(obj[i]);
        continue;
      }
      if (typeof obj.videoId === 'string' && obj.videoId.length === 11 && !idSet.has(obj.videoId)) {
        idSet.add(obj.videoId);
        videoIds.push(obj.videoId);
      }
      if (!contToken && obj.continuationCommand?.token) {
        contToken = obj.continuationCommand.token;
      }
      const keys = Object.keys(obj);
      for (let i = keys.length - 1; i >= 0; i--) stack.push(obj[keys[i]]);
    }

    return { videoIds, contToken };
  }

  // ─── Single continuation request ──────────────────────────────────────────
  async function doContinuation(cfg, token) {
    const url = `https://www.youtube.com/youtubei/v1/browse?prettyPrint=false`;
    const body = {
      context: {
        client: {
          clientName: 'WEB', clientVersion: cfg.clientVersion,
          visitorData: cfg.visitorData, hl: 'en', gl: 'US',
          userAgent: navigator.userAgent,
        },
      },
      continuation: token,
    };
    const text = await gmFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': cfg.clientVersion,
        'X-Goog-Visitor-Id': cfg.visitorData,
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
      },
      body: JSON.stringify(body),
    });
    return JSON.parse(text);
  }

  // ─── FAST parallel scanning via API ──────────────────────────────────────
  // Returns a Promise that resolves to { totalBefore } or null.
  // Uses pipelining: as soon as we get a continuation token from page N,
  // we fire page N+1 immediately without waiting to finish processing N.
  const CONCURRENCY = 4;

  async function findVideoPosition(cfg, initialData, targetVideoId) {
    let totalScanned = 0;

    if (!initialData) return null;

    const { videoIds, contToken } = extractAll(initialData);
    log(`Page 0: ${videoIds.length} videos`);

    const idx = videoIds.indexOf(targetVideoId);
    if (idx !== -1) return { totalBefore: idx };

    totalScanned += videoIds.length;

    let token = contToken;
    let page = 1;
    const pending = [];

    const fireRequest = (tok, base) => ({ promise: doContinuation(cfg, tok), base });

    if (token) {
      pending.push(fireRequest(token, totalScanned));
      token = null;
    }

    while (pending.length > 0) {
      const entry = pending.shift();
      let data;
      try { data = await entry.promise; } catch (e) { log('Request failed:', e); break; }

      const { videoIds: ids, contToken: next } = extractAll(data);
      log(`Page ${page}: ${ids.length} videos, next: ${!!next}`);

      const found = ids.indexOf(targetVideoId);
      if (found !== -1) return { totalBefore: entry.base + found };

      if (ids.length === 0) { log('Empty page, stopping'); break; }

      totalScanned = entry.base + ids.length;
      page++;

      // Immediately fire next request (pipeline — no waiting)
      if (next && pending.length < CONCURRENCY) {
        pending.push(fireRequest(next, totalScanned));
      }
    }

    return null;
  }

  // ─── DOM card helpers ─────────────────────────────────────────────────────
  const CARD_SELECTOR = 'ytd-rich-item-renderer, ytd-grid-video-renderer';

  function countCards() {
    return document.querySelectorAll(CARD_SELECTOR).length;
  }

  function findTargetCard(videoId) {
    const link = document.querySelector(`a[href*="v=${videoId}"]`);
    if (!link) return null;
    return link.closest('ytd-rich-item-renderer')
        || link.closest('ytd-grid-video-renderer')
        || link;
  }

  function waitForMoreCards(currentCount, timeoutMs = 4000) {
    return new Promise(resolve => {
      if (countCards() > currentCount) { resolve(true); return; }
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        obs.disconnect();
        clearTimeout(timer);
        resolve(ok);
      };
      const obs = new MutationObserver(() => { if (countCards() > currentCount) finish(true); });
      obs.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  function scrollCardIntoView(card) {
    const rect = card.getBoundingClientRect();
    const targetY = window.scrollY + rect.top - window.innerHeight * 0.22;
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
  }

  function waitForScrollSettle(maxWaitMs = 2000, quietMs = 120) {
    return new Promise(resolve => {
      let timer, maxTimer;
      const finish = () => {
        window.removeEventListener('scroll', onScroll);
        clearTimeout(timer);
        clearTimeout(maxTimer);
        resolve();
      };
      const onScroll = () => { clearTimeout(timer); timer = setTimeout(finish, quietMs); };
      window.addEventListener('scroll', onScroll, { passive: true });
      timer = setTimeout(finish, quietMs);
      maxTimer = setTimeout(finish, maxWaitMs);
    });
  }

  // ─── Overlay ──────────────────────────────────────────────────────────────
  function showSearchOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'ytnav-overlay';
    overlay.addEventListener('click',      e => e.stopPropagation(), true);
    overlay.addEventListener('mousedown',  e => e.stopPropagation(), true);
    overlay.addEventListener('pointerdown',e => e.stopPropagation(), true);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('ytnav-show'));
    return overlay;
  }

  function hideSearchOverlay(overlay) {
    if (!overlay) return;
    overlay.classList.remove('ytnav-show');
    setTimeout(() => overlay.remove(), 400);
  }

  function startHighlight(card) {
    card.classList.add('ytnav-highlight-card');
    card.style.position = card.style.position || 'relative';
  }

  function fadeHighlight(card) {
    card.classList.add('ytnav-fade');
    setTimeout(() => {
      card.classList.remove('ytnav-highlight-card', 'ytnav-fade');
      card.style.position = '';
    }, 700);
  }

  // ─── Loader (spinner only; text shown only on error) ──────────────────────
  function createLoader() {
    const el = document.createElement('div');
    el.className = 'ytnav-loader';

    const ring = document.createElement('div');
    ring.className = 'ytnav-loader-ring';

    // Text element exists in DOM but is hidden via CSS until .ytnav-has-error
    const text = document.createElement('div');
    text.className = 'ytnav-loader-text';

    el.appendChild(ring);
    el.appendChild(text);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('ytnav-show'));

    let removed = false;

    return {
      // Show error: reveal text and stop spinner
      showError: (msg) => {
        if (removed) return;
        text.textContent = msg;
        el.classList.add('ytnav-has-error');
        ring.style.animationPlayState = 'paused';
      },
      hideNow: () => {
        if (removed) return;
        removed = true;
        el.classList.remove('ytnav-show');
        setTimeout(() => el.remove(), 300);
      },
      remove: () => {
        if (removed) return;
        removed = true;
        setTimeout(() => {
          el.classList.remove('ytnav-show');
          setTimeout(() => el.remove(), 350);
        }, 1200);
      },
    };
  }

  // ─── Parallel scroll-loader: DOM scrolling runs alongside API search ───────
  //
  // Strategy: we start two "tracks" concurrently:
  //   Track A (API)  — scans YouTube's API to find the video's position index
  //   Track B (DOM)  — scrolls the page downward to load cards into the DOM
  //
  // Track B runs a continuous loop scrolling to bottom every time new cards
  // appear. Track A resolves when it finds the index. Once Track A resolves,
  // Track B is told the target count and switches to "wait for card in DOM"
  // mode. The card is highlighted as soon as it appears.

  async function runParallel(cfg, initialData, targetVideoId, overlay, ui) {
    // Shared state between the two tracks
    let targetCount = Infinity;  // will be set by Track A on success
    let apiDone = false;         // Track A finished (found or not)
    let scrollAbort = false;     // signal Track B to stop

    // ── Track B: continuous DOM scroll ──────────────────────────────────────
    const trackB = (async () => {
      let stuckCounter = 0;

      while (!scrollAbort) {
        // If target card is already in DOM, we're done scrolling
        const card = findTargetCard(targetVideoId);
        if (card) return card;

        const before = countCards();

        // If API already told us where the video is and we have enough cards,
        // just poll a bit more (card may appear on next mutation)
        if (before >= targetCount) {
          await new Promise(r => setTimeout(r, 100));
          stuckCounter++;
          if (stuckCounter > 30) return null;  // give up
          continue;
        }

        // Scroll to bottom instantly to trigger YouTube's lazy-load
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });

        const loaded = await waitForMoreCards(before, 4000);
        if (!loaded) {
          stuckCounter++;
          if (stuckCounter > 3) { log('YouTube stopped loading cards'); return null; }
          await new Promise(r => setTimeout(r, 400));
        } else {
          stuckCounter = 0;
        }
      }
      return null;
    })();

    // ── Track A: API search ──────────────────────────────────────────────────
    const trackA = findVideoPosition(cfg, initialData, targetVideoId).then(result => {
      apiDone = true;
      if (result) {
        targetCount = result.totalBefore + 1;  // inform Track B
        log(`API found at position ${result.totalBefore}`);
      } else {
        scrollAbort = true;  // stop Track B — video not in API results
      }
      return result;
    });

    // ── Race to find the card, with API result as guide ──────────────────────
    // We wait for BOTH: API to finish (so we know the count) AND card in DOM.
    const apiResult = await trackA;

    if (!apiResult) {
      scrollAbort = true;
      return false;  // not found
    }

    // Now wait for Track B to find the card in DOM (it already has targetCount)
    const card = await trackB;
    scrollAbort = true;

    if (!card) return false;

    // ── Highlight and reveal ──────────────────────────────────────────────────
    ui.hideNow();
    scrollCardIntoView(card);
    startHighlight(card);
    await waitForScrollSettle(2000);
    await new Promise(r => setTimeout(r, 1000));
    hideSearchOverlay(overlay);
    await new Promise(r => setTimeout(r, 600));
    fadeHighlight(card);
    return true;
  }

  // ─── Entry point on /videos page ─────────────────────────────────────────
  async function runOnVideosPage() {
    const stored = GM_getValue(STORAGE_KEY, null);
    if (!stored || Date.now() > stored.expires) return;
    if (!window.location.pathname.endsWith('/videos')) return;
    GM_setValue(STORAGE_KEY, null);

    const { videoId, channelHandle } = stored;
    log('Searching for:', videoId, 'channel:', channelHandle);

    const overlay = showSearchOverlay();
    const ui = createLoader();

    try {
      const { clientVersion, visitorData, browseId, initialData } = await loadChannelPage(channelHandle);
      const cfg = { clientVersion, visitorData, browseId };

      const ok = await runParallel(cfg, initialData, videoId, overlay, ui);

      if (!ok) {
        ui.showError('❌ Video not found');
        setTimeout(() => { ui.remove(); hideSearchOverlay(overlay); }, 2000);
      }
    } catch (e) {
      ui.showError('❌ Error');
      setTimeout(() => { ui.remove(); hideSearchOverlay(overlay); }, 2000);
      console.error('[YT-Nav]', e);
    }
  }

  // ─── Button factory ───────────────────────────────────────────────────────
  function createButton() {
    const btn = document.createElement('button');
    btn.id = 'yt-goto-channel-video-btn';
    btn.className = 'ytSpecButtonShapeNextHost ytSpecButtonShapeNextTonal ytSpecButtonShapeNextMono ytSpecButtonShapeNextSizeM ytSpecButtonShapeNextIconLeading ytSpecButtonShapeNextEnableBackdropFilterExperiment';
    btn.type = 'button';
    btn.title = 'Find this video on the channel page';
    btn.setAttribute('aria-label', 'On Channel');
    btn.setAttribute('aria-disabled', 'false');

    // Icon
    const iconDiv = document.createElement('div');
    iconDiv.setAttribute('aria-hidden', 'true');
    iconDiv.className = 'ytSpecButtonShapeNextIcon ytSpecButtonShapeNextElevatedContent';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'ytIconWrapperHost';
    iconSpan.style.cssText = 'width:24px;height:24px;';

    const iconShape = document.createElement('span');
    iconShape.className = 'yt-icon-shape ytSpecIconShapeHost';

    const iconInner = document.createElement('div');
    iconInner.style.cssText = 'width:100%;height:100%;display:block;fill:currentcolor;';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'pointer-events:none;display:inherit;width:100%;height:100%;';

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '2.5'); rect.setAttribute('y', '4.5');
    rect.setAttribute('width', '19'); rect.setAttribute('height', '13');
    rect.setAttribute('rx', '2.2');

    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'M8 21h8');

    const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path2.setAttribute('d', 'M12 17.5v3.2');

    svg.appendChild(rect); svg.appendChild(path1); svg.appendChild(path2);
    iconInner.appendChild(svg); iconShape.appendChild(iconInner);
    iconSpan.appendChild(iconShape); iconDiv.appendChild(iconSpan);

    // Label
    const textDiv = document.createElement('div');
    textDiv.className = 'ytSpecButtonShapeNextButtonTextContent ytSpecButtonShapeNextElevatedContent';
    textDiv.textContent = 'On Channel';

    // Touch feedback
    const touchFeedback = document.createElement('yt-touch-feedback-shape');
    touchFeedback.setAttribute('aria-hidden', 'true');
    touchFeedback.className = 'ytSpecTouchFeedbackShapeHost ytSpecTouchFeedbackShapeTouchResponse';
    const strokeDiv = document.createElement('div');
    strokeDiv.className = 'ytSpecTouchFeedbackShapeStroke';
    const fillDiv = document.createElement('div');
    fillDiv.className = 'ytSpecTouchFeedbackShapeFill';
    touchFeedback.appendChild(strokeDiv); touchFeedback.appendChild(fillDiv);

    // Light shape
    const lightShape = document.createElement('yt-light-shape');
    lightShape.setAttribute('aria-hidden', 'true');
    lightShape.className = 'contribYtLightShapeHost contribYtLightShapeStaticRimLight contribYtLightShapeStaticRimLightTonal';
    const washDiv = document.createElement('div');
    washDiv.className = 'contribYtLightShapeStaticWashLight contribYtLightShapeStaticWashLightTonal';
    lightShape.appendChild(washDiv);

    btn.appendChild(iconDiv); btn.appendChild(textDiv);
    btn.appendChild(touchFeedback); btn.appendChild(lightShape);

    btn.addEventListener('click', () => {
      if (btn.classList.contains('ytnav-loading')) return;
      const videoId = getCurrentVideoId();
      const channelHandle = getChannelHandle();
      if (!videoId || !channelHandle) {
        alert('Could not determine video or channel.\nWait a couple of seconds and try again.');
        return;
      }
      btn.classList.add('ytnav-loading');
      setTimeout(() => btn.classList.remove('ytnav-loading'), 1500);
      GM_setValue(STORAGE_KEY, { videoId, channelHandle, expires: Date.now() + 120_000 });
      const base = channelHandle.startsWith('http') ? channelHandle : 'https://www.youtube.com' + channelHandle;
      window.open(base.replace(/\/$/, '') + '/videos', '_blank');
    });

    return btn;
  }

  // ─── Inject button ────────────────────────────────────────────────────────
  function injectButton() {
    if (document.getElementById('yt-goto-channel-video-btn')) return;
    if (!window.location.pathname.startsWith('/watch')) return;
    const container = document.querySelector('#top-level-buttons-computed');
    if (!container) return;
    container.appendChild(createButton());
  }

  // ─── Route change handler ─────────────────────────────────────────────────
  function onRouteChange() {
    const path = location.pathname;
    if (path.endsWith('/videos')) setTimeout(runOnVideosPage, 800);
    if (path.startsWith('/watch')) setTimeout(injectButton, 600);
  }

  window.addEventListener('yt-navigate-finish', onRouteChange);

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    onRouteChange();
  }, 800);

  // ─── Init ────────────────────────────────────────────────────────────────
  injectStyles();

  if (location.pathname.startsWith('/watch')) {
    let n = 0;
    const t = setInterval(() => {
      injectButton();
      if (document.getElementById('yt-goto-channel-video-btn') || ++n > 25) clearInterval(t);
    }, 400);
  }

  if (location.pathname.endsWith('/videos')) {
    setTimeout(runOnVideosPage, 800);
  }

})();
