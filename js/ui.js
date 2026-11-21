/* ui.js — 화면 공통 도우미 */
(function (global) {
  'use strict';

  var CK = global.ColorKit;
  var reduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TEAM_NAMES = ['호랑이팀', '토끼팀', '펭귄팀', '고래팀'];

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function show(view) {
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('is-active', v.dataset.view === view);
    });
    document.body.dataset.view = view;
    global.scrollTo(0, 0);
  }

  function setTarget(hex) {
    var root = document.documentElement.style;
    root.setProperty('--target', hex);
    root.setProperty('--on-target', CK.inkOn(hex));
  }

  function fmtScore(s) { return (Math.round(s * 10) / 10).toFixed(1).replace(/\.0$/, ''); }

  // 견본 칩 (색 + 이름 + 값)
  function swatchCard(hex, title, sub) {
    var c = el('div', 'swatch-card'), i = el('i'), s = el('span'), b = el('b', null, title);
    i.style.background = hex;
    s.appendChild(b);
    s.appendChild(document.createTextNode(sub || hex));
    c.appendChild(i); c.appendChild(s);
    return c;
  }

  // 사진 + 가장 비슷했던 영역 표시
  function shotFigure(url, r, fig) {
    fig = fig || el('figure', 'shot');
    fig.textContent = '';
    if (!url) { fig.appendChild(el('div', 'none', '사진 없음')); return fig; }
    var img = el('img');
    img.src = url; img.alt = '';
    fig.appendChild(img);
    if (r && r.size) {
      var a = r.aspect || 4 / 3;
      fig.style.aspectRatio = String(a);
      var m = el('span', 'mark');
      m.style.left = (r.x * 100) + '%';
      m.style.top = (r.y * 100) + '%';
      m.style.width = (r.size * Math.min(1, 1 / a) * 100) + '%';
      m.style.height = (r.size * Math.min(1, a) * 100) + '%';
      fig.appendChild(m);
    }
    return fig;
  }

  // 공동 순위 매기기: 점수 높은 순으로 rank 붙이기
  function rankBy(list, key) {
    var sorted = list.slice().sort(function (a, b) { return b[key] - a[key]; });
    var rank = 0, prev = null;
    sorted.forEach(function (x, i) {
      var v = Math.round(x[key] * 10);
      if (prev === null || v < prev) rank = i + 1;
      x.rank = rank; prev = v;
    });
    return sorted;
  }

  /* ---------- 소리 ---------- */
  var actx = null;
  function ctx() {
    if (!actx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, at, dur, type, vol) {
    var c = ctx(); if (!c) return;
    var t = c.currentTime + (at || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.15, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  var sfx = {
    unlock: function () { ctx(); },
    tick: function () { tone(880, 0, 0.12, 'sine', 0.18); },
    go: function () { tone(1320, 0, 0.3, 'sine', 0.22); },
    low: function () { tone(1040, 0, 0.08, 'square', 0.06); },
    end: function () { tone(784, 0, 0.18, 'square', 0.1); tone(523, 0.16, 0.5, 'square', 0.1); },
    shutter: function () { tone(2200, 0, 0.04, 'square', 0.05); tone(1500, 0.05, 0.05, 'square', 0.04); },
    fanfare: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.12, 0.4, 'triangle', 0.14); }); }
  };

  /* ---------- 꽃가루 (무채색 + 목표색) ---------- */
  function confetti(hexes) {
    if (reduceMotion) return;
    var cv = $('confetti'), g = cv.getContext('2d'), dpr = global.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var colors = (hexes && hexes.length ? hexes : ['#1f1f1f']).concat(['#1f1f1f', '#ffffff', '#9a9a9a']);
    var parts = [];
    for (var i = 0; i < 170; i++) {
      parts.push({
        x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.6,
        vx: (Math.random() - 0.5) * 2.2, vy: 2 + Math.random() * 3, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        w: 7 + Math.random() * 7, h: 9 + Math.random() * 9, c: colors[i % colors.length]
      });
    }
    var t0 = performance.now();
    (function frame(now) {
      g.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.r += p.vr;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r);
        g.fillStyle = p.c; g.strokeStyle = 'rgba(0,0,0,.25)';
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r)));
        g.restore();
      });
      if (now - t0 < 4500) requestAnimationFrame(frame); else g.clearRect(0, 0, innerWidth, innerHeight);
    })(t0);
  }

  function netbar(text) {
    var b = $('netbar');
    b.textContent = text || '';
    b.hidden = !text;
  }

  function bufToUrl(buf, type) {
    if (!buf) return null;
    return URL.createObjectURL(new Blob([buf], { type: type || 'image/jpeg' }));
  }

  global.UI = {
    $: $, el: el, show: show, setTarget: setTarget, fmtScore: fmtScore, swatchCard: swatchCard,
    shotFigure: shotFigure, rankBy: rankBy, sfx: sfx, confetti: confetti, netbar: netbar,
    bufToUrl: bufToUrl, TEAM_NAMES: TEAM_NAMES, reduceMotion: reduceMotion
  };
})(window);
