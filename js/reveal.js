/*
 * reveal.js — 순위 발표 연출
 *
 * 라운드 결과 (큰 화면, 약 15초)
 *   1. 스캔     : 사진들이 흩어져 등장 → 조준 네모가 사진을 훑다가 가장 비슷한 곳에 '찰칵' 고정, 찾은 색이 튀어나옴
 *   2. 색 경주  : 각자 찾은 색 칩이 목표색(결승선)을 향해 달림. 점수만큼 멀리 감 → 도착 후 순위대로 자리바꿈
 *   3. 팀 대결  : (팀전) 팀 막대가 솟아오르고 1등 팀 표시
 *   4. TOP 3    : 3등 → 2등 → 드럼롤 "1등은…" → 섬광과 함께 1등 사진이 크게 등장, 꽃가루
 * 누적 순위    : 결과 화면 옆에서 지난 순서 → 새 순서로 자리바꿈 (▲▼)
 * 최종 시상식  : 라운드 회고 → 시상대 3·2등 상승 → 스포트라이트가 훑다가 1등에 멈춤
 * 휴대폰       : 큰 화면 발표가 끝나면 슬롯머신처럼 내 순위가 돌다가 멈춤
 *
 * 어느 장면이든 '건너뛰기' 버튼, Esc·Space·Enter 로 바로 끝낼 수 있습니다.
 * 움직임 줄이기 설정을 켠 기기에서는 연출 없이 결과만 보여 줍니다.
 */
(function (global) {
  'use strict';

  var UI = global.UI, CK = global.ColorKit, el = UI.el;
  var SKIP = { skip: true };
  var EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';
  var EASE_BOUNCE = 'cubic-bezier(.34,1.56,.64,1)';

  /* ================= 타임라인 (건너뛰기 가능) ================= */
  function Show() { this.dead = false; this.pending = []; this.anims = []; }

  Show.prototype.guard = function (p) {
    var self = this;
    if (this.dead) return Promise.reject(SKIP);
    return new Promise(function (res, rej) {
      var entry = { rej: rej };
      self.pending.push(entry);
      function done() { var i = self.pending.indexOf(entry); if (i >= 0) self.pending.splice(i, 1); }
      p.then(function (v) { done(); if (self.dead) rej(SKIP); else res(v); }, function () { done(); rej(SKIP); });
    });
  };
  Show.prototype.wait = function (ms) { return this.guard(new Promise(function (r) { setTimeout(r, ms); })); };
  // 끝날 때까지 기다리는 애니메이션
  Show.prototype.anim = function (node, frames, opts) {
    if (this.dead) return Promise.reject(SKIP);
    var a = node.animate(frames, Object.assign({ fill: 'forwards', easing: EASE_OUT }, opts));
    this.anims.push(a);
    return this.guard(a.finished);
  };
  // 걸어 두고 바로 다음으로 넘어가는 애니메이션
  Show.prototype.fx = function (node, frames, opts) {
    if (this.dead) return null;
    var a = node.animate(frames, Object.assign({ fill: 'forwards', easing: EASE_OUT }, opts));
    this.anims.push(a);
    return a;
  };
  Show.prototype.count = function (node, to, dur, fmt, from) {
    var self = this;
    fmt = fmt || UI.fmtScore;
    from = from || 0;
    return this.guard(new Promise(function (res) {
      var t0 = performance.now();
      (function f(now) {
        if (self.dead) { res(); return; }
        var k = Math.min(1, Math.max(0, (now - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
        node.textContent = fmt(from + (to - from) * e);
        if (k < 1) requestAnimationFrame(f); else res();
      })(t0);
    }));
  };
  Show.prototype.kill = function () {
    this.dead = true;
    this.pending.slice().forEach(function (e) { e.rej(SKIP); });
    this.pending = [];
    this.anims.forEach(function (a) { try { a.cancel(); } catch (e) { /* 무시 */ } });
  };

  function run(cls, script, done) {
    if (UI.reduceMotion || !Element.prototype.animate) { done(); return { skip: function () {} }; }
    var show = new Show(), finished = false;
    var stage = el('div', 'rv-stage ' + (cls || ''));
    stage.setAttribute('role', 'dialog');
    stage.setAttribute('aria-label', '순위 발표');
    var skip = el('button', 'rv-skip', '건너뛰기');
    skip.type = 'button';
    stage.appendChild(skip);
    document.body.appendChild(stage);
    function onKey(e) {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); finish(); }
    }
    document.addEventListener('keydown', onKey);
    skip.addEventListener('click', finish);
    function finish() {
      if (finished) return;
      finished = true;
      show.kill();
      document.removeEventListener('keydown', onKey);
      done();
      var a = stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, fill: 'forwards' });
      a.finished.then(function () { stage.remove(); }, function () { stage.remove(); });
    }
    Promise.resolve().then(function () { return script(show, stage); }).then(finish, function (e) {
      if (e !== SKIP && global.console) console.error(e);
      finish();
    });
    return { skip: finish };
  }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function hexOf(x) { return x.rgb ? CK.rgbToHex(x.rgb) : '#999999'; }

  function fadeOut(S, node, ms) {
    return S.anim(node, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: ms || 420, easing: 'ease-in' })
      .then(function () { node.remove(); });
  }

  function setTitle(S, st, text) {
    var t = st.querySelector('.rv-title');
    if (!t) { t = el('p', 'rv-title'); st.appendChild(t); }
    t.textContent = text;
    S.fx(t, [{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'none' }], { duration: 500 });
  }

  // 사진 + 조준 네모 (크기를 픽셀로 맞춰 둠)
  function photoFrame(x, w, h) {
    var a = x.aspect || 4 / 3, fw, fh;
    if (w / h > a) { fh = h; fw = h * a; } else { fw = w; fh = w / a; }
    var frame = el('div', 'rv-frame');
    frame.style.width = fw + 'px';
    frame.style.height = fh + 'px';
    var img = el('img');
    img.src = x.url; img.alt = '';
    frame.appendChild(img);
    var side = (x.size || 0.12) * Math.min(fw, fh);
    var ret = el('span', 'rv-reticle');
    ret.style.width = ret.style.height = side + 'px';
    frame.appendChild(ret);
    return { frame: frame, ret: ret };
  }

  /* ================= 라운드 결과 쇼 ================= */
  function roundShow(d, done) {
    return run('rv-round', async function (S, st) {
      var shots = d.list.filter(function (x) { return x.url; });
      setTitle(S, st, d.round + '라운드 결과');
      if (!shots.length) {
        var none = el('p', 'rv-big', '아무도 사진을 못 냈어요');
        st.appendChild(none);
        await S.anim(none, [{ opacity: 0 }, { opacity: 1 }], { duration: 500 });
        await S.wait(1600);
        return;
      }
      await scanScene(S, st, shots);
      await raceScene(S, st, shots, d);
      if (d.teams && d.teams.length) await teamScene(S, st, d.teams);
      await topScene(S, st, shots, d);
    }, done);
  }

  // 1. 스캔
  async function scanScene(S, st, shots) {
    var wrap = el('div', 'rv-scan');
    st.appendChild(wrap);
    var n = shots.length, gap = 16, W = innerWidth * 0.9, H = innerHeight * 0.7, best = { s: 0, c: 1 };
    for (var c = 1; c <= n; c++) {
      var r = Math.ceil(n / c), s = Math.min((W - gap * (c - 1)) / c, (H - gap * (r - 1)) / r);
      if (s > best.s) best = { s: s, c: c };
    }
    var size = Math.min(best.s, 380);
    wrap.style.gridTemplateColumns = 'repeat(' + best.c + ', ' + size + 'px)';
    wrap.style.gap = gap + 'px';

    var tiles = shots.map(function (x, i) {
      var tile = el('div', 'rv-tile');
      tile.style.width = size + 'px';
      var pf = photoFrame(x, size, size * 0.82);
      var box = el('div', 'rv-tile-photo');
      box.style.height = size * 0.82 + 'px';
      box.appendChild(pf.frame);
      tile.appendChild(box);
      tile.appendChild(el('span', 'rv-tile-name', x.name));
      wrap.appendChild(tile);
      var rot = (Math.random() * 14 - 7).toFixed(1);
      S.fx(tile, [
        { opacity: 0, transform: 'translateY(40px) scale(.7) rotate(' + rot + 'deg)' },
        { opacity: 1, transform: 'none' }
      ], { duration: 480, delay: i * 55, easing: EASE_BOUNCE });
      return { x: x, frame: pf.frame, ret: pf.ret };
    });
    await S.wait(480 + n * 55);

    UI.sfx.scan();
    await Promise.all(tiles.map(function (t, i) {
      var path = [{ left: '50%', top: '50%', opacity: 0 }];
      for (var k = 0; k < 3; k++) path.push({ left: (15 + Math.random() * 70) + '%', top: (15 + Math.random() * 70) + '%', opacity: 1 });
      path.push({ left: (t.x.x * 100) + '%', top: (t.x.y * 100) + '%', opacity: 1 });
      return S.anim(t.ret, path, { duration: 1200, delay: i * 60, easing: 'ease-in-out' }).then(function () {
        t.ret.classList.add('is-lock');
        UI.sfx.blip();
        var chip = el('span', 'rv-chip');
        chip.style.background = hexOf(t.x);
        chip.style.left = (t.x.x * 100) + '%';
        chip.style.top = (t.x.y * 100) + '%';
        t.frame.appendChild(chip);
        S.fx(chip, [
          { transform: 'translate(-50%,-50%) scale(0)' },
          { transform: 'translate(-50%,-50%) translate(0,-38px) scale(1.35)', offset: 0.6 },
          { transform: 'translate(-50%,-50%) translate(0,-30px) scale(1)' }
        ], { duration: 520, easing: 'ease-out' });
      });
    }));
    await S.wait(650);
    await fadeOut(S, wrap, 400);
  }

  // 2. 색 경주
  async function raceScene(S, st, shots, d) {
    setTitle(S, st, '누가 목표색에 가장 가까울까?');
    var n = shots.length;
    var race = el('div', 'rv-race');
    var laneH = Math.max(30, Math.min(70, (innerHeight * 0.66) / n));
    race.style.setProperty('--lane', laneH + 'px');
    var head = el('div', 'rv-race-head');
    head.appendChild(el('span'));
    head.appendChild(el('span', 'rv-race-start', '0'));
    var goal = el('span', 'rv-goal');
    goal.appendChild(el('i'));
    goal.appendChild(document.createTextNode('목표색 100'));
    head.appendChild(goal);
    race.appendChild(head);
    st.appendChild(race);

    var lanes = shuffle(shots).map(function (x) {
      var lane = el('div', 'rv-lane');
      var rk = el('span', 'rv-rank', '');
      var nm = el('span', 'rv-name', x.name);
      var track = el('div', 'rv-track');
      var runner = el('span', 'rv-runner');
      runner.style.background = hexOf(x);
      track.appendChild(runner);
      var sc = el('span', 'rv-score', '0');
      lane.appendChild(rk); lane.appendChild(nm); lane.appendChild(track); lane.appendChild(sc);
      race.appendChild(lane);
      return { x: x, lane: lane, rk: rk, track: track, runner: runner, sc: sc };
    });
    lanes.forEach(function (L, i) {
      S.fx(L.lane, [{ opacity: 0, transform: 'translateX(-60px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: i * 45 });
    });
    await S.wait(420 + n * 45 + 150);

    var maxDur = 0;
    var runs = lanes.map(function (L) {
      var travel = L.track.clientWidth - L.runner.offsetWidth;
      var dur = 1300 + L.x.score * 12;
      maxDur = Math.max(maxDur, dur);
      return Promise.all([
        S.anim(L.runner, [
          { transform: 'translateX(0)' },
          { transform: 'translateX(' + (travel * L.x.score / 100) + 'px)' }
        ], { duration: dur, easing: 'cubic-bezier(.12,.75,.25,1)' }),
        S.count(L.sc, L.x.score, dur)
      ]).then(function () { L.lane.classList.add('is-done'); });
    });
    UI.sfx.whoosh(maxDur / 1000);
    await Promise.all(runs);
    await S.wait(350);

    // 순위대로 자리바꿈 (FLIP)
    var before = lanes.map(function (L) { return L.lane.getBoundingClientRect().top; });
    var sorted = lanes.slice().sort(function (a, b) { return a.x.rank - b.x.rank || b.x.score - a.x.score; });
    sorted.forEach(function (L) { race.appendChild(L.lane); });
    UI.sfx.shuffle();
    await Promise.all(lanes.map(function (L, i) {
      var dy = before[i] - L.lane.getBoundingClientRect().top;
      L.rk.textContent = L.x.rank;
      return S.anim(L.lane, [
        { transform: 'translateY(' + dy + 'px)', zIndex: 2 },
        { transform: 'translateY(' + (dy * 0.5) + 'px) scale(1.03)', zIndex: 2, offset: 0.5 },
        { transform: 'none', zIndex: 1 }
      ], { duration: 850, easing: 'cubic-bezier(.6,0,.2,1)' });
    }));
    sorted[0].lane.classList.add('is-top');
    sorted.forEach(function (L) { if (L.x.rank === 1) L.lane.classList.add('is-top'); });
    await S.wait(1000);
    await fadeOut(S, race, 380);
  }

  // 3. 팀 대결
  async function teamScene(S, st, teams) {
    setTitle(S, st, '팀 대결');
    var box = el('div', 'rv-teams');
    st.appendChild(box);
    var byId = teams.slice().sort(function (a, b) { return a.id - b.id; });
    var cols = byId.map(function (t) {
      var col = el('div', 'rv-team');
      var val = el('span', 'rv-team-val', '0');
      var bar = el('span', 'rv-team-bar');
      var nm = el('span', 'rv-team-name', t.name);
      var badge = el('span', 'rv-team-badge', t.rank + '등');
      bar.appendChild(badge);
      col.appendChild(val); col.appendChild(bar); col.appendChild(nm);
      box.appendChild(col);
      return { t: t, col: col, val: val, bar: bar, badge: badge };
    });
    await S.wait(300);
    UI.sfx.whoosh(1.6);
    await Promise.all(cols.map(function (c, i) {
      var h = Math.max(2, c.t.score) + '%';
      return Promise.all([
        S.anim(c.bar, [{ height: '0%' }, { height: h }], { duration: 1300 + i * 120, easing: 'cubic-bezier(.2,.9,.25,1)' }),
        S.count(c.val, c.t.score, 1300 + i * 120)
      ]);
    }));
    cols.forEach(function (c) {
      if (c.t.rank === 1) {
        c.col.classList.add('is-win');
        S.fx(c.badge, [{ opacity: 0, transform: 'translate(-50%,-20px) scale(.4)' }, { opacity: 1, transform: 'translate(-50%,0) scale(1)' }], { duration: 520, easing: EASE_BOUNCE });
      }
    });
    UI.sfx.pop();
    await S.wait(1200);
    await fadeOut(S, box, 380);
  }

  // 4. TOP 3
  async function topScene(S, st, shots, d) {
    setTitle(S, st, d.round + '라운드 TOP ' + Math.min(3, shots.length));
    var top = shots.slice(0, 3);
    var stageEl = el('div', 'rv-top');
    st.appendChild(stageEl);
    var rays = el('div', 'rv-rays');
    rays.appendChild(el('i'));   // 안쪽 i 가 CSS로 천천히 돎
    stageEl.appendChild(rays);
    var slotOrder = [1, 0, 2];  // 왼쪽 2등, 가운데 1등, 오른쪽 3등
    var cards = [];
    var bigW = Math.min(520, innerWidth * 0.36), sideW = Math.min(330, innerWidth * 0.22);
    slotOrder.forEach(function (k) {
      var slot = el('div', 'rv-slot' + (k === 0 ? ' is-center' : ''));
      stageEl.appendChild(slot);
      var x = top[k];
      if (!x) return;
      var w = k === 0 ? bigW : sideW;
      var card = el('div', 'rv-card');
      card.style.width = w + 'px';
      var label = el('span', 'rv-card-rank', x.rank + '등');
      var pf = photoFrame(x, w - 24, (w - 24) * 0.8);
      pf.ret.classList.add('is-lock');
      pf.ret.style.left = (x.x * 100) + '%';
      pf.ret.style.top = (x.y * 100) + '%';
      var ph = el('div', 'rv-card-photo');
      ph.style.height = (w - 24) * 0.8 + 'px';
      ph.appendChild(pf.frame);
      var chips = el('div', 'rv-card-chips'), a = el('i'), b = el('i');
      a.style.background = d.target.hex; b.style.background = hexOf(x);
      chips.appendChild(a); chips.appendChild(b);
      var meta = el('div', 'rv-card-meta');
      meta.appendChild(el('b', null, x.name));
      var sc = el('span', 'rv-card-score', '0');
      meta.appendChild(sc);
      card.appendChild(label); card.appendChild(ph); card.appendChild(chips); card.appendChild(meta);
      card.style.opacity = '0';
      slot.appendChild(card);
      cards[k] = { x: x, card: card, sc: sc };
    });

    // 3등, 2등
    for (var k = Math.min(2, top.length - 1); k >= 1; k--) {
      var C = cards[k];
      UI.sfx.pop();
      S.fx(C.card, [
        { opacity: 0, transform: 'translateY(-70vh) rotate(' + (k === 1 ? -9 : 9) + 'deg)' },
        { opacity: 1, transform: 'translateY(0) rotate(' + (k === 1 ? -2 : 2) + 'deg)', offset: 0.7 },
        { opacity: 1, transform: 'translateY(-14px) rotate(0deg)', offset: 0.85 },
        { opacity: 1, transform: 'none' }
      ], { duration: 800, easing: 'cubic-bezier(.3,.6,.4,1)' });
      await S.wait(420);
      await S.count(C.sc, C.x.score, 550, function (v) { return UI.fmtScore(v) + '점'; });
      await S.wait(450);
    }

    // 1등 — 드럼롤
    var who = el('p', 'rv-who', '1등은…');
    st.appendChild(who);
    UI.sfx.drumroll(1.8);
    S.fx(who, [
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.7)' },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }
    ], { duration: 400 });
    S.fx(who, [
      { transform: 'translate(-50%,-50%) scale(1)' },
      { transform: 'translate(-50%,-50%) scale(1.08)' }
    ], { duration: 240, delay: 360, iterations: 6, direction: 'alternate', easing: 'ease-in-out' });
    if (cards[1]) S.fx(cards[1].card, [{ opacity: 1 }, { opacity: 0.35 }], { duration: 400 });
    if (cards[2]) S.fx(cards[2].card, [{ opacity: 1 }, { opacity: 0.35 }], { duration: 400 });
    await S.wait(1850);
    who.remove();

    // 섬광 + 등장
    var flash = el('div', 'rv-flash');
    st.appendChild(flash);
    S.fx(flash, [{ opacity: 0.95 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
    UI.sfx.cymbal();
    UI.sfx.fanfare();
    [1, 2].forEach(function (i) { if (cards[i]) S.fx(cards[i].card, [{ opacity: 0.35 }, { opacity: 1 }], { duration: 500, delay: 300 }); });
    S.fx(rays, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.5)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 1400 });
    var W = cards[0];
    S.fx(W.card, [
      { opacity: 0, transform: 'scale(.25)' },
      { opacity: 1, transform: 'scale(1.12)', offset: 0.65 },
      { opacity: 1, transform: 'scale(1)' }
    ], { duration: 900, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    UI.confetti([d.target.hex, hexOf(W.x)]);
    await S.wait(300);
    await S.count(W.sc, W.x.score, 800, function (v) { return UI.fmtScore(v) + '점'; });
    W.card.classList.add('is-win');
    await S.wait(2300);
  }

  /* ================= 누적 순위 자리바꿈 ================= */
  /**
   * box 에 순위표를 그리고 '이전 합계 순서' → '새 합계 순서'로 움직임
   * rows: [{ id, name, prev, now, sub }]
   */
  function leaderboard(box, rows, animate) {
    box.textContent = '';
    var prevRank = UI.rankBy(rows.map(function (r) { return { id: r.id, v: r.prev }; }), 'v');
    var nowRank = UI.rankBy(rows.map(function (r) { return { id: r.id, v: r.now }; }), 'v');
    var pr = {}, nr = {};
    prevRank.forEach(function (x) { pr[x.id] = x.rank; });
    nowRank.forEach(function (x) { nr[x.id] = x.rank; });
    var firstRound = rows.every(function (r) { return !r.prev; });
    var start = animate ? prevRank : nowRank;
    var items = {};
    start.forEach(function (s) {
      var r = rows.filter(function (q) { return q.id === s.id; })[0];
      var li = el('li', 'lb-row');
      var rk = el('span', 'lb-rank', animate ? pr[r.id] : nr[r.id]);
      var nm = el('span', 'lb-name', r.name);
      if (r.sub) nm.appendChild(el('small', null, r.sub));
      var delta = el('span', 'lb-delta', '');
      var tot = el('span', 'lb-total', UI.fmtScore(animate ? r.prev : r.now));
      li.appendChild(rk); li.appendChild(nm); li.appendChild(delta); li.appendChild(tot);
      box.appendChild(li);
      items[r.id] = { r: r, li: li, rk: rk, delta: delta, tot: tot };
    });
    if (!animate || UI.reduceMotion || !Element.prototype.animate) {
      Object.keys(items).forEach(function (id) { setDelta(items[id], pr[id], nr[id], !firstRound); });
      return;
    }
    // 1) 합계가 올라가고  2) 자리바꿈  3) ▲▼ 표시
    setTimeout(function () {
      var t0 = performance.now(), dur = 900;
      (function f(now) {
        var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        Object.keys(items).forEach(function (id) {
          var it = items[id];
          it.tot.textContent = UI.fmtScore(it.r.prev + (it.r.now - it.r.prev) * e);
        });
        if (k < 1) { requestAnimationFrame(f); return; }
        var before = {};
        Object.keys(items).forEach(function (id) { before[id] = items[id].li.getBoundingClientRect().top; });
        nowRank.forEach(function (x) { box.appendChild(items[x.id].li); });
        UI.sfx.shuffle();
        Object.keys(items).forEach(function (id) {
          var it = items[id], dy = before[id] - it.li.getBoundingClientRect().top;
          it.rk.textContent = nr[id];
          var up = !firstRound && pr[id] > nr[id];
          it.li.animate([
            { transform: 'translateY(' + dy + 'px)', background: up ? 'rgba(31,31,31,.08)' : 'transparent' },
            { transform: 'translateY(' + dy * 0.4 + 'px)' + (up ? ' scale(1.02)' : ''), offset: 0.55 },
            { transform: 'none', background: 'transparent' }
          ], { duration: 900, easing: 'cubic-bezier(.6,0,.2,1)' });
          setTimeout(function () { setDelta(it, pr[id], nr[id], !firstRound); }, 900);
        });
      })(t0);
    }, 700);
  }

  function setDelta(it, p, n, show) {
    var d = p - n;
    it.delta.className = 'lb-delta' + (d > 0 ? ' is-up' : d < 0 ? ' is-down' : '');
    it.delta.textContent = !show ? '' : d > 0 ? '▲' + d : d < 0 ? '▼' + (-d) : '–';
    if (show && it.delta.animate && !UI.reduceMotion) {
      it.delta.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'none' }], { duration: 350, easing: EASE_BOUNCE });
    }
  }

  /* ================= 최종 시상식 ================= */
  /**
   * d = { teamMode, entries: [{ name, total, rank, url }], rounds: [{ round, hex, name, winner }] }
   */
  function finalShow(d, done) {
    return run('rv-final', async function (S, st) {
      var spot = el('div', 'rv-spot');
      st.appendChild(spot);
      setTitle(S, st, '최종 결과');

      // 라운드 회고: 그동안의 목표색과 라운드 1등
      if (d.rounds.length) {
        var strip = el('div', 'rv-recap');
        st.appendChild(strip);
        d.rounds.forEach(function (r, i) {
          var c = el('div', 'rv-recap-chip');
          var sw = el('i');
          sw.style.background = r.hex;
          c.appendChild(sw);
          c.appendChild(el('b', null, r.round + '라운드 ' + r.name));
          c.appendChild(el('small', null, r.winner ? r.winner + ' 1등' : '사진 없음'));
          strip.appendChild(c);
          S.fx(c, [{ opacity: 0, transform: 'translateY(30px) rotate(-6deg)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: i * 260, easing: EASE_BOUNCE });
          setTimeout(function () { if (!S.dead) UI.sfx.blip(); }, i * 260);
        });
        await S.wait(480 + d.rounds.length * 260 + 1100);
        await S.anim(strip, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-4vh) scale(.62)', opacity: 0.55 }], { duration: 700 });
      }

      // 시상대
      var pod = el('div', 'rv-podium');
      st.appendChild(pod);
      var top = d.entries.slice(0, 3);
      var heights = [40, 28, 19];  // vh
      var cols = [];
      [1, 0, 2].forEach(function (k) {
        var col = el('div', 'rv-pcol p' + (k + 1));
        pod.appendChild(col);
        var x = top[k];
        if (!x) return;
        var info = el('div', 'rv-pinfo');
        if (x.url) { var im = el('img', 'rv-pphoto'); im.src = x.url; im.alt = ''; info.appendChild(im); }
        info.appendChild(el('b', 'rv-pname', x.name));
        var tot = el('span', 'rv-ptotal', '0');
        info.appendChild(tot);
        info.style.opacity = '0';
        var block = el('div', 'rv-pblock', x.rank);
        block.style.height = '0';
        col.appendChild(info); col.appendChild(block);
        cols[k] = { x: x, col: col, info: info, block: block, tot: tot, h: heights[k] };
      });

      for (var k = Math.min(2, top.length - 1); k >= 1; k--) {
        var C = cols[k];
        UI.sfx.pop();
        await S.anim(C.block, [{ height: '0vh' }, { height: C.h + 'vh' }], { duration: 700, easing: EASE_BOUNCE });
        S.fx(C.info, [{ opacity: 0, transform: 'translateY(-30px)' }, { opacity: 1, transform: 'none' }], { duration: 450 });
        await S.count(C.tot, C.x.total, 700, function (v) { return UI.fmtScore(v) + '점'; });
        await S.wait(600);
      }

      // 스포트라이트가 이리저리 훑다가 가운데에서 멈춤
      UI.sfx.drumroll(2.4);
      st.classList.add('is-dim');
      await S.anim(spot, [
        { opacity: 0, transform: 'translateX(-30vw)' },
        { opacity: 1, transform: 'translateX(28vw)', offset: 0.3 },
        { opacity: 1, transform: 'translateX(-20vw)', offset: 0.6 },
        { opacity: 1, transform: 'translateX(10vw)', offset: 0.82 },
        { opacity: 1, transform: 'translateX(0)' }
      ], { duration: 2400, easing: 'ease-in-out' });
      var W = cols[0];
      UI.sfx.cymbal();
      UI.sfx.fanfare();
      st.classList.remove('is-dim');
      st.classList.add('is-lit');
      await S.anim(W.block, [{ height: '0vh' }, { height: W.h + 'vh' }], { duration: 800, easing: EASE_BOUNCE });
      S.fx(W.info, [{ opacity: 0, transform: 'translateY(-50px) scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 650, easing: EASE_BOUNCE });
      UI.confetti(d.rounds.map(function (r) { return r.hex; }));
      await S.count(W.tot, W.x.total, 1000, function (v) { return UI.fmtScore(v) + '점'; });
      var recap = st.querySelector('.rv-recap');
      if (recap) S.fx(recap, [{ opacity: 0.55 }, { opacity: 0 }], { duration: 400 });
      // 맨 위 제목이 우승자 이름으로 바뀜
      var crown = st.querySelector('.rv-title');
      crown.textContent = (d.teamMode ? '우승 팀 ' : '우승 ') + W.x.name;
      crown.classList.add('is-champ');
      S.fx(crown, [{ opacity: 0, letterSpacing: '0.6em' }, { opacity: 1, letterSpacing: '0.02em' }], { duration: 900 });
      await S.wait(3200);
    }, done);
  }

  /* ================= 휴대폰: 내 순위 공개 ================= */
  /**
   * d = { hex, rank, of, score, title, scoreLabel, none }
   */
  function phone(d, done) {
    return run('rv-phone', async function (S, st) {
      var t = el('p', 'rv-ph-title', d.title || '내 순위는');
      st.appendChild(t);
      S.fx(t, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
      if (d.none) {
        var no = el('p', 'rv-ph-none', '사진 없음');
        st.appendChild(no);
        await S.anim(no, [{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: EASE_BOUNCE });
        await S.wait(1200);
        return;
      }
      // 슬롯머신 릴
      var win = el('div', 'rv-reel');
      var strip = el('div', 'rv-reel-strip');
      var of = Math.max(d.of, d.rank, 3), cycles = 4, items = [];
      for (var c = 0; c < cycles; c++) for (var i = 1; i <= of; i++) items.push(i);
      items.forEach(function (n) { strip.appendChild(el('span', null, n)); });
      win.appendChild(strip);
      win.appendChild(el('span', 'rv-reel-unit', '등'));
      st.appendChild(win);
      var cell = win.clientHeight;
      var stopIndex = (cycles - 1) * of + (d.rank - 1);
      strip.querySelectorAll('span').forEach(function (s) { s.style.height = cell + 'px'; s.style.lineHeight = cell + 'px'; });
      var tick = setInterval(function () { if (!S.dead) UI.sfx.blip(); }, 120);
      try {
        S.fx(strip, [
          { filter: 'blur(0)' }, { filter: 'blur(4px)', offset: 0.12 }, { filter: 'blur(3px)', offset: 0.55 }, { filter: 'blur(0)' }
        ], { duration: 2300, easing: 'linear' });
        await S.anim(strip, [
          { transform: 'translateY(0)' },
          { transform: 'translateY(' + (-stopIndex * cell) + 'px)' }
        ], { duration: 2300, easing: 'cubic-bezier(.08,.6,.12,1)' });
      } finally { clearInterval(tick); }
      if (navigator.vibrate) navigator.vibrate(d.rank === 1 ? [60, 40, 60, 40, 160] : [70]);
      UI.sfx.pop();
      win.classList.add('is-stop');
      S.fx(win, [{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 450, easing: EASE_BOUNCE });
      var sc = el('p', 'rv-ph-score', '0');
      st.appendChild(sc);
      await S.count(sc, d.score, 800, function (v) { return UI.fmtScore(v) + (d.scoreLabel || '점'); });
      if (d.rank === 1) {
        UI.sfx.fanfare();
        UI.confetti([d.hex]);
        var yay = el('p', 'rv-ph-yay', d.yay || '1등!');
        st.appendChild(yay);
        S.fx(yay, [{ opacity: 0, transform: 'scale(.4) rotate(-8deg)' }, { opacity: 1, transform: 'rotate(-4deg)' }], { duration: 600, easing: EASE_BOUNCE });
      }
      await S.wait(1800);
    }, done);
  }

  global.Reveal = { round: roundShow, leaderboard: leaderboard, final: finalShow, phone: phone };
})(window);
