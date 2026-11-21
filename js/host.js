/* host.js — 진행자 화면: 방 열기, 설정, 라운드 진행, 사진 받기, 채점 */
(function (global) {
  'use strict';

  var UI = global.UI, CK = global.ColorKit, $ = UI.$, el = UI.el;
  var GRACE = 2500;            // 시간 끝난 뒤 업로드를 기다려 주는 여유
  var COUNTDOWN = 3000;
  var MAX_PHOTO = 3 * 1024 * 1024;

  var H = {
    net: null, code: null,
    settings: { mode: 'solo', teams: 2, time: 60, rounds: 3, level: 2, colorMode: 'random' },
    phase: 'lobby',
    players: {}, order: [],
    round: 0, target: null, usedColors: [],
    phaseEndsAt: 0, tick: 0,
    subs: {}, roster: {},
    results: [], teamTotals: [0, 0, 0, 0],
    lastResultMsg: null, lastFinalMsg: null
  };

  /* ================= 저장 / 복구 (진행자 새로고침 대비) ================= */
  function save() {
    try {
      localStorage.setItem('ch-host-' + H.code, JSON.stringify({
        code: H.code, settings: H.settings, phase: H.phase === 'final' ? 'final' : 'lobby',
        players: H.order.map(function (pid) {
          var p = H.players[pid];
          return { pid: p.pid, name: p.name, team: p.team, total: p.total, scores: p.scores };
        }),
        round: H.results.length, usedColors: H.usedColors, teamTotals: H.teamTotals,
        results: H.results.map(function (r) {
          return { round: r.round, target: r.target, teams: r.teams, list: r.list.map(function (x) {
            return { pid: x.pid, name: x.name, team: x.team, score: x.score, has: !!x.url };
          }) };
        }),
        savedAt: Date.now()
      }));
    } catch (e) { /* 저장 공간 부족 등: 무시 */ }
  }

  function restore(code) {
    try {
      var s = JSON.parse(localStorage.getItem('ch-host-' + code) || 'null');
      if (!s) return false;
      H.code = s.code; H.settings = s.settings; H.round = s.round; H.usedColors = s.usedColors || [];
      H.teamTotals = s.teamTotals || [0, 0, 0, 0];
      H.players = {}; H.order = [];
      s.players.forEach(function (p) {
        H.players[p.pid] = { pid: p.pid, name: p.name, team: p.team, total: p.total, scores: p.scores || {}, online: false };
        H.order.push(p.pid);
      });
      H.results = (s.results || []).map(function (r) {
        r.list = r.list.map(function (x) { x.url = null; x.thumb = null; return x; });
        return r;
      });
      H.phase = s.phase;
      return true;
    } catch (e) { return false; }
  }

  /* ================= 시작 ================= */
  function create() {
    UI.sfx.unlock();
    $('host-msg').textContent = '방을 여는 중…';
    $('btn-host').disabled = true;
    tryOpen(Net.makeCode(), 0);
  }

  function tryOpen(code, attempt) {
    H.net = new Net.Host({ onHello: onHello, onMessage: onMessage, onLeave: onLeave, onStatus: status });
    H.net.open(code).then(function () {
      H.code = code;
      var q = new URLSearchParams(location.search);
      q.delete('room'); q.set('host', code);
      history.replaceState(null, '', '?' + q.toString());
      enterLobby();
      save();
    }).catch(function (err) {
      if (err && err.type === 'unavailable-id' && attempt < 3) { tryOpen(Net.makeCode(), attempt + 1); return; }
      $('btn-host').disabled = false;
      $('host-msg').textContent = '방을 열지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요. (' + (err && err.type || err) + ')';
      $('host-msg').classList.add('is-error');
    });
  }

  function resume(code) {
    if (!restore(code)) return false;
    UI.show('host-lobby');
    status('방을 다시 여는 중…');
    H.net = new Net.Host({ onHello: onHello, onMessage: onMessage, onLeave: onLeave, onStatus: status });
    H.net.open(code).then(function () {
      status('');
      if (H.phase === 'final') showFinal(true); else enterLobby();
    }).catch(function () {
      status('같은 방 코드로 다시 열지 못했어요. 첫 화면에서 새 게임을 만들어 주세요.');
    });
    return true;
  }

  function status(t) { $('host-status').textContent = t || (H.code ? '방이 열려 있어요' : ''); }

  /* ================= 참가자 관리 ================= */
  function cleanName(n) { return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 10) || '이름없음'; }

  function uniqueName(name, pid) {
    var base = name, k = 2;
    while (H.order.some(function (q) { return q !== pid && H.players[q].name === name; })) name = base + k++;
    return name;
  }

  function teamSizes() {
    var c = [];
    for (var i = 0; i < H.settings.teams; i++) c.push(0);
    H.order.forEach(function (pid) { var t = H.players[pid].team; if (t >= 0 && t < c.length) c[t]++; });
    return c;
  }
  function smallestTeam() {
    var c = teamSizes(), best = 0;
    for (var i = 1; i < c.length; i++) if (c[i] < c[best]) best = i;
    return best;
  }

  function onHello(pid, msg) {
    var p = H.players[pid];
    if (!p) {
      p = { pid: pid, name: uniqueName(cleanName(msg.name), pid), team: -1, total: 0, scores: {}, online: true };
      var want = +msg.team;
      if (H.settings.mode === 'team') p.team = (want >= 0 && want < H.settings.teams) ? want : smallestTeam();
      H.players[pid] = p;
      H.order.push(pid);
      // 진행 중인 라운드에 늦게 들어오면 그 라운드 참가자로
      if (H.phase === 'hunt' || H.phase === 'countdown') H.roster[pid] = true;
    }
    p.online = true;
    H.net.send(pid, { t: 'welcome', pid: pid, name: p.name, code: H.code });
    H.net.send(pid, stateMsg(pid));
    if (H.phase === 'result' && H.lastResultMsg) H.net.send(pid, H.lastResultMsg);
    if (H.phase === 'final' && H.lastFinalMsg) H.net.send(pid, H.lastFinalMsg);
    refresh();
  }

  function onLeave(pid) {
    var p = H.players[pid];
    if (p) p.online = false;
    refresh();
  }

  function onMessage(pid, msg) {
    var p = H.players[pid];
    if (!p) return;
    if (msg.t === 'team') {
      var t = +msg.team;
      if (H.settings.mode === 'team' && t >= 0 && t < H.settings.teams && (H.phase === 'lobby' || H.phase === 'result')) {
        p.team = t; refresh();
      }
    } else if (msg.t === 'photo') {
      onPhoto(pid, msg);
    }
  }

  function removePlayer(pid) {
    H.net.kick(pid);
    delete H.players[pid];
    H.order = H.order.filter(function (q) { return q !== pid; });
    refresh();
  }

  function shuffleTeams() {
    var ids = H.order.slice();
    for (var i = ids.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
    ids.forEach(function (pid, i) { H.players[pid].team = i % H.settings.teams; });
    refresh();
  }

  /* ================= 상태 보내기 ================= */
  function teamList() {
    var c = teamSizes(), out = [];
    for (var i = 0; i < H.settings.teams; i++) out.push({ id: i, name: UI.TEAM_NAMES[i], count: c[i], total: Math.round(H.teamTotals[i] * 10) / 10 });
    return out;
  }

  function stateMsg(pid) {
    var p = H.players[pid] || {};
    return {
      t: 'state', phase: H.phase, code: H.code,
      mode: H.settings.mode, teams: H.settings.mode === 'team' ? teamList() : [],
      round: H.round, rounds: H.settings.rounds, time: H.settings.time,
      target: H.phase === 'lobby' || H.phase === 'final' ? null : H.target,
      remain: Math.max(0, H.phaseEndsAt - Date.now()),
      you: { pid: pid, name: p.name, team: p.team, total: Math.round((p.total || 0) * 10) / 10, submitted: !!H.subs[pid] },
      count: H.order.length
    };
  }

  function broadcastState() { if (H.net) H.net.broadcast(stateMsg); }

  function refresh() {
    renderPlayers();
    if (H.phase === 'hunt' || H.phase === 'countdown') renderCount();
    broadcastState();
    save();
  }

  /* ================= 대기실 화면 ================= */
  function enterLobby() {
    H.phase = 'lobby';
    UI.show('host-lobby');
    status('');
    $('room-code').textContent = H.code;
    var url = location.origin + location.pathname + '?room=' + H.code + Net.passThroughQuery();
    $('join-url').textContent = url.replace(/^https?:\/\//, '');
    $('join-url').dataset.url = url;
    var qr = global.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    syncSettingsForm();
    renderPlayers();
    renderStartButton();
    broadcastState();
    save();
  }

  function syncSettingsForm() {
    var f = $('settings'), s = H.settings;
    ['mode', 'teams', 'time', 'rounds', 'level', 'colorMode'].forEach(function (k) {
      var r = f.querySelector('input[name="' + k + '"][value="' + s[k] + '"]');
      if (r) r.checked = true;
    });
    $('team-count-field').hidden = s.mode !== 'team';
    $('btn-shuffle-teams').hidden = s.mode !== 'team';
    $('pick-row').hidden = s.colorMode !== 'pick';
    // 게임이 시작되면 색 정하기 말고는 잠금 (중간에 규칙이 바뀌면 불공평)
    var locked = H.round > 0;
    f.classList.toggle('is-locked', locked);
    f.querySelectorAll('input').forEach(function (i) { i.disabled = locked && i.name !== 'colorMode'; });
    f.querySelector('input[name="colorMode"]').closest('.seg').style.cssText = locked ? 'opacity:1;pointer-events:auto' : '';
    updatePickName();
  }

  function onSettingsChange(e) {
    var t = e.target;
    if (!t.name) return;
    var v = t.value, s = H.settings;
    if (t.name === 'mode' || t.name === 'colorMode') s[t.name] = v; else s[t.name] = +v;
    if (t.name === 'mode' && v === 'team') {
      // 팀전으로 바꾸면 고르게 나눠 배정
      H.order.forEach(function (pid, i) { H.players[pid].team = i % s.teams; });
    }
    if (t.name === 'teams') {
      H.order.forEach(function (pid) { if (H.players[pid].team >= s.teams) H.players[pid].team = smallestTeam(); });
    }
    syncSettingsForm();
    renderStartButton();
    refresh();
  }

  function updatePickName() { $('pick-name').textContent = CK.nearestName($('pick-color').value); }

  function renderPlayers() {
    if (!$('player-board')) return;
    var board = $('player-board'), team = H.settings.mode === 'team';
    board.textContent = '';
    board.classList.toggle('teams', team);
    $('player-count').textContent = H.order.length;
    $('players-empty').hidden = H.order.length > 0;
    function chip(pid) {
      var p = H.players[pid], c = el('span', 'pchip' + (p.online ? '' : ' is-off'), p.name);
      c.title = p.online ? '접속 중' : '연결 끊김';
      var x = el('button', null, '×');
      x.type = 'button';
      x.setAttribute('aria-label', p.name + ' 내보내기');
      x.addEventListener('click', function () { if (confirm(p.name + ' 님을 내보낼까요?')) removePlayer(pid); });
      c.appendChild(x);
      return c;
    }
    if (!team) { H.order.forEach(function (pid) { board.appendChild(chip(pid)); }); return; }
    var sizes = teamSizes();
    for (var i = 0; i < H.settings.teams; i++) {
      var col = el('div', 'team-col'), h = el('h3', null, UI.TEAM_NAMES[i]);
      h.appendChild(el('small', null, sizes[i] + '명' + (H.round > 0 ? ' · ' + UI.fmtScore(H.teamTotals[i]) + '점' : '')));
      col.appendChild(h);
      H.order.forEach(function (pid) { if (H.players[pid].team === i) col.appendChild(chip(pid)); });
      board.appendChild(col);
    }
  }

  function renderStartButton() {
    var b = $('btn-start-round');
    b.textContent = H.round >= H.settings.rounds ? '최종 결과 발표' : (H.round + 1) + '라운드 시작';
  }

  /* ================= 라운드 진행 ================= */
  function startRound() {
    if (H.round >= H.settings.rounds) { showFinal(); return; }
    if (!H.order.some(function (pid) { return H.players[pid].online; })) {
      status('접속한 참가자가 없어요. QR을 찍어 들어오게 해 주세요.');
      return;
    }
    UI.sfx.unlock();
    keepAwake();
    H.round++;
    if (H.settings.colorMode === 'pick') {
      var hex = $('pick-color').value.toUpperCase();
      H.target = { name: CK.nearestName(hex), hex: hex };
    } else {
      H.target = CK.randomTarget(H.usedColors);
    }
    H.usedColors.push(H.target.name);
    H.subs = {};   // 이전 라운드 사진 주소는 결과·시상대에서 계속 쓰므로 지우지 않음
    H.roster = {};
    H.order.forEach(function (pid) { if (H.players[pid].online) H.roster[pid] = true; });

    UI.setTarget(H.target.hex);
    $('hh-round').textContent = H.round + ' / ' + H.settings.rounds + ' 라운드';
    $('hh-name').textContent = H.target.name;
    $('hh-hex').textContent = H.target.hex;
    $('hh-feed').textContent = '';
    $('btn-end-now').hidden = false;
    UI.show('host-hunt');

    H.phase = 'countdown';
    H.phaseEndsAt = Date.now() + COUNTDOWN;
    renderCount();
    broadcastState();
    runClock();
  }

  function runClock() {
    clearInterval(H.tick);
    var lastSec = null;
    H.tick = setInterval(function () {
      var left = H.phaseEndsAt - Date.now(), sec = Math.max(0, Math.ceil(left / 1000));
      var timer = $('hh-timer');
      if (H.phase === 'countdown') {
        timer.textContent = sec;
        timer.classList.remove('is-low');
        if (sec !== lastSec && sec > 0) UI.sfx.tick();
        if (left <= 0) {
          H.phase = 'hunt';
          H.phaseEndsAt = Date.now() + H.settings.time * 1000;
          UI.sfx.go();
          broadcastState();
        }
      } else if (H.phase === 'hunt') {
        timer.textContent = sec;
        timer.classList.toggle('is-low', sec <= 10);
        if (sec !== lastSec && sec <= 5 && sec > 0) UI.sfx.low();
        if (left <= 0) endHunt();
      }
      lastSec = sec;
    }, 100);
  }

  function endHunt() {
    if (H.phase !== 'hunt' && H.phase !== 'countdown') return;
    clearInterval(H.tick);
    H.phase = 'judging';
    H.phaseEndsAt = Date.now();
    UI.sfx.end();
    $('hh-timer').textContent = '끝!';
    $('hh-timer').classList.remove('is-low');
    $('btn-end-now').hidden = true;
    broadcastState();
    setTimeout(judge, GRACE);
  }

  function renderCount() {
    var n = Object.keys(H.subs).length, total = Object.keys(H.roster).length;
    $('hh-count').textContent = n + ' / ' + total + '명 제출';
  }

  function onPhoto(pid, msg) {
    var late = !(H.phase === 'hunt' || (H.phase === 'judging' && Date.now() - H.phaseEndsAt <= GRACE));
    if (late || msg.round !== H.round) { H.net.send(pid, { t: 'late', round: msg.round }); return; }
    var data = msg.jpeg;
    if (!data || !(data.byteLength > 0) || data.byteLength > MAX_PHOTO) return;
    var old = H.subs[pid];
    if (old && old.url) URL.revokeObjectURL(old.url);
    var blob = new Blob([data], { type: 'image/jpeg' });
    var first = !old;
    H.subs[pid] = { blob: blob, url: URL.createObjectURL(blob) };
    H.roster[pid] = true;
    H.net.send(pid, { t: 'got', round: H.round });
    // 방금 올라온 사진을 큰 화면 아래에 띄움
    var feed = $('hh-feed'), img = el('img');
    img.src = H.subs[pid].url; img.alt = H.players[pid].name;
    feed.insertBefore(img, feed.firstChild);
    while (feed.children.length > 14) feed.removeChild(feed.lastChild);
    renderCount();
    if (first) {
      // 모두 냈으면 기다릴 것 없이 바로 끝냄
      var everyone = Object.keys(H.roster).every(function (q) { return H.subs[q] || !H.players[q] || !H.players[q].online; });
      if (everyone && H.phase === 'hunt' && Object.keys(H.subs).length >= 2) {
        status('모두 사진을 냈어요');
      }
    }
  }

  function makeThumb(blob) {
    return CK.loadImage(blob).then(function (img) {
      return CK.toJpeg(img, img.width, img.height, 320, 0.72).then(function (b) {
        if (img.close) img.close();
        return b.arrayBuffer();
      });
    });
  }

  function judge() {
    var target = H.target, level = H.settings.level;
    var pids = Object.keys(H.roster).filter(function (pid) { return H.players[pid]; });
    var jobs = pids.map(function (pid) {
      var p = H.players[pid], sub = H.subs[pid];
      var base = { pid: pid, name: p.name, team: p.team };
      if (!sub) return Promise.resolve(Object.assign(base, { score: 0, url: null, thumb: null }));
      return Promise.all([CK.scorePhoto(sub.blob, target.hex, level), makeThumb(sub.blob)]).then(function (r) {
        return Object.assign(base, r[0], { url: sub.url, thumb: r[1] });
      }).catch(function () { return Object.assign(base, { score: 0, url: sub.url, thumb: null, bad: true }); });
    });
    Promise.all(jobs).then(function (list) {
      list.forEach(function (x) {
        var p = H.players[x.pid];
        p.total = Math.round((p.total + x.score) * 10) / 10;
        p.scores[H.round] = x.score;
      });
      var ranked = UI.rankBy(list, 'score');

      var teams = [];
      if (H.settings.mode === 'team') {
        for (var i = 0; i < H.settings.teams; i++) {
          var mem = list.filter(function (x) { return x.team === i; });
          var avg = mem.length ? mem.reduce(function (s, x) { return s + x.score; }, 0) / mem.length : 0;
          avg = Math.round(avg * 10) / 10;
          H.teamTotals[i] = Math.round((H.teamTotals[i] + avg) * 10) / 10;
          teams.push({ id: i, name: UI.TEAM_NAMES[i], score: avg, total: H.teamTotals[i], members: mem.length });
        }
        teams = UI.rankBy(teams, 'score');
      }

      H.results.push({ round: H.round, target: target, list: ranked, teams: teams });
      H.phase = 'result';
      H.lastResultMsg = {
        t: 'result', round: H.round, rounds: H.settings.rounds, target: target, mode: H.settings.mode,
        teams: teams,
        list: ranked.map(function (x) {
          return { pid: x.pid, name: x.name, team: x.team, score: x.score, rank: x.rank, dE: x.dE,
            x: x.x, y: x.y, size: x.size, aspect: x.aspect, rgb: x.rgb, thumb: x.thumb };
        })
      };
      H.net.broadcast(H.lastResultMsg);
      broadcastState();
      showResult(H.results[H.results.length - 1]);
      status('');
      save();
    });
  }

  /* ================= 결과 화면 ================= */
  function showResult(r) {
    UI.show('host-result');
    $('hr-title').textContent = r.round + '라운드 결과';
    var tp = $('hr-target');
    tp.textContent = '';
    tp.appendChild(UI.swatchCard(r.target.hex, '찾을 색', r.target.name + ' ' + r.target.hex));

    // 팀 순위
    var tr = $('hr-teams');
    tr.hidden = !r.teams.length;
    tr.textContent = '';
    r.teams.forEach(function (t) {
      var row = el('div', 'team-row');
      row.appendChild(el('span', 'tr-rank', t.rank + '등'));
      row.appendChild(el('span', 'tr-name', t.name));
      var bar = el('span', 'tr-bar'), fill = el('i');
      bar.appendChild(fill); row.appendChild(bar);
      row.appendChild(el('span', 'tr-score', UI.fmtScore(t.score)));
      row.title = '누적 ' + UI.fmtScore(t.total) + '점';
      tr.appendChild(row);
      requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = t.score + '%'; }); });
    });

    var grid = $('hr-grid');
    grid.textContent = '';
    var shots = r.list.filter(function (x) { return x.url; });
    var n = shots.length;
    shots.forEach(function (x, i) {
      var li = el('li', 'shot-card reveal' + (x.rank === 1 ? ' is-first' : ''));
      // 꼴찌부터 1등 순서로 나타나게
      li.style.animationDelay = ((n - 1 - i) * 0.18) + 's';
      li.appendChild(UI.shotFigure(x.url, x));
      var chips = el('div', 'shot-chips'), a = el('i'), b = el('i');
      a.style.background = r.target.hex;
      b.style.background = x.rgb ? CK.rgbToHex(x.rgb) : '#ccc';
      a.title = '찾을 색'; b.title = '찾은 색';
      chips.appendChild(a); chips.appendChild(b);
      li.appendChild(chips);
      var meta = el('div', 'shot-meta');
      meta.appendChild(el('span', 'shot-rank', x.rank));
      var who = el('div', 'shot-who');
      who.appendChild(el('b', null, x.name));
      if (H.settings.mode === 'team' && x.team >= 0) who.appendChild(el('small', null, UI.TEAM_NAMES[x.team]));
      meta.appendChild(who);
      var sc = el('span', 'shot-score', UI.fmtScore(x.score));
      sc.appendChild(el('small', null, '점'));
      meta.appendChild(sc);
      li.appendChild(meta);
      grid.appendChild(li);
    });
    var missing = r.list.filter(function (x) { return !x.url; }).map(function (x) { return x.name; });
    $('hr-missing').textContent = missing.length ? '사진을 못 낸 사람 (0점): ' + missing.join(', ') : '';
    $('hr-missing').hidden = !missing.length;

    var last = H.round >= H.settings.rounds;
    $('btn-next-round').textContent = last ? '최종 결과 발표' : '다음 라운드';
    setTimeout(function () { UI.sfx.fanfare(); }, Math.min(3000, n * 180));
  }

  /* ================= 최종 ================= */
  function showFinal(silent) {
    H.phase = 'final';
    UI.show('host-final');
    var team = H.settings.mode === 'team';
    var people = UI.rankBy(H.order.map(function (pid) {
      var p = H.players[pid];
      return { pid: pid, name: p.name, team: p.team, total: p.total, scores: p.scores };
    }), 'total');

    var teams = [];
    if (team) {
      for (var i = 0; i < H.settings.teams; i++) teams.push({ id: i, name: UI.TEAM_NAMES[i], total: H.teamTotals[i] });
      teams = UI.rankBy(teams, 'total');
    }
    var top = team ? teams : people;
    var winners = top.filter(function (x) { return x.rank === 1; });
    $('hf-label').textContent = (team ? '우승 팀' : '최종 1등') + (winners.length > 1 ? ' (공동)' : '');
    $('hf-name').textContent = winners.map(function (x) { return x.name; }).join(', ') || '-';
    $('hf-score').textContent = winners.length ? UI.fmtScore(winners[0].total) + '점' : '';

    // 시상대: 개인 3등까지, 각자 가장 잘 나온 사진과 함께
    var pod = $('hf-podium');
    pod.textContent = '';
    var best = function (pid) {
      var b = null;
      H.results.forEach(function (r) { r.list.forEach(function (x) { if (x.pid === pid && x.url && (!b || x.score > b.score)) b = x; }); });
      return b;
    };
    [1, 0, 2].forEach(function (k) {
      var x = people[k];
      if (!x) return;
      var col = el('div', 'col p' + Math.min(3, x.rank));
      var b = best(x.pid);
      if (b) { var im = el('img', 'thumb'); im.src = b.url; im.alt = ''; col.appendChild(im); }
      col.appendChild(el('div', 'who', x.name));
      col.appendChild(el('div', 'pts', UI.fmtScore(x.total) + '점'));
      col.appendChild(el('div', 'block', x.rank));
      pod.appendChild(col);
    });

    // 표: 라운드별 점수
    var rounds = H.results.map(function (r) { return r.round; });
    var thead = $('hf-thead'), tbody = $('hf-body');
    thead.textContent = ''; tbody.textContent = '';
    var hr = el('tr');
    ['순위', '이름'].concat(team ? ['팀'] : []).concat(rounds.map(function (n) { return n + 'R'; })).concat(['합계']).forEach(function (t, i) { hr.appendChild(el('th', team && i === 2 ? 'tl' : null, t)); });
    thead.appendChild(hr);
    people.forEach(function (x) {
      var tr = el('tr');
      tr.appendChild(el('td', null, x.rank));
      tr.appendChild(el('td', null, x.name));
      if (team) tr.appendChild(el('td', 'tl', x.team >= 0 ? UI.TEAM_NAMES[x.team] : '-'));
      rounds.forEach(function (n) { tr.appendChild(el('td', null, x.scores[n] != null ? UI.fmtScore(x.scores[n]) : '-')); });
      tr.appendChild(el('td', 'total', UI.fmtScore(x.total)));
      tbody.appendChild(tr);
    });
    $('hf-table-title').textContent = team ? '개인 순위 (팀 점수는 라운드마다 팀원 평균의 합)' : '전체 순위';

    H.lastFinalMsg = {
      t: 'final', mode: H.settings.mode,
      teams: teams.map(function (t) { return { id: t.id, name: t.name, total: t.total, rank: t.rank }; }),
      list: people.map(function (x) { return { pid: x.pid, name: x.name, team: x.team, total: x.total, rank: x.rank }; })
    };
    if (H.net) { H.net.broadcast(H.lastFinalMsg); broadcastState(); }
    save();
    if (!silent) { UI.sfx.fanfare(); UI.confetti(H.results.map(function (r) { return r.target.hex; })); }
  }

  function newGame() {
    H.results.forEach(function (r) { r.list.forEach(function (x) { if (x.url) URL.revokeObjectURL(x.url); }); });
    H.round = 0; H.results = []; H.usedColors = []; H.teamTotals = [0, 0, 0, 0];
    H.subs = {}; H.roster = {}; H.target = null; H.lastResultMsg = null; H.lastFinalMsg = null;
    H.order.forEach(function (pid) { H.players[pid].total = 0; H.players[pid].scores = {}; });
    enterLobby();
  }

  /* ================= 화면 꺼짐 방지 ================= */
  var lock = null;
  function keepAwake() {
    try {
      if (navigator.wakeLock && !lock) navigator.wakeLock.request('screen').then(function (l) {
        lock = l; l.addEventListener('release', function () { lock = null; });
      }).catch(function () {});
    } catch (e) { /* 지원 안 함 */ }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && H.round > 0) keepAwake(); });

  /* ================= 버튼 연결 ================= */
  function bind() {
    $('btn-host').addEventListener('click', create);
    $('settings').addEventListener('change', onSettingsChange);
    $('pick-color').addEventListener('input', updatePickName);
    $('btn-shuffle-teams').addEventListener('click', shuffleTeams);
    $('btn-start-round').addEventListener('click', startRound);
    $('btn-end-now').addEventListener('click', function () {
      if (H.phase === 'hunt' || H.phase === 'countdown') { H.phase = 'hunt'; endHunt(); }
    });
    $('btn-next-round').addEventListener('click', function () {
      if (H.round >= H.settings.rounds) showFinal(); else startRound();
    });
    $('btn-to-lobby').addEventListener('click', enterLobby);
    $('btn-new-game').addEventListener('click', newGame);
    $('btn-copy').addEventListener('click', function () {
      var u = $('join-url').dataset.url;
      if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { $('btn-copy').textContent = '복사했어요'; });
    });
    global.addEventListener('beforeunload', function (e) {
      if (H.code && H.phase !== 'lobby' && H.phase !== 'final') { e.preventDefault(); e.returnValue = ''; }
    });
  }

  global.Host = { bind: bind, resume: resume, _state: H };
})(window);
