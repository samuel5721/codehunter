/*
 * color.js — 색 계산과 채점
 *
 * 사진을 작게 줄인 뒤, 사진 짧은 변의 12% 크기 정사각형 영역을 촘촘히 훑어
 * 영역 평균색이 목표색과 가장 가까운 곳을 찾습니다 (CIEDE2000 색차).
 * 아주 작은 점 하나로는 점수가 안 나오고, 어느 정도 크기의 물건이어야 합니다.
 *
 * 브라우저: window.ColorKit / Node: module.exports
 */
(function (global) {
  'use strict';

  /* ---------- 변환 ---------- */
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('').toUpperCase();
  }

  var LIN = new Float64Array(256);
  for (var i = 0; i < 256; i++) {
    var c = i / 255;
    LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function fLab(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }

  // sRGB(0~255) → CIE Lab (D65)
  function rgbToLab(r, g, b) {
    var R = LIN[r | 0], G = LIN[g | 0], B = LIN[b | 0];
    var x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    var y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    var z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    var fx = fLab(x), fy = fLab(y), fz = fLab(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function rgbToHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToRgb(hsl) {
    var h = ((hsl[0] % 360) + 360) % 360 / 360, s = hsl[1], l = hsl[2];
    function hue(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    if (s === 0) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
  }

  /* ---------- CIEDE2000 ---------- */
  function deltaE2000(l1, l2) {
    var L1 = l1[0], a1 = l1[1], b1 = l1[2], L2 = l2[0], a2 = l2[1], b2 = l2[2];
    var rad = Math.PI / 180, deg = 180 / Math.PI;
    var C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
    var G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    var h1p = (Math.atan2(b1, a1p) * deg + 360) % 360, h2p = (Math.atan2(b2, a2p) * deg + 360) % 360;
    var dLp = L2 - L1, dCp = C2p - C1p, dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
    }
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
    var Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2, hbp = h1p + h2p;
    if (C1p * C2p !== 0) {
      if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360;
      hbp /= 2;
    }
    var T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) +
      0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
    var dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    var Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
    var Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
    var Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
    var Rt = -Math.sin(2 * dTh * rad) * Rc;
    return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh));
  }

  /* ---------- 채점 ---------- */
  // 난이도별 허용 폭: 색차(ΔE)가 이만큼이면 약 37점
  var LEVEL_K = { 1: 30, 2: 22, 3: 15 };
  var LEVEL_NAME = { 1: '후하게', 2: '보통', 3: '깐깐하게' };

  function scoreFromDE(dE, level) {
    var k = LEVEL_K[level] || LEVEL_K[2];
    return Math.round(1000 * Math.exp(-Math.pow(dE / k, 1.3))) / 10;
  }

  /**
   * RGBA 픽셀에서 목표색과 가장 비슷한 영역 찾기
   * @returns { dE, x, y, size (0~1, 사진 크기 대비), rgb }
   */
  function findBestPatch(rgba, w, h, targetRgb) {
    var tLab = rgbToLab(targetRgb[0], targetRgb[1], targetRgb[2]);
    var W1 = w + 1, n = W1 * (h + 1);
    // 적분 영상 (L, a, b, r, g, b)
    var S = [];
    for (var k = 0; k < 6; k++) S.push(new Float64Array(n));
    for (var y = 0; y < h; y++) {
      var row = [0, 0, 0, 0, 0, 0];
      for (var x = 0; x < w; x++) {
        var p = (y * w + x) * 4, r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
        var lab = rgbToLab(r, g, b), v = [lab[0], lab[1], lab[2], r, g, b];
        var idx = (y + 1) * W1 + (x + 1), up = y * W1 + (x + 1);
        for (k = 0; k < 6; k++) { row[k] += v[k]; S[k][idx] = S[k][up] + row[k]; }
      }
    }
    var side = Math.max(3, Math.round(0.12 * Math.min(w, h)));
    var step = Math.max(1, Math.round(side / 3));
    var best = null, area = side * side;
    function sum(k, x0, y0) {
      var A = S[k];
      return A[(y0 + side) * W1 + x0 + side] - A[y0 * W1 + x0 + side] - A[(y0 + side) * W1 + x0] + A[y0 * W1 + x0];
    }
    for (var y0 = 0; y0 + side <= h; y0 += step) {
      for (var x0 = 0; x0 + side <= w; x0 += step) {
        var m = [sum(0, x0, y0) / area, sum(1, x0, y0) / area, sum(2, x0, y0) / area];
        var dE = deltaE2000(tLab, m);
        if (!best || dE < best.dE) best = { dE: dE, x0: x0, y0: y0 };
      }
    }
    if (!best) return { dE: 100, x: 0.5, y: 0.5, size: 0, rgb: [128, 128, 128] };
    var bx = best.x0, by = best.y0;
    return {
      dE: Math.round(best.dE * 10) / 10,
      x: (bx + side / 2) / w,
      y: (by + side / 2) / h,
      size: side / Math.min(w, h),
      rgb: [sum(3, bx, by) / area, sum(4, bx, by) / area, sum(5, bx, by) / area].map(Math.round)
    };
  }

  /* ---------- 목표색 ---------- */
  var PALETTE = [
    ['빨강', '#E0322D'], ['주황', '#F07A1E'], ['노랑', '#F5C81B'], ['연두', '#9CCB3B'],
    ['초록', '#2E9E4F'], ['민트', '#4FC8B4'], ['청록', '#1F8A8A'], ['하늘', '#5BB4E5'],
    ['파랑', '#2D63C8'], ['남색', '#2A3A78'], ['보라', '#7B4BB7'], ['연보라', '#B7A3E0'],
    ['분홍', '#F07BA8'], ['자주', '#B5306E'], ['살구', '#F6B38E'], ['갈색', '#8A5632'],
    ['베이지', '#D9C3A0'], ['올리브', '#8A8B3A']
  ];

  // 사용한 색은 피해서 하나 고르고, 살짝 흔들어 매번 조금씩 다른 색으로
  function randomTarget(usedNames, rand) {
    rand = rand || Math.random;
    var pool = PALETTE.filter(function (p) { return (usedNames || []).indexOf(p[0]) < 0; });
    if (!pool.length) pool = PALETTE;
    var pick = pool[Math.floor(rand() * pool.length)];
    var hsl = rgbToHsl(hexToRgb(pick[1]));
    hsl[0] += (rand() - 0.5) * 12;
    hsl[1] = Math.max(0, Math.min(1, hsl[1] + (rand() - 0.5) * 0.12));
    hsl[2] = Math.max(0.12, Math.min(0.88, hsl[2] + (rand() - 0.5) * 0.1));
    return { name: pick[0], hex: rgbToHex(hslToRgb(hsl)) };
  }

  // 직접 고른 색에 가장 가까운 이름
  function nearestName(hex) {
    var lab = rgbToLab.apply(null, hexToRgb(hex)), best = null;
    PALETTE.forEach(function (p) {
      var d = deltaE2000(lab, rgbToLab.apply(null, hexToRgb(p[1])));
      if (!best || d < best.d) best = { d: d, name: p[0] };
    });
    return best.d < 12 ? best.name + ' 계열' : '이 색';
  }

  /* ---------- 브라우저: 사진 채점 ---------- */
  // Blob/ArrayBuffer(JPEG) → { score, dE, x, y, size, rgb }
  function scorePhoto(data, targetHex, level) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: 'image/jpeg' });
    return loadImage(blob).then(function (img) {
      var long = 160, iw = img.width, ih = img.height, s = Math.min(1, long / Math.max(iw, ih));
      var w = Math.max(8, Math.round(iw * s)), h = Math.max(8, Math.round(ih * s));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      var res = findBestPatch(g.getImageData(0, 0, w, h).data, w, h, hexToRgb(targetHex));
      res.score = scoreFromDE(res.dE, level);
      res.aspect = iw / ih;
      if (img.close) img.close();
      return res;
    });
  }

  function loadImage(blob) {
    if (global.createImageBitmap) {
      return createImageBitmap(blob).catch(function () { return loadViaImg(blob); });
    }
    return loadViaImg(blob);
  }
  function loadViaImg(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // 캔버스/영상/이미지를 긴 변 maxSide의 JPEG로
  function toJpeg(source, sw, sh, maxSide, quality) {
    var s = Math.min(1, maxSide / Math.max(sw, sh));
    var w = Math.round(sw * s), h = Math.round(sh * s);
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(source, 0, 0, w, h);
    return new Promise(function (resolve) {
      cv.toBlob(function (b) { resolve(b); }, 'image/jpeg', quality || 0.82);
    });
  }

  // 글자색: 배경색 위에서 잘 보이는 흑/백
  function inkOn(hex) {
    var lab = rgbToLab.apply(null, hexToRgb(hex));
    return lab[0] > 62 ? '#1d1d1d' : '#ffffff';
  }

  var api = {
    hexToRgb: hexToRgb, rgbToHex: rgbToHex, rgbToLab: rgbToLab, deltaE2000: deltaE2000,
    findBestPatch: findBestPatch, scoreFromDE: scoreFromDE, LEVEL_NAME: LEVEL_NAME,
    PALETTE: PALETTE, randomTarget: randomTarget, nearestName: nearestName,
    scorePhoto: scorePhoto, loadImage: loadImage, toJpeg: toJpeg, inkOn: inkOn
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ColorKit = api;
})(typeof window !== 'undefined' ? window : globalThis);
