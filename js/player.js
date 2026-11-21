/* player.js — 참가자 휴대폰: 입장, 팀 고르기, 카메라, 사진 보내기, 결과 보기 */
(function (global) {
  'use strict';

  var UI = global.UI, CK = global.ColorKit, $ = UI.$, el = UI.el;

  var P = {
    net: null, code: null, pid: null, name: null,
    s: null,               // 진행자가 보낸 최신 상태
    stream: null,
    deadline: 0, timer: 0,
    sending: null,         // 보내는 중이거나 못 보낸 사진 { round, buf, url }
    sentRound: 0,
    results: {}, final: null, thumbs: []
  };

  function myPid() {
    var id = null;
    try { id = localStorage.getItem('ch-pid'); } catch (e) { /* 무시 */ }
    if (!id) {
      id = Net.uid();
      try { localStorage.setItem('ch-pid', id); } catch (e) { /* 무시 */ }
    }
    return id;
  }

  /* ================= 입장 ================= */
  function join(code, name) {
    UI.sfx.unlock();
    P.code = code; P.name = name; P.pid = myPid();
    try { localStorage.setItem('ch-last', JSON.stringify({ code: code, name: name })); } catch (e) { /* 무시 */ }
    var q = new URLSearchParams(location.search);
    q.delete('host'); q.set('room', code);
    history.replaceState(null, '', '?' + q.toString());
    $('join-msg').textContent = '방에 연결하는 중…';
    $('join-msg').classList.remove('is-error');
    P.net = new Net.Client({ onMessage: onMessage, onStatus: onStatus });
    P.net.connect(code, { t: 'hello', pid: P.pid, name: name });
  }

  function onStatus(st) {
    if (st === 'online') {
      UI.netbar('');
      // 끊겼을 때 못 보낸 사진이 있으면 다시 보냄
      if (P.sending && P.s && P.s.round === P.sending.round) sendPhoto();
    } else if (st === 'connecting') {
      if (P.s) UI.netbar('다시 연결하는 중…');
    } else if (st === 'lost') {
      UI.netbar(P.s ? '연결이 끊겼어요. 다시 잇는 중…' : '방에 연결하는 중…');
    } else if (st === 'noroom') {
      UI.netbar('');
      backHome('방을 찾지 못했어요. 코드를 확인하거나, 진행자 화면이 열려 있는지 확인해 주세요.');
    }
  }

  function backHome(msg) {
    if (P.net) P.net.close();
    P.net = null; P.s = null;
    stopCamera();
    clearInterval(P.timer);
    try { localStorage.removeItem('ch-last'); } catch (e) { /* 무시 */ }
    UI.show('home');
    $('join-msg').textContent = msg || '';
    $('join-msg').classList.toggle('is-error', !!msg);
  }

  /* ================= 받은 메시지 ================= */
  function onMessage(m) {
    if (m.t === 'welcome') { P.name = m.name; return; }
    if (m.t === 'state') { apply(m); return; }
    if (m.t === 'got') {
      if (P.sending && P.sending.round === m.round) { P.sentRound = m.round; P.sending = null; }
      setSent('보냈어요! 다시 찍으면 바뀌어요');
      return;
    }
    if (m.t === 'late') { P.sending = null; setSent('시간이 끝나서 못 보냈어요.'); return; }
    if (m.t === 'result') {
      P.results[m.round] = m;
      if (P.s && P.s.phase === 'result' && P.s.round === m.round) renderResult(m);
      return;
    }
    if (m.t === 'final') {
      P.final = m;
      if (P.s && P.s.phase === 'final') renderFinal(m);
      return;
    }
    if (m.t === 'kicked') backHome('진행자가 방에서 내보냈어요.');
  }

  function apply(s) {
    var prev = P.s;
    P.s = s;
    if (s.you && s.you.name) P.name = s.you.name;
    if (s.target) UI.setTarget(s.target.hex);
    var phase = s.phase;

    if (phase === 'lobby') {
      stopHunt();
      renderLobby(s);
      UI.show('p-lobby');
    } else if (phase === 'countdown' || phase === 'hunt') {
      enterHunt(s, !prev || prev.phase !== phase || prev.round !== s.round);
    } else if (phase === 'judging') {
      stopHunt();
      $('pw-title').textContent = '채점하는 중';
      $('pw-sub').textContent = P.sentRound === s.round || s.you.submitted ? '사진이 잘 들어갔어요. 큰 화면을 봐 주세요.' : '이번 라운드는 사진을 못 냈어요.';
      UI.show('p-wait');
    } else if (phase === 'result') {
      stopHunt();
      if (P.results[s.round]) renderResult(P.results[s.round]);
      else { $('pw-title').textContent = '결과를 받는 중'; $('pw-sub').textContent = ''; UI.show('p-wait'); }
    } else if (phase === 'final') {
      stopHunt();
      if (P.final) renderFinal(P.final);
      else { $('pw-title').textContent = '최종 결과를 받는 중'; $('pw-sub').textContent = ''; UI.show('p-wait'); }
    }
  }

  /* ================= 대기실 ================= */
  function renderLobby(s) {
    $('pl-code').textContent = s.code;
    $('pl-name').textContent = P.name;
    $('pl-sub').textContent = s.round > 0
      ? (s.round >= s.rounds ? '모든 라운드가 끝났어요. 진행자가 최종 결과를 발표할 거예요.' : (s.round + 1) + '라운드를 기다리는 중이에요.')
      : '진행자가 시작하면 바로 색이 나와요. 지금 ' + s.count + '명이 들어와 있어요.';
    var team = s.mode === 'team';
    $('pl-teams').hidden = !team;
    if (team) {
      var box = $('pl-team-buttons');
      box.textContent = '';
      s.teams.forEach(function (t) {
        var b = el('button', null, t.name);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(s.you.team === t.id));
        b.appendChild(el('small', null, t.count + '명' + (s.round > 0 ? ', ' + UI.fmtScore(t.total) + '점' : '')));
        b.addEventListener('click', function () { P.net.send({ t: 'team', team: t.id }); });
        box.appendChild(b);
      });
    }
    $('pl-last').hidden = !(s.round > 0);
    $('pl-total').textContent = UI.fmtScore(s.you.total || 0);
  }

  /* ================= 카메라 ================= */
  function startCamera() {
    if (P.stream && P.stream.active) return Promise.resolve(P.stream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('이 브라우저는 카메라를 바로 쓸 수 없어요. 오른쪽 아래 "기본 카메라로"를 눌러 찍어 주세요.'));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }
    }).then(function (s) { P.stream = s; return s; });
  }
  function stopCamera() {
    if (P.stream) P.stream.getTracks().forEach(function (t) { t.stop(); });
    P.stream = null;
    ['ph-video', 'pl-preview'].forEach(function (id) { var v = $(id); if (v) v.srcObject = null; });
    $('pl-preview').hidden = true;
  }
  function camErrorText(err) {
    if (err && err.name === 'NotAllowedError') return '카메라 권한이 막혀 있어요. 주소창의 자물쇠(또는 aA) 메뉴에서 카메라를 허용하거나, "기본 카메라로"를 눌러 찍어 주세요.';
    if (err && err.name === 'NotFoundError') return '카메라를 찾지 못했어요. "기본 카메라로"를 눌러 사진을 골라 주세요.';
    return (err && err.message) || '카메라를 켜지 못했어요. "기본 카메라로"를 눌러 찍어 주세요.';
  }

  /* ================= 사냥 ================= */
  function enterHunt(s, fresh) {
    UI.show('p-hunt');
    $('ph-name').textContent = s.target.name;
    $('ph-hex').textContent = s.target.hex;
    if (P.sending && P.sending.round !== s.round) P.sending = null;
    if (fresh && P.sentRound !== s.round && !P.sending) {
      $('ph-sent').hidden = true;
      $('ph-hint').hidden = false;
    }
    if (s.you.submitted && P.sentRound === s.round) setSent('보냈어요! 다시 찍으면 바뀌어요');
    $('ph-error').hidden = true;
    $('btn-shutter').disabled = s.phase !== 'hunt';
    $('ph-count').hidden = s.phase !== 'countdown';
    P.deadline = performance.now() + s.remain;
    var v = $('ph-video');
    startCamera().then(function (stream) {
      if (v.srcObject !== stream) { v.srcObject = stream; v.play().catch(function () {}); }
    }).catch(function (err) {
      $('ph-error').textContent = camErrorText(err);
      $('ph-error').hidden = false;
    });
    keepAwake();
    clearInterval(P.timer);
    var last = null;
    P.timer = setInterval(function () {
      var left = P.deadline - performance.now(), sec = Math.max(0, Math.ceil(left / 1000));
      if (P.s.phase === 'countdown') {
        $('ph-count').textContent = sec || '시작';
        if (sec !== last && sec > 0) UI.sfx.tick();
      } else {
        $('ph-timer').textContent = sec;
        $('ph-timer').classList.toggle('is-low', sec <= 10);
        if (sec !== last && sec <= 5 && sec > 0 && navigator.vibrate) navigator.vibrate(60);
      }
      last = sec;
    }, 100);
    if (s.phase === 'hunt') { $('ph-timer').textContent = Math.ceil(s.remain / 1000); if (fresh) UI.sfx.go(); }
    else $('ph-timer').textContent = s.time;
  }

  function stopHunt() {
    clearInterval(P.timer);
    if (document.body.dataset.view === 'p-hunt') stopCamera();
  }

  function setSent(text) {
    $('ph-sent').hidden = false;
    $('ph-sent-text').textContent = text;
  }

  function shoot() {
    var v = $('ph-video');
    if (!v.videoWidth || !P.s || P.s.phase !== 'hunt') return;
    UI.sfx.shutter();
    var f = el('div', 'flash');
    $('ph-hint').hidden = true;
    v.parentNode.appendChild(f);
    setTimeout(function () { f.remove(); }, 400);
    CK.toJpeg(v, v.videoWidth, v.videoHeight, 800, 0.82).then(queuePhoto);
  }

  function fromFile(file) {
    if (!file || !P.s || (P.s.phase !== 'hunt' && P.s.phase !== 'judging')) return;
    CK.loadImage(file).then(function (img) {
      return CK.toJpeg(img, img.width, img.height, 800, 0.82).then(function (b) { if (img.close) img.close(); return b; });
    }).then(queuePhoto).catch(function () { setSent('사진을 읽지 못했어요. 다시 찍어 주세요.'); });
  }

  function queuePhoto(blob) {
    if (!blob) return;
    blob.arrayBuffer().then(function (buf) {
      if (P.sending && P.sending.url) URL.revokeObjectURL(P.sending.url);
      var url = URL.createObjectURL(blob);
      P.sending = { round: P.s.round, buf: buf, url: url };
      $('ph-thumb').src = url;
      sendPhoto();
    });
  }

  function sendPhoto() {
    var x = P.sending;
    if (!x) return;
    var ok = P.net && P.net.send({ t: 'photo', round: x.round, jpeg: x.buf });
    setSent(ok ? '보내는 중…' : '연결이 끊겨 기다리는 중… 다시 이어지면 자동으로 보내요.');
  }

  /* ================= 결과 ================= */
  function thumbUrl(item) {
    if (!item.thumb) return null;
    if (!item._url) { item._url = UI.bufToUrl(item.thumb); P.thumbs.push(item._url); }
    return item._url;
  }

  function renderResult(r) {
    UI.show('p-result');
    UI.setTarget(r.target.hex);
    var mine = r.list.filter(function (x) { return x.pid === P.pid; })[0];
    var tp = $('pr-target');
    tp.textContent = '';
    tp.appendChild(UI.swatchCard(r.target.hex, '찾을 색', r.target.name));
    if (mine && mine.rgb) tp.appendChild(UI.swatchCard(CK.rgbToHex(mine.rgb), '내가 찾은 색', CK.rgbToHex(mine.rgb)));

    $('pr-rank').textContent = mine ? (mine.thumb || mine.score > 0 ? mine.rank + '등' : '사진 없음') : '관전';
    $('pr-score').textContent = mine ? UI.fmtScore(mine.score) : '-';
    UI.shotFigure(mine ? thumbUrl(mine) : null, mine, $('pr-shot'));

    var tr = $('pr-teams');
    tr.hidden = !(r.teams && r.teams.length);
    tr.textContent = '';
    (r.teams || []).forEach(function (t) {
      var row = el('div', 'team-row');
      row.appendChild(el('span', 'tr-rank', t.rank + '등'));
      row.appendChild(el('span', 'tr-name', t.name));
      var bar = el('span', 'tr-bar'), fill = el('i');
      fill.style.width = t.score + '%';
      bar.appendChild(fill); row.appendChild(bar);
      row.appendChild(el('span', 'tr-score', UI.fmtScore(t.score)));
      tr.appendChild(row);
    });

    var ol = $('pr-list');
    ol.textContent = '';
    r.list.forEach(function (x) {
      var li = el('li', x.pid === P.pid ? 'is-me' : '');
      li.appendChild(el('span', 'r', x.rank));
      var u = thumbUrl(x);
      if (u) { var im = el('img'); im.src = u; im.alt = ''; li.appendChild(im); } else li.appendChild(el('span', 'noimg'));
      var n = el('span', 'n', x.name);
      if (r.mode === 'team' && x.team >= 0) n.appendChild(el('small', null, UI.TEAM_NAMES[x.team]));
      li.appendChild(n);
      li.appendChild(el('span', 's', UI.fmtScore(x.score)));
      ol.appendChild(li);
    });
    if (mine && mine.rank === 1 && mine.score > 0) { UI.sfx.fanfare(); UI.confetti([r.target.hex]); }
  }

  function renderFinal(f) {
    UI.show('p-final');
    var team = f.mode === 'team';
    var top = team ? f.teams : f.list;
    var winners = top.filter(function (x) { return x.rank === 1; });
    $('pf-label').textContent = team ? '우승 팀' : '최종 1등';
    $('pf-winner').textContent = winners.map(function (x) { return x.name; }).join(', ');
    var me = f.list.filter(function (x) { return x.pid === P.pid; })[0];
    var mine = $('pf-mine');
    mine.textContent = '';
    if (me) {
      mine.appendChild(document.createTextNode('나는 '));
      mine.appendChild(el('b', null, me.rank + '등'));
      mine.appendChild(document.createTextNode(', 합계 ' + UI.fmtScore(me.total) + '점'));
      if (team && me.team >= 0) {
        var myTeam = f.teams.filter(function (t) { return t.id === me.team; })[0];
        if (myTeam) mine.appendChild(document.createTextNode(' / ' + myTeam.name + ' ' + myTeam.rank + '등'));
      }
    }
    var ol = $('pf-list');
    ol.textContent = '';
    ol.classList.add('no-img');
    (team ? f.teams : f.list).forEach(function (x) {
      var li = el('li', (!team && x.pid === P.pid) || (team && me && x.id === me.team) ? 'is-me' : '');
      li.appendChild(el('span', 'r', x.rank));
      li.appendChild(el('span', 'n', x.name));
      li.appendChild(el('span', 's', UI.fmtScore(x.total)));
      ol.appendChild(li);
    });
    if (me && ((team && winners.some(function (w) { return w.id === me.team; })) || (!team && me.rank === 1))) {
      UI.sfx.fanfare(); UI.confetti();
    }
  }

  /* ================= 기타 ================= */
  var lock = null;
  function keepAwake() {
    try {
      if (navigator.wakeLock && !lock) navigator.wakeLock.request('screen').then(function (l) {
        lock = l; l.addEventListener('release', function () { lock = null; });
      }).catch(function () {});
    } catch (e) { /* 지원 안 함 */ }
  }

  function bind() {
    $('btn-shutter').addEventListener('click', shoot);
    $('ph-file').addEventListener('change', function (e) {
      fromFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
    $('btn-cam-test').addEventListener('click', function () {
      var v = $('pl-preview'), btn = this;
      if (P.stream) { stopCamera(); btn.textContent = '카메라 켜 보기'; $('pl-cam-msg').textContent = ''; return; }
      startCamera().then(function (stream) {
        v.hidden = false; v.srcObject = stream; v.play().catch(function () {});
        btn.textContent = '카메라 끄기';
        $('pl-cam-msg').textContent = '잘 보이면 준비 끝! 시작하면 자동으로 켜져요.';
      }).catch(function (err) { $('pl-cam-msg').textContent = camErrorText(err); });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && P.s && (P.s.phase === 'hunt' || P.s.phase === 'countdown')) {
        keepAwake();
        // 다른 앱(기본 카메라)에 다녀오면 영상이 멈춰 있을 수 있음
        var v = $('ph-video');
        if (P.stream && !P.stream.active) { P.stream = null; enterHunt(P.s, false); }
        else if (v.paused) v.play().catch(function () {});
      }
    });
  }

  global.Player = { bind: bind, join: join, _state: P };
})(window);
