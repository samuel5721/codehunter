/*
 * net.js — 실시간 연결 (WebRTC, PeerJS)
 *
 * 진행자 화면이 '방'이 되어 모든 참가자와 직접 연결됩니다. 별도 서버가 필요 없고,
 * 처음 연결을 이어 주는 일만 PeerJS 공개 중계 서버(0.peerjs.com)가 합니다.
 *
 * 직접 띄운 PeerJS 서버를 쓰려면 주소 뒤에 붙이면 됩니다:
 *   ?peerhost=my.server.com&peerport=443&peerpath=/myapp&peersecure=1
 */
(function (global) {
  'use strict';

  var PREFIX = 'colorhunt-v1-';
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

  function params() { return new URLSearchParams(location.search); }

  function peerOptions() {
    var q = params(), o = { debug: 0 };
    if (q.get('peerhost')) {
      o.host = q.get('peerhost');
      o.port = +(q.get('peerport') || 443);
      o.path = q.get('peerpath') || '/';
      o.secure = q.get('peersecure') !== '0';
    }
    return o;
  }

  // 진행자 화면 주소에 붙은 서버 설정을 참가 링크에도 그대로 넘김
  function passThroughQuery() {
    var q = params(), keep = new URLSearchParams();
    ['peerhost', 'peerport', 'peerpath', 'peersecure'].forEach(function (k) { if (q.get(k)) keep.set(k, q.get(k)); });
    var s = keep.toString();
    return s ? '&' + s : '';
  }

  function makeCode() {
    var s = '';
    var buf = new Uint32Array(4);
    (global.crypto || global.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 4; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length];
    return s;
  }
  function cleanCode(s) { return (s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); }

  function uid() {
    var b = new Uint8Array(8);
    (global.crypto || global.msCrypto).getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  /* ================= 진행자 ================= */
  /**
   * h = { onHello(pid, msg), onMessage(pid, msg), onLeave(pid), onStatus(text) }
   */
  function Host(h) {
    this.h = h;
    this.peer = null;
    this.conns = {};     // pid → conn
    this.seen = {};      // pid → 마지막 응답 시각
    this.timer = 0;
  }

  // 방 열기. 같은 코드가 아직 서버에 남아 있으면(새로고침 직후) 잠시 기다렸다 다시 시도
  Host.prototype.open = function (code, tries) {
    var self = this;
    tries = tries || 0;
    return new Promise(function (resolve, reject) {
      var peer = new Peer(PREFIX + code, peerOptions());
      var settled = false;
      peer.on('open', function () {
        settled = true;
        self.peer = peer;
        self._listen();
        resolve(code);
      });
      peer.on('error', function (err) {
        if (settled) {
          if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') self.h.onStatus('중계 서버와 연결이 끊겼어요. 다시 잇는 중…');
          return;
        }
        settled = true;
        peer.destroy();
        if (err.type === 'unavailable-id' && tries < 12) {
          self.h.onStatus('방을 다시 여는 중… (' + (tries + 1) + ')');
          setTimeout(function () { self.open(code, tries + 1).then(resolve, reject); }, 2500);
        } else reject(err);
      });
    });
  };

  Host.prototype._listen = function () {
    var self = this, peer = this.peer;
    peer.on('connection', function (conn) {
      var pid = null;
      conn.on('data', function (msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'hello') {
          pid = String(msg.pid || '').slice(0, 32);
          if (!pid) return;
          var old = self.conns[pid];
          if (old && old !== conn) { try { old.close(); } catch (e) { /* 이미 닫힘 */ } }
          self.conns[pid] = conn;
          self.seen[pid] = Date.now();
          self.h.onHello(pid, msg);
          return;
        }
        if (!pid || self.conns[pid] !== conn) return;
        self.seen[pid] = Date.now();
        if (msg.t === 'pong') return;
        self.h.onMessage(pid, msg);
      });
      conn.on('close', function () {
        if (pid && self.conns[pid] === conn) { delete self.conns[pid]; self.h.onLeave(pid); }
      });
      conn.on('error', function () { /* close에서 처리 */ });
    });
    peer.on('disconnected', function () {
      // 중계 서버와만 끊긴 것: 이미 이어진 참가자는 그대로, 새 참가자를 받으려면 다시 연결
      self.h.onStatus('중계 서버와 연결이 끊겼어요. 다시 잇는 중…');
      setTimeout(function () { if (!peer.destroyed) peer.reconnect(); }, 1500);
    });
    peer.on('open', function () { self.h.onStatus(''); });

    // 생존 확인: 4초마다 확인, 14초 동안 응답 없으면 나간 것으로
    this.timer = setInterval(function () {
      var now = Date.now();
      Object.keys(self.conns).forEach(function (pid) {
        var c = self.conns[pid];
        if (now - (self.seen[pid] || 0) > 14000) {
          delete self.conns[pid];
          try { c.close(); } catch (e) { /* 무시 */ }
          self.h.onLeave(pid);
        } else self._send(c, { t: 'ping' });
      });
    }, 4000);
  };

  Host.prototype._send = function (conn, msg) {
    try { if (conn && conn.open) conn.send(msg); } catch (e) { /* 끊긴 연결 */ }
  };
  Host.prototype.send = function (pid, msg) { this._send(this.conns[pid], msg); };
  Host.prototype.broadcast = function (msgFor) {
    var self = this;
    Object.keys(this.conns).forEach(function (pid) {
      var m = typeof msgFor === 'function' ? msgFor(pid) : msgFor;
      if (m) self._send(self.conns[pid], m);
    });
  };
  Host.prototype.isOnline = function (pid) { return !!this.conns[pid]; };
  Host.prototype.kick = function (pid) {
    var c = this.conns[pid];
    if (c) { this._send(c, { t: 'kicked' }); delete this.conns[pid]; setTimeout(function () { try { c.close(); } catch (e) { /* 무시 */ } }, 300); }
  };

  /* ================= 참가자 ================= */
  /**
   * h = { onMessage(msg), onStatus('connecting'|'online'|'lost'|'noroom'|'error', detail) }
   */
  function Client(h) {
    this.h = h;
    this.peer = null;
    this.conn = null;
    this.code = null;
    this.hello = null;
    this.closed = false;
    this.retry = 0;
    this.retryTimer = 0;
    this.lastMsg = 0;
    this.watch = 0;
  }

  Client.prototype.connect = function (code, hello) {
    this.code = code;
    this.hello = hello;
    this.closed = false;
    this._dial();
    var self = this;
    clearInterval(this.watch);
    // 진행자 신호가 20초 넘게 없으면 연결을 새로 맺음 (휴대폰 화면 꺼짐 등)
    this.watch = setInterval(function () {
      if (self.conn && self.conn.open && Date.now() - self.lastMsg > 20000) self._lost();
    }, 5000);
  };

  Client.prototype._dial = function () {
    var self = this;
    if (this.closed) return;
    this.h.onStatus('connecting');
    var go = function () {
      var conn = self.peer.connect(PREFIX + self.code, { reliable: true });
      var opened = false;
      var giveUp = setTimeout(function () { if (!opened) { try { conn.close(); } catch (e) { /* 무시 */ } self._lost(); } }, 12000);
      conn.on('open', function () {
        opened = true;
        clearTimeout(giveUp);
        self.conn = conn;
        self.retry = 0;
        self.everOnline = true;
        self.lastMsg = Date.now();
        conn.send(self.hello);
        self.h.onStatus('online');
      });
      conn.on('data', function (msg) {
        if (self.conn !== conn || !msg) return;
        self.lastMsg = Date.now();
        if (msg.t === 'ping') { try { conn.send({ t: 'pong' }); } catch (e) { /* 무시 */ } return; }
        self.h.onMessage(msg);
      });
      conn.on('close', function () { if (self.conn === conn) self._lost(); });
      conn.on('error', function () { if (self.conn === conn || !opened) self._lost(); });
    };
    if (this.peer && !this.peer.destroyed && this.peer.open) { go(); return; }
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* 무시 */ } }
    var peer = new Peer(peerOptions());
    this.peer = peer;
    peer.on('open', function () { if (self.peer === peer) go(); });
    peer.on('error', function (err) {
      if (self.peer !== peer) return;
      if (err.type === 'peer-unavailable') {
        // 방이 없음: 처음 접속이면 알리고, 진행 중 끊긴 거면(진행자 새로고침 등) 계속 재시도
        if (!self.everOnline) { self.h.onStatus('noroom'); self.closed = true; return; }
      }
      self._lost();
    });
    peer.on('disconnected', function () { if (self.peer === peer && !peer.destroyed) peer.reconnect(); });
  };

  Client.prototype._lost = function () {
    if (this.closed) return;
    if (this.conn) { var c = this.conn; this.conn = null; try { c.close(); } catch (e) { /* 무시 */ } }
    this.h.onStatus('lost');
    clearTimeout(this.retryTimer);
    var wait = Math.min(5000, 1000 + this.retry * 1000);
    this.retry++;
    var self = this;
    this.retryTimer = setTimeout(function () { self._dial(); }, wait);
  };

  Client.prototype.send = function (msg) {
    if (!this.conn || !this.conn.open) return false;
    try { this.conn.send(msg); return true; } catch (e) { return false; }
  };

  Client.prototype.close = function () {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.watch);
    if (this.conn) try { this.conn.close(); } catch (e) { /* 무시 */ }
    if (this.peer) try { this.peer.destroy(); } catch (e) { /* 무시 */ }
  };

  global.Net = {
    Host: Host, Client: Client, makeCode: makeCode, cleanCode: cleanCode, uid: uid,
    passThroughQuery: passThroughQuery
  };
})(window);
