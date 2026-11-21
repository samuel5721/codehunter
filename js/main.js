/* main.js — 첫 화면과 주소에 따른 시작 화면 정하기 */
(function () {
  'use strict';

  var UI = window.UI, $ = UI.$;

  Host.bind();
  Player.bind();

  var q = new URLSearchParams(location.search);
  var hostCode = Net.cleanCode(q.get('host'));
  var roomCode = Net.cleanCode(q.get('room'));
  var last = null;
  try { last = JSON.parse(localStorage.getItem('ch-last') || 'null'); } catch (e) { /* 무시 */ }

  $('join-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = Net.cleanCode($('join-code').value), name = $('join-name').value.trim();
    if (code.length !== 4) { msg('방 코드는 영문 4글자예요.'); $('join-code').focus(); return; }
    if (!name) { msg('이름을 입력해 주세요.'); $('join-name').focus(); return; }
    Player.join(code, name);
  });
  $('join-code').addEventListener('input', function () {
    var v = Net.cleanCode(this.value);
    if (this.value !== v) this.value = v;
  });

  function msg(t) {
    $('join-msg').textContent = t;
    $('join-msg').classList.toggle('is-error', !!t);
  }

  if (!window.Peer) {
    UI.show('home');
    msg('실시간 연결 라이브러리를 불러오지 못했어요. lib 폴더가 함께 올라갔는지 확인해 주세요.');
    return;
  }

  if (hostCode) {
    // 진행자가 새로고침한 경우: 같은 방으로 다시 염
    if (!Host.resume(hostCode)) {
      UI.show('home');
      $('host-msg').textContent = '이전 방 정보를 찾지 못했어요. 새로 만들어 주세요.';
    }
  } else if (roomCode) {
    UI.show('home');
    $('join-code').value = roomCode;
    if (last && last.code === roomCode && last.name) {
      // 참가자가 새로고침한 경우: 자동으로 다시 들어감
      $('join-name').value = last.name;
      Player.join(roomCode, last.name);
    } else {
      $('join-name').focus();
    }
  } else {
    UI.show('home');
    if (last && last.name) $('join-name').value = last.name;
  }
})();
