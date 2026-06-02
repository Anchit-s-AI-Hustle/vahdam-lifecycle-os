/* eslint-env browser */
/**
 * auth.js — Lifecycle OS shared auth + cross-step navigation header.
 *
 * Drop this <script> into any page in the project. It:
 *   1. Bootstraps the Supabase client from window.__SUPABASE__ (set in HTML head)
 *      OR from the /api/public-config endpoint at runtime.
 *   2. Forces a one-time Google sign-in if no active session.
 *   3. Renders a shared top-bar with cross-step navigation so any stage
 *      can jump to any other stage. The bar lives at the very top of the
 *      document — pages can still render their own headers below.
 *   4. Provides window.LifecycleAuth.{client, session, signOut} for any
 *      page that needs to read the user or query Supabase.
 *
 * Sign-in happens once; session persists in localStorage (Supabase default).
 * Open external links in a new tab; same-app links stay in same tab.
 */
(function () {
  'use strict';

  if (window.__LifecycleAuthBooted) return;
  window.__LifecycleAuthBooted = true;

  // ─── PWA install: register the service worker once per page load ────────
  // This is what makes the address-bar install icon appear in Chrome / Edge
  // (and adds "Add to Home Screen" on iOS/Android) — alongside the manifest.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  const STEPS = [
    { id: 'home',      label: 'Home',         href: '/',               match: ['/', '/index.html'] },
    { id: 'dashboard', label: 'Analysis',     href: '/dashboard.html', match: ['/dashboard.html', '/analytics'] },
    { id: 'calendar',  label: 'Calendar',     href: '/calendar.html',  match: ['/calendar.html', '/plan'] },
    // Mailer Studio is an OPEN feature — it never requires sign-in (works as an
    // individual app). The Lifecycle OS sign-in done at the first step still
    // carries through here, but it is not enforced.
    { id: 'studio',    label: 'Mailer Studio',href: '/studio', open: true, match: ['/studio', '/vahdam_mailer_architect_v34.html', '/app', '/mailer'] },
  ];

  function currentStepId() {
    const p = location.pathname.toLowerCase();
    for (const s of STEPS) if (s.match.some((m) => p === m || p.startsWith(m))) return s.id;
    return 'home';
  }
  // Pages that must never gate behind the login wall.
  function isOpenPage() {
    const s = STEPS.find((x) => x.id === currentStepId());
    return !!(s && s.open);
  }

  // ─── Top-bar (cross-step navigation) ────────────────────────────────
  function injectTopbar(user) {
    if (document.getElementById('lifecycle-topbar')) return;
    const bar = document.createElement('div');
    bar.id = 'lifecycle-topbar';
    bar.innerHTML = `
      <style>
        #lifecycle-topbar {
          /* Sticky throughout: the global nav stays pinned to the top of every
             page. Each page's own filter bar offsets below us via --ltb-h. */
          position: sticky; top: 0; z-index: 100;
          display: flex; align-items: center; gap: 14px;
          padding: 10px 18px;
          background: rgba(7, 14, 11, 0.97);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(171,135,67,0.18);
          font-family: 'Inter', system-ui, sans-serif;
        }
        #lifecycle-topbar { flex-wrap: nowrap; }
        #lifecycle-topbar .ltb-brand {
          display: flex; align-items: center; gap: 8px;
          font-size: 12px; font-weight: 700; letter-spacing: 0.16em;
          color: #AB8743; text-transform: uppercase; text-decoration: none;
          white-space: nowrap; flex-shrink: 0;
        }
        #lifecycle-topbar .ltb-brand:hover { color: #FBF5EA; }
        #lifecycle-topbar .ltb-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: linear-gradient(135deg, #AB8743, #004A2B);
        }
        #lifecycle-topbar nav { display: flex; gap: 4px; }
        #lifecycle-topbar nav a {
          padding: 6px 12px; border-radius: 7px;
          font-size: 12px; color: #9aaaa1; text-decoration: none;
          letter-spacing: 0.04em; transition: all .12s;
          border: 1px solid transparent;
        }
        #lifecycle-topbar nav a:hover { color: #e8ede9; background: rgba(171,135,67,0.08); }
        #lifecycle-topbar nav a.active {
          color: #FBF5EA; background: rgba(171,135,67,0.16);
          border-color: rgba(171,135,67,0.35);
        }
        #lifecycle-topbar nav a .ltb-newtab {
          opacity: 0.45; font-size: 10px; margin-left: 4px;
        }
        #lifecycle-topbar .ltb-spacer { flex: 1; }
        #lifecycle-topbar .ltb-user {
          display: flex; align-items: center; gap: 8px;
          font-size: 11px; color: #9aaaa1;
        }
        #lifecycle-topbar .ltb-avatar {
          width: 24px; height: 24px; border-radius: 50%;
          background: linear-gradient(135deg, #AB8743, #004A2B);
          display: flex; align-items: center; justify-content: center;
          color: #FBF5EA; font-size: 11px; font-weight: 700;
          overflow: hidden;
        }
        #lifecycle-topbar .ltb-avatar img { width: 100%; height: 100%; object-fit: cover; }
        #lifecycle-topbar .ltb-signout {
          background: transparent; border: 1px solid rgba(171,135,67,0.25);
          color: #9aaaa1; cursor: pointer; padding: 5px 10px; border-radius: 6px;
          font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
        }
        #lifecycle-topbar .ltb-signout:hover { border-color: #AB8743; color: #FBF5EA; }
        @media (max-width: 760px) {
          #lifecycle-topbar { padding: 8px 10px; gap: 8px; }
          #lifecycle-topbar .ltb-brand { font-size: 10px; letter-spacing: 0.06em; gap: 6px; }
          /* Nav scrolls horizontally instead of wrapping/overflowing */
          #lifecycle-topbar nav { gap: 2px; overflow-x: auto; flex: 1 1 auto;
            -webkit-overflow-scrolling: touch; scrollbar-width: none; }
          #lifecycle-topbar nav::-webkit-scrollbar { display: none; }
          #lifecycle-topbar nav a { padding: 5px 8px; font-size: 11px; white-space: nowrap; flex-shrink: 0; }
          #lifecycle-topbar nav a .ltb-newtab { display: none; }
          #lifecycle-topbar .ltb-spacer { display: none; }
          #lifecycle-topbar .ltb-user { flex-shrink: 0; gap: 6px; }
          #lifecycle-topbar .ltb-user span:not(.ltb-avatar) { display: none; }
          #lifecycle-topbar .ltb-signout { padding: 4px 7px; font-size: 9px; }
        }
      </style>
      <a class="ltb-brand" href="/">
        <span class="ltb-dot"></span> VAHDAM · Lifecycle OS
      </a>
      <nav id="ltb-nav"></nav>
      <div class="ltb-spacer"></div>
      <div class="ltb-user" id="ltb-user"></div>
    `;
    document.body.insertBefore(bar, document.body.firstChild);

    // Publish the topbar height as --ltb-h so each page's own sticky header can
    // pin directly below the global nav instead of overlapping it. Measure after
    // layout settles (rAF + load) and keep it live via ResizeObserver + resize,
    // since the bar wraps/grows on mobile and after fonts/avatars load.
    const publishHeight = () => {
      const b = document.getElementById('lifecycle-topbar');
      if (!b) return;
      const h = Math.ceil(b.getBoundingClientRect().height) || 48;
      document.documentElement.style.setProperty('--ltb-h', h + 'px');
    };
    publishHeight();
    requestAnimationFrame(publishHeight);
    window.addEventListener('load', publishHeight);
    setTimeout(publishHeight, 400);
    if (!window.__ltbResizeHooked) {
      window.__ltbResizeHooked = true;
      window.addEventListener('resize', publishHeight);
      if (window.ResizeObserver) { try { new ResizeObserver(publishHeight).observe(bar); } catch {} }
    }

    const cur = currentStepId();
    const nav = document.getElementById('ltb-nav');
    // Installed PWA (standalone display-mode) → keep navigation in the same
    // window so it feels like a native app. In a normal browser → open each
    // step in a NEW TAB so the user keeps their place across Analysis /
    // Calendar / Studio.
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    STEPS.forEach((s) => {
      const a = document.createElement('a');
      const isCurrent = s.id === cur;
      a.href = s.href;
      a.textContent = s.label;
      a.className = isCurrent ? 'active' : '';
      if (!isCurrent && !isStandalone) {
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML = `${s.label}<span class="ltb-newtab">↗</span>`;
      }
      nav.appendChild(a);
    });

    const userEl = document.getElementById('ltb-user');
    if (!user) {
      // Guest (open page, not signed in) — offer optional sign-in, never force it.
      userEl.innerHTML = `<a class="ltb-signout" id="ltb-signin" href="/" title="Sign in to Lifecycle OS">Sign in</a>`;
      const btn = document.getElementById('ltb-signin');
      if (btn) btn.onclick = (e) => {
        // If a Supabase client is ready, start Google sign-in in place; else go Home.
        if (window.LifecycleAuth?.client) {
          e.preventDefault();
          window.LifecycleAuth.client.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: location.origin + location.pathname },
          });
        }
      };
      return;
    }
    const initials = (user.user_metadata?.name || user.email || '?').trim().slice(0, 1).toUpperCase();
    const avatar = user.user_metadata?.avatar_url
      ? `<span class="ltb-avatar"><img src="${user.user_metadata.avatar_url}" alt=""></span>`
      : `<span class="ltb-avatar">${initials}</span>`;
    userEl.innerHTML = `${avatar}<span>${user.user_metadata?.name || user.email}</span>
      <button class="ltb-signout" id="ltb-signout">Sign out</button>`;
    document.getElementById('ltb-signout').onclick = () => window.LifecycleAuth.signOut();
  }

  // ─── Login wall ─────────────────────────────────────────────────────
  function injectLoginWall(error) {
    if (document.getElementById('lifecycle-loginwall')) return;
    const wall = document.createElement('div');
    wall.id = 'lifecycle-loginwall';
    wall.innerHTML = `
      <style>
        #lifecycle-loginwall {
          position: fixed; inset: 0; z-index: 9999;
          background: #0a1410;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Inter', system-ui, sans-serif;
          padding: 20px;
        }
        #lifecycle-loginwall .llw-card {
          max-width: 460px; width: 100%;
          background: #0f1d18; border: 1px solid rgba(171,135,67,0.25);
          border-radius: 16px; padding: 40px 36px;
          text-align: center; box-shadow: 0 30px 80px rgba(0,0,0,0.7);
        }
        #lifecycle-loginwall .llw-dot {
          width: 44px; height: 44px; border-radius: 50%;
          background: linear-gradient(135deg, #AB8743, #004A2B);
          margin: 0 auto 18px;
        }
        #lifecycle-loginwall .llw-title {
          font-size: 12px; letter-spacing: 0.22em; color: #AB8743;
          text-transform: uppercase; font-weight: 700;
          margin-bottom: 10px;
        }
        #lifecycle-loginwall h1 {
          font-family: 'Lora','Inter',serif; font-size: 26px;
          color: #FBF5EA; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em;
        }
        #lifecycle-loginwall h1 em { color: #AB8743; font-style: italic; }
        #lifecycle-loginwall p {
          color: #9aaaa1; font-size: 13.5px; line-height: 1.6;
          margin: 0 0 24px;
        }
        #lifecycle-loginwall button {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 10px; padding: 13px 22px;
          background: #FBF5EA; color: #0a1410;
          border: none; border-radius: 9px;
          font-family: inherit; font-size: 14px; font-weight: 600;
          letter-spacing: 0.02em; cursor: pointer;
          width: 100%; transition: opacity .15s;
        }
        #lifecycle-loginwall button:hover  { opacity: 0.92; }
        #lifecycle-loginwall button:disabled { opacity: 0.5; cursor: not-allowed; }
        #lifecycle-loginwall .llw-foot {
          margin-top: 18px; font-size: 11px; color: #5d6e64;
          font-family: 'JetBrains Mono', monospace;
        }
        #lifecycle-loginwall .llw-err {
          color: #f87171; font-size: 12px; padding: 10px;
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3);
          border-radius: 8px; margin-bottom: 18px;
        }
        #lifecycle-loginwall .llw-config {
          color: #fbbf24; font-size: 11px; padding: 12px;
          background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.25);
          border-radius: 8px; margin-top: 16px; text-align: left;
          font-family: 'JetBrains Mono', monospace; line-height: 1.6;
        }
      </style>
      <div class="llw-card">
        <div class="llw-dot"></div>
        <div class="llw-title">VAHDAM · Lifecycle OS</div>
        <h1>Sign in to <em>continue</em></h1>
        <p>Used by the retention growth team. Sign in once with your Google account — the session keeps you signed in across Dashboard, Calendar, and Mailer Studio.</p>
        ${error ? `<div class="llw-err">${error}</div>` : ''}
        <button id="llw-btn" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
            <path fill="#FBBC04" d="M5.84 14.1A6.6 6.6 0 0 1 5.47 12c0-.73.13-1.44.36-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.3 9.14 5.38 12 5.38z"/>
          </svg>
          Sign in with Google
        </button>
        <div class="llw-foot">One-time sign-in · Session persists</div>
        ${window.__SUPABASE__?.url ? '' : `
          <div class="llw-config">
            <b>⚠ Supabase not configured yet.</b><br>
            The login wall is rendered, but no Supabase project URL is set.
            Once provisioned, set <code>SUPABASE_URL</code> + <code>SUPABASE_ANON_KEY</code>
            on Vercel and redeploy. Until then, Google sign-in click will be a no-op.
          </div>
        `}
      </div>
    `;
    document.body.appendChild(wall);

    document.getElementById('llw-btn').onclick = async function () {
      const btn = this;
      btn.disabled = true;
      btn.textContent = 'Redirecting to Google…';
      try {
        if (!window.LifecycleAuth.client) {
          btn.textContent = 'Supabase not configured';
          setTimeout(() => { btn.disabled = false; btn.innerHTML = btn.dataset.original || 'Sign in with Google'; }, 1800);
          return;
        }
        const { error } = await window.LifecycleAuth.client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: location.origin + location.pathname },
        });
        if (error) throw error;
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Sign in with Google';
        const err = document.createElement('div');
        err.className = 'llw-err';
        err.textContent = 'Sign-in failed: ' + (e.message || e);
        btn.parentElement.insertBefore(err, btn);
      }
    };
  }

  function removeLoginWall() {
    const w = document.getElementById('lifecycle-loginwall');
    if (w) w.remove();
  }

  // ─── Supabase bootstrap ─────────────────────────────────────────────
  async function loadSupabaseSDK() {
    if (window.supabase?.createClient) return window.supabase;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
      s.onload = () => resolve(window.supabase);
      s.onerror = () => reject(new Error('failed to load supabase-js'));
      document.head.appendChild(s);
    });
  }

  async function getConfig() {
    if (window.__SUPABASE__?.url && window.__SUPABASE__?.anonKey) return window.__SUPABASE__;
    try {
      const res = await fetch('/api/public-config');
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.supabase?.url && data?.supabase?.anonKey) {
        window.__SUPABASE__ = data.supabase;
        return data.supabase;
      }
    } catch { /* offline mode */ }
    return null;
  }

  async function init() {
    window.LifecycleAuth = {
      client: null,
      session: null,
      user: null,
      signOut: async () => {
        if (window.LifecycleAuth.client) await window.LifecycleAuth.client.auth.signOut();
        window.LifecycleAuth.session = null;
        window.LifecycleAuth.user = null;
        location.reload();
      },
    };

    const config = await getConfig();
    if (!config) {
      // No Supabase configured. On localhost / file:// (dev preview) there is no
      // backend to sign in against, so inject the cross-step top-bar and let the
      // UI run — exactly as the team would see it post-login. Open pages (Mailer
      // Studio) also never gate. In production (a real host) the other steps
      // still require sign-in, so show the wall there.
      const isLocal = location.protocol === 'file:' ||
        /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
      if (isLocal) {
        injectTopbar({ email: 'local@preview', user_metadata: { name: 'Local preview' } });
        return;
      }
      if (isOpenPage()) { injectTopbar(null); return; }
      injectLoginWall();
      return;
    }

    const sdk = await loadSupabaseSDK();
    const client = sdk.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
    window.LifecycleAuth.client = client;

    // Handle the post-OAuth redirect — exchanges the code in the URL for a session.
    if (location.search.includes('code=') || location.hash.includes('access_token=')) {
      try { await client.auth.exchangeCodeForSession(location.href); } catch { /* ignore */ }
      history.replaceState({}, '', location.pathname);
    }

    const { data: { session } } = await client.auth.getSession();
    if (session?.user) {
      window.LifecycleAuth.session = session;
      window.LifecycleAuth.user = session.user;
      injectTopbar(session.user);
      // Keep the Studio frictionless: only prompt for profile on the gated steps.
      if (!isOpenPage()) await maybeShowProfileModal(client, session.user);
    } else if (isOpenPage()) {
      // Open feature (Mailer Studio) — no sign-in required; show nav as guest.
      injectTopbar(null);
    } else {
      injectLoginWall();
    }

    // Listen for sign-in / sign-out and react globally.
    client.auth.onAuthStateChange(async (_event, sess) => {
      window.LifecycleAuth.session = sess;
      window.LifecycleAuth.user = sess?.user || null;
      if (sess?.user) {
        removeLoginWall();
        const existing = document.getElementById('lifecycle-topbar');
        if (existing) existing.remove();   // rebuild so the guest "Sign in" becomes the user chip
        injectTopbar(sess.user);
        if (!isOpenPage()) await maybeShowProfileModal(client, sess.user);
      } else {
        const tb = document.getElementById('lifecycle-topbar');
        if (tb) tb.remove();
        if (isOpenPage()) injectTopbar(null);   // stay open — no wall on the Studio
        else injectLoginWall();
      }
    });
  }

  // ─── Profile modal — shown EXACTLY ONCE, after the user signs up ────────
  // Requirement: the profile popup appears only the first time a user signs
  // up + logs in. After that it must never auto-appear again — whether they
  // filled it or skipped it, on this device or any other.
  //
  // Source of truth is the server flag app_users.profile_prompted. It is set
  // true the moment the popup is shown for the first time. Subsequent logins,
  // even on a fresh device, read profile_prompted=true and skip the modal.
  // A local-storage flag (per user) is kept as a fast path so we do not even
  // round-trip to the DB on subsequent pages of the same session.
  function shownKey(user) { return 'lifecycle-profile-shown:' + (user?.id || 'anon'); }
  async function maybeShowProfileModal(client, user) {
    let alreadyLocal = false;
    try { alreadyLocal = localStorage.getItem(shownKey(user)) === '1'; } catch {}
    if (alreadyLocal) return;

    let row;
    try {
      const { data, error } = await client
        .from('app_users')
        .select('profile_completed, profile_prompted, name, mobile, region')
        .eq('id', user.id)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') {
        console.warn('[auth.js] app_users not readable:', error.message);
        return;
      }
      row = data;
    } catch (e) {
      console.warn('[auth.js] profile check failed:', e.message);
      return;
    }

    // Server says we have already prompted this user, OR profile is complete →
    // remember locally and never auto-show again.
    if (row?.profile_prompted || row?.profile_completed) {
      try { localStorage.setItem(shownKey(user), '1'); } catch {}
      return;
    }

    // Brand-new signup → show the popup ONCE, and mark prompted on both server
    // and device so it can never reappear on any future login.
    try { localStorage.setItem(shownKey(user), '1'); } catch {}
    client.from('app_users').update({ profile_prompted: true }).eq('id', user.id)
      .then(() => {}, () => {});
    showProfileModal(client, user, row);
  }

  function showProfileModal(client, user, currentRow) {
    if (document.getElementById('lifecycle-profile-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'lifecycle-profile-modal';
    modal.innerHTML = `
      <style>
        #lifecycle-profile-modal {
          position: fixed; inset: 0; z-index: 9000;
          background: rgba(0,0,0,0.72); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center; padding: 20px;
          font-family: 'Inter', system-ui, sans-serif;
        }
        #lifecycle-profile-modal .lpm-card {
          max-width: 460px; width: 100%;
          background: #0f1d18; border: 1px solid rgba(171,135,67,0.25);
          border-radius: 14px; padding: 28px 26px; box-shadow: 0 30px 80px rgba(0,0,0,0.6);
        }
        #lifecycle-profile-modal .lpm-eyebrow { font-size: 11px; letter-spacing: 0.18em; color: #AB8743; text-transform: uppercase; font-weight: 700; margin-bottom: 6px; }
        #lifecycle-profile-modal h2 { font-family: 'Lora','Inter',serif; font-size: 22px; color: #FBF5EA; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
        #lifecycle-profile-modal h2 em { color: #AB8743; font-style: italic; }
        #lifecycle-profile-modal .lpm-sub { color: #9aaaa1; font-size: 13px; line-height: 1.55; margin: 0 0 18px; }
        #lifecycle-profile-modal label { display: block; font-size: 11px; color: #5d6e64; text-transform: uppercase; letter-spacing: 0.1em; margin: 12px 0 5px; font-weight: 600; }
        #lifecycle-profile-modal input, #lifecycle-profile-modal select {
          width: 100%; box-sizing: border-box;
          background: #0a1410; border: 1px solid rgba(171,135,67,0.2); border-radius: 8px;
          color: #e8ede9; padding: 10px 12px; font-size: 13px; font-family: inherit;
        }
        #lifecycle-profile-modal input:focus, #lifecycle-profile-modal select:focus { outline: none; border-color: #AB8743; }
        #lifecycle-profile-modal .lpm-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        #lifecycle-profile-modal .lpm-actions { display: flex; gap: 10px; margin-top: 22px; }
        #lifecycle-profile-modal button { font-family: inherit; font-size: 12.5px; padding: 11px 18px; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; letter-spacing: 0.02em; transition: opacity .15s; }
        #lifecycle-profile-modal .lpm-skip   { background: transparent; color: #9aaaa1; border: 1px solid rgba(171,135,67,0.25); }
        #lifecycle-profile-modal .lpm-skip:hover { color: #e8ede9; }
        #lifecycle-profile-modal .lpm-save   { background: #AB8743; color: #0a1410; flex: 1; }
        #lifecycle-profile-modal .lpm-save:hover { opacity: 0.92; }
        #lifecycle-profile-modal .lpm-foot { font-size: 11px; color: #5d6e64; margin-top: 14px; text-align: center; font-family: 'JetBrains Mono', monospace; }
        #lifecycle-profile-modal .lpm-err { color: #f87171; font-size: 12px; margin-top: 10px; padding: 8px; background: rgba(239,68,68,0.08); border-radius: 6px; }
      </style>
      <div class="lpm-card">
        <div class="lpm-eyebrow">Welcome to Lifecycle OS</div>
        <h2>Tell us a bit about <em>you</em></h2>
        <p class="lpm-sub">Helps us tailor the dashboard, calendar, and mailer suggestions to your region.
          <b>Skip anytime</b> — nothing here is required.</p>

        <label for="lpm-name">Name</label>
        <input id="lpm-name" type="text" placeholder="${(user.user_metadata?.name || '').replace(/"/g, '&quot;')}" value="${(currentRow?.name || user.user_metadata?.name || '').replace(/"/g, '&quot;')}" autocomplete="name">

        <div class="lpm-row">
          <div>
            <label for="lpm-mobile">Mobile</label>
            <input id="lpm-mobile" type="tel" placeholder="+91 98xxx-xxxxx" value="${(currentRow?.mobile || '').replace(/"/g, '&quot;')}" autocomplete="tel">
          </div>
          <div>
            <label for="lpm-region">Region</label>
            <select id="lpm-region">
              <option value="">—</option>
              <option value="IN">India</option>
              <option value="US">United States</option>
              <option value="UK">United Kingdom</option>
              <option value="EU">Europe</option>
              <option value="ME">Middle East</option>
              <option value="AU">Australia</option>
              <option value="CA">Canada</option>
              <option value="JP">Japan</option>
              <option value="SG">Singapore</option>
              <option value="Global">Other / Global</option>
            </select>
          </div>
        </div>

        <div id="lpm-err"></div>
        <div class="lpm-actions">
          <button class="lpm-skip" id="lpm-skip-btn" type="button">Skip for now</button>
          <button class="lpm-save" id="lpm-save-btn" type="button">Save profile</button>
        </div>
        <div class="lpm-foot">Stored only in your app_users row · visible only to you</div>
      </div>
    `;
    document.body.appendChild(modal);

    // Pre-fill region from previous row if any
    if (currentRow?.region) {
      modal.querySelector('#lpm-region').value = currentRow.region;
    }

    const close = () => modal.remove();

    modal.querySelector('#lpm-skip-btn').addEventListener('click', () => {
      // The "shown once" flag was already set in maybeShowProfileModal, so the
      // popup will not auto-appear again. Skipping just closes it; the user can
      // still fill their profile later if a profile entry point is added.
      try { localStorage.setItem(shownKey(user), '1'); } catch {}
      close();
    });

    modal.querySelector('#lpm-save-btn').addEventListener('click', async function () {
      const btn = this;
      btn.disabled = true; btn.textContent = 'Saving…';
      const name   = modal.querySelector('#lpm-name').value.trim()   || null;
      const mobile = modal.querySelector('#lpm-mobile').value.trim() || null;
      const region = modal.querySelector('#lpm-region').value        || null;
      try {
        const { error } = await client.from('app_users').update({
          name, mobile, region,
          profile_completed: true,
        }).eq('id', user.id);
        if (error) throw error;
        close();
      } catch (e) {
        const err = modal.querySelector('#lpm-err');
        err.className = 'lpm-err';
        err.textContent = 'Could not save: ' + (e.message || e);
        btn.disabled = false; btn.textContent = 'Save profile';
      }
    });
  }


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
