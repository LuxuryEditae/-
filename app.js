/* SlimTrack — локальный дневник похудения. Все данные только в браузере (localStorage). */
(function () {
  'use strict';

  var KEY = 'slimtrack.v1';
  var MEALS = [
    { id: 'breakfast', name: 'Завтрак' },
    { id: 'lunch', name: 'Обед' },
    { id: 'dinner', name: 'Ужин' },
    { id: 'snack', name: 'Перекус' }
  ];
  var ACTIVITY = [
    { v: 1.2, s: 'Сидячий', label: 'Сидячий: офис, без тренировок' },
    { v: 1.375, s: 'Лёгкая', label: 'Лёгкая: 1–3 тренировки в неделю' },
    { v: 1.55, s: 'Средняя', label: 'Средняя: 3–5 тренировки в неделю' },
    { v: 1.725, s: 'Высокая', label: 'Высокая: 6–7 тренировки в неделю' },
    { v: 1.9, s: 'Очень высокая', label: 'Очень высокая: физ. работа' }
  ];

  /* ---------------- состояние ---------------- */
  function defState() {
    return {
      profile: { sex: 'male', age: 30, height: 175, startWeight: 80, goalWeight: 70, activity: 1.375, deficit: 500 },
      days: {},
      custom: [],
      settings: { waterGoal: 2000, waterStep: 250 },
      ai: { provider: 'openrouter', model: 'qwen/qwen3.7-flash', visionModel: 'qwen/qwen3.7-flash', key: '', base: '' },
      chat: [],
      onboarded: false,
      meta: { created: dateKey(new Date()), lastExport: null }
    };
  }

  var S = defState();
  var _ready = false;

  (function migrateOldStorage() {
    try {
      var old = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (old && old.profile && old.days) {
        S = old;
        if (!S.settings) S.settings = { waterGoal: 2000, waterStep: 250 };
        if (!S.custom) S.custom = [];
        if (!S.ai) S.ai = { provider: 'openrouter', model: 'qwen/qwen3.7-flash', visionModel: 'qwen/qwen3.7-flash', key: '', base: '' };
        if (!S.chat) S.chat = [];
      }
    } catch (e) {}
  })();

  if (window.SlimStore) {
    SlimStore.get(null).then(function (v) {
      if (v && v.profile && v.days) S = v;
      if (!S.settings) S.settings = { waterGoal: 2000, waterStep: 250 };
      if (!S.custom) S.custom = [];
      if (!S.ai) S.ai = { provider: 'openrouter', model: 'qwen/qwen3.7-flash', visionModel: 'qwen/qwen3.7-flash', key: '', base: '' };
      if (!S.chat) S.chat = [];
      _ready = true;
      if (S.onboarded) render(); else startOnboard();
    }).catch(function () {
      _ready = true;
      if (S.onboarded) render(); else startOnboard();
    });
  } else {
    _ready = true;
  }

  var view = { screen: 'today', date: dateKey(new Date()) };

  function save() {
    if (window.SlimStore) {
      SlimStore.set(S).catch(function () { toast('Не получилось сохранить'); });
    } else {
      try { localStorage.setItem(KEY, JSON.stringify(S)); }
      catch (e) { toast('Не получилось сохранить'); }
    }
  }

  /* ---------------- утилиты ---------------- */
  function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDays(key, n) {
    var p = key.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }
  function prettyDate(key) {
    var p = key.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    var s = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function day(k) {
    k = k || view.date;
    if (!S.days[k]) S.days[k] = { meals: [], water: 0, weight: null, burn: 0 };
    if (!S.days[k].meals) S.days[k].meals = [];
    return S.days[k];
  }
  function n1(v) { return Math.round(v * 10) / 10; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2000);
  }

  /* ---------------- расчёты ---------------- */
  function lastWeight() {
    var keys = Object.keys(S.days).filter(function (k) { return S.days[k].weight; }).sort();
    if (!keys.length) return Number(S.profile.startWeight) || 80;
    return Number(S.days[keys[keys.length - 1]].weight);
  }
  function targets() {
    var p = S.profile;
    var w = lastWeight();
    var bmr = 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'male' ? 5 : -161);
    var tdee = bmr * p.activity;
    var target = Math.round((tdee - p.deficit) / 10) * 10;
    if (target < 1200) target = 1200;
    var protein = Math.round(w * 1.8);
    var fat = Math.round(target * 0.28 / 9);
    var carbs = Math.max(0, Math.round((target - protein * 4 - fat * 9) / 4));
    return { bmr: Math.round(bmr), tdee: Math.round(tdee), target: target, protein: protein, fat: fat, carbs: carbs };
  }
  function totals(k) {
    var d = day(k);
    var t = { kcal: 0, p: 0, f: 0, c: 0 };
    d.meals.forEach(function (m) {
      t.kcal += m.kcal; t.p += m.p; t.f += m.f; t.c += m.c;
    });
    t.kcal = Math.round(t.kcal);
    t.p = Math.round(t.p); t.f = n1(t.f); t.c = n1(t.c);
    t.budget = targets().target + (d.burn || 0);
    t.left = Math.round(t.budget - t.kcal);
    return t;
  }
  function allFoods() {
    return (window.FOODS || []).concat(S.custom || []);
  }
  function streak() {
    var n = 0, k = dateKey(new Date());
    if (!(S.days[k] && S.days[k].meals.length)) k = addDays(k, -1);
    while (S.days[k] && S.days[k].meals.length) { n++; k = addDays(k, -1); }
    return n;
  }

  /* ================= ОНБОРДИНГ ================= */
  var ob = { step: 0 };
  var OB_LAST = 6;
  var DEFICITS = [{ v: 300, name: 'Мягко' }, { v: 500, name: 'Оптимально' }, { v: 700, name: 'Быстро' }];

  function clampNum(v, lo, hi, dflt) {
    var n = Number(String(v).replace(',', '.'));
    if (!isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  function startOnboard() {
    ob.step = 0;
    document.getElementById('onboard').hidden = false;
    renderOnboard();
  }
  function endOnboard() {
    S.onboarded = true;
    save();
    document.getElementById('onboard').hidden = true;
    render();
  }

  function obFeat(bg, color, ico, title, text) {
    return '<div class="ob-feat"><div class="ob-feat-ico" style="background:' + bg + '">' +
      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + ico + '</svg>' +
      '</div><div><b>' + title + '</b><span>' + text + '</span></div></div>';
  }

  function renderOnboard() {
    var p = S.profile, s = ob.step, html = '', nextLabel = 'Далее';
    var tg = targets();

    if (s === 0) {
      html = '<div class="ob-hero-img"><img src="icons/icon-180.png" width="92" height="92" alt="" style="border-radius:21px"></div>' +
        '<h1 class="ob-title">Привет. Давай познакомимся</h1>' +
        '<p class="ob-sub">Я посчитаю твою норму калорий и помогу её придерживаться. Пара вопросов — и всё готово.</p>' +
        '<div style="height:16px"></div>' +
        obFeat('#eaf4ff', '#0a84ff', '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-2h6.2l1.2 2h1.7A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.6"/>',
          'Фото еды → калории', 'Сфоткай тарелку, ИИ определит блюдо и посчитает КБЖУ') +
        obFeat('#e9f9ef', '#34c759', '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.7 8.7 0 0 1-3.8-.9L3 20l1.1-4.6A8.3 8.3 0 0 1 3.2 11 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>',
          'ИИ-нутрициолог', 'Скажет, что съесть, чтобы уложиться в норму') +
        obFeat('#f1eeff', '#5e5ce6', '<path d="M4 19V5M4 19h16M7 15l4-5 3 3 4-6"/>',
          'Вес и прогресс', 'График, темп и честная статистика без самообмана');
      nextLabel = 'Начать';

    } else if (s === 1) {
      html = '<h2 class="ob-sec">Шаг 1 — о тебе</h2>' +
        '<div class="ob-row">' +
        '<button class="ob-card grow' + (p.sex === 'male' ? ' on' : '') + '" data-act="ob-sex" data-v="male"><div class="radio"></div><b>Мужской</b></button>' +
        '<button class="ob-card grow' + (p.sex === 'female' ? ' on' : '') + '" data-act="ob-sex" data-v="female"><div class="radio"></div><b>Женский</b></button>' +
        '</div><div style="height:26px"></div>' +
        '<div class="ob-label">Сколько тебе лет?</div>' +
        '<input class="ob-num" type="number" inputmode="numeric" id="ob-age" value="' + p.age + '">' +
        '<div class="ob-num-unit">полных лет</div>';

    } else if (s === 2) {
      html = '<h2 class="ob-sec">Шаг 2 — параметры</h2>' +
        '<div class="ob-label">Рост</div>' +
        '<input class="ob-num" type="number" inputmode="numeric" id="ob-height" value="' + p.height + '">' +
        '<div class="ob-num-unit">сантиметров</div>' +
        '<div style="height:26px"></div>' +
        '<div class="ob-label">Вес сейчас</div>' +
        '<input class="ob-num" type="number" step="0.1" inputmode="decimal" id="ob-weight" value="' + p.startWeight + '">' +
        '<div class="ob-num-unit">килограмм</div>';

    } else if (s === 3) {
      html = '<h2 class="ob-sec">Шаг 3 — цель</h2>' +
        '<p class="ob-sub" style="margin-bottom:20px">Сейчас у тебя ' + p.startWeight + ' кг. К какому весу идём?</p>' +
        '<div class="ob-label">Хочу весить</div>' +
        '<input class="ob-num" type="number" step="0.1" inputmode="decimal" id="ob-goal" value="' + p.goalWeight + '">' +
        '<div class="ob-num-unit">килограмм</div>' +
        '<p class="ob-sub" style="text-align:center;margin-top:18px;font-size:13px">' +
        'Худеть безопаснее на 0,5–1 кг в неделю. Быстрее — почти всегда мышцы и откат.</p>';

    } else if (s === 4) {
      html = '<h2 class="ob-sec">Шаг 4 — активность</h2>' +
        '<p class="ob-sub" style="margin-bottom:16px">Сколько ты двигаешься помимо бытовых дел?</p>' +
        '<div class="ob-cards">' + ACTIVITY.map(function (a) {
          return '<button class="ob-card' + (p.activity === a.v ? ' on' : '') + '" data-act="ob-activity" data-v="' + a.v + '">' +
            '<div class="radio"></div><div><b>' + a.s + '</b><span>' + a.label.split(': ')[1] + '</span></div></button>';
        }).join('') + '</div>';

    } else if (s === 5) {
      html = '<h2 class="ob-sec">Шаг 5 — темп</h2>' +
        '<p class="ob-sub" style="margin-bottom:16px">Твой организм тратит около <b>' + tg.tdee + '</b> ккал в день. С какой скоростью идём к цели?</p>' +
        '<div class="ob-cards">' + DEFICITS.map(function (d) {
          var kkal = Math.max(1200, Math.round((tg.tdee - d.v) / 10) * 10);
          var kg = n1(d.v * 7 / 7700);
          var low = kkal <= 1200 ? ' · это минимум, ниже нельзя' : '';
          return '<button class="ob-card' + (p.deficit === d.v ? ' on' : '') + '" data-act="ob-deficit" data-v="' + d.v + '">' +
            '<div class="radio"></div><div><b>' + d.name + '</b><span>' + kkal + ' ккал/день · −' + kg + ' кг в неделю' + low + '</span></div></button>';
        }).join('') + '</div>';

    } else if (s === 6) {
      html = '<div style="text-align:center;padding:16px 0 0">' +
        '<p class="ob-sub" style="margin-bottom:4px">Твоя норма на день</p>' +
        '<div class="ob-final-num">' + tg.target + '</div>' +
        '<div class="ob-final-unit">килокалорий</div>' +
        '<div class="ob-macro">' +
        '<div><b>' + tg.protein + ' г</b><span>белок</span></div>' +
        '<div><b>' + tg.fat + ' г</b><span>жиры</span></div>' +
        '<div><b>' + tg.carbs + ' г</b><span>углеводы</span></div>' +
        '</div></div>' +
        '<div class="card" style="margin-top:20px;background:#f7f7f9;border:0">' +
        '<div class="small muted" style="line-height:1.55">Из ' + tg.tdee + ' ккал, что ты тратишь за день, ' + tg.bmr +
        ' уходит просто на поддержание жизни. Дефицит ' + p.deficit + ' ккал — это примерно −' + n1(p.deficit * 7 / 7700) +
        ' кг в неделю. До цели ' + n1(Math.max(0, lastWeight() - p.goalWeight)) + ' кг.<br><br>' +
        'Норму всегда можно поменять в Профиле.</div></div>';
      nextLabel = 'Начать';
    }

    $('#obBody').innerHTML = html;

    var dots = '';
    for (var i = 0; i <= OB_LAST; i++) dots += '<div class="ob-dot' + (i === s ? ' on' : '') + '"></div>';
    $('#obDots').innerHTML = dots;
    $('#obNext').textContent = nextLabel;
  }

  function obNext() {
    var p = S.profile, s = ob.step;
    if (s === 0) { ob.step = 1; return renderOnboard(); }
    if (s === 1) {
      p.age = clampNum(($('#ob-age') || {}).value, 10, 99, 30);
      ob.step = 2; return renderOnboard();
    }
    if (s === 2) {
      p.height = clampNum(($('#ob-height') || {}).value, 120, 230, 175);
      p.startWeight = clampNum(($('#ob-weight') || {}).value, 30, 300, 80);
      day().weight = p.startWeight;
      save();
      ob.step = 3; return renderOnboard();
    }
    if (s === 3) {
      var g = clampNum(($('#ob-goal') || {}).value, 30, 300, p.startWeight - 5);
      if (g >= p.startWeight) g = Math.max(30, n1(p.startWeight - 1));
      p.goalWeight = g;
      save();
      ob.step = 4; return renderOnboard();
    }
    if (s === 4) { save(); ob.step = 5; return renderOnboard(); }
    if (s === 5) { save(); ob.step = 6; return renderOnboard(); }
    if (s === 6) return endOnboard();
  }

  /* ================= ИИ ================= */
  var PROVIDERS = {
    openrouter: { name: 'OpenRouter (рекомендую)', base: 'https://openrouter.ai/api/v1', model: 'qwen/qwen3.7-flash' },
    openai: { name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    anthropic: { name: 'Anthropic (Claude)', base: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20241022' },
    custom: { name: 'Свой (OpenAI-совместимый)', base: '', model: '' }
  };

  var VISION_PROMPT = 'Ты — нутрициолог. На фото еда. Определи блюдо, размер порции в граммах и КБЖУ.\n' +
    'Ответь ТОЛЬКО валидным JSON, без пояснений и без markdown-обёрток, строго в формате:\n' +
    '{"dish":"название блюда","items":[{"name":"продукт","grams":150,"kcal":210,"p":10,"f":8,"c":25}],"comment":"короткий комментарий на русском, одно предложение"}\n' +
    'Правила: числа без единиц измерения; если блюд несколько — перечисли каждое отдельным элементом items; ' +
    'если на фото нет еды — верни {"error":"На фото не видно еды. Сфоткай тарелку ближе."}. ' +
    'Оценивай порции реалистично по общему виду тарелки. Если не уверен в точном значении — дай оценку.';

  var QUICK = [
    'Что съесть на ужин, чтобы уложиться в норму?',
    'Почему вес стоит на месте?',
    'Составь меню на день',
    'Хватает ли мне белка сегодня?',
    'Как перестать хотеть сладкое?'
  ];

  function aiCfg() {
    var a = S.ai;
    var def = PROVIDERS[a.provider] || PROVIDERS.openrouter;
    var base = (a.provider === 'custom' ? (a.base || '') : def.base).replace(/\/+$/, '');
    return {
      provider: a.provider,
      base: base,
      key: (a.key || '').trim(),
      model: (a.model || def.model).trim(),
      visionModel: (a.visionModel || a.model || def.model).trim()
    };
  }

  function httpErr(status, body) {
    var msg = '';
    try { msg = ((JSON.parse(body) || {}).error || {}).message || ''; } catch (e) { msg = String(body || '').slice(0, 140); }
    if (status === 401) return 'Неверный API-ключ (401)';
    if (status === 403) return 'Доступ запрещён (403). Проверь права ключа';
    if (status === 429) return 'Слишком много запросов или кончились деньги на балансе (429)';
    if (status === 404) return 'Модель или endpoint не найдены (404)';
    return 'Ошибка ' + status + (msg ? ': ' + msg : '');
  }

  function errText(err) {
    var m = (err && err.message) || 'Неизвестная ошибка';
    if (m === 'NO_KEY') return 'Нет API-ключа. Добавь его: Профиль → ИИ-помощник.';
    if (m === 'NO_BASE') return 'Укажи URL своего API: Профиль → ИИ-помощник.';
    if (m === 'Failed to fetch') return 'Не достучался до API. Проверь интернет и URL в Профиле.';
    return m;
  }

  function openaiStream(cfg, messages, model, onDelta) {
    return fetch(cfg.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({ model: model, messages: messages, stream: true, temperature: 0.6 })
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(httpErr(res.status, t)); });
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var s = lines[i].trim();
            if (s.indexOf('data:') !== 0) continue;
            var p = s.slice(5).trim();
            if (!p || p === '[DONE]') continue;
            try {
              var j = JSON.parse(p);
              var d = j.choices && j.choices[0] && j.choices[0].delta;
              if (d && d.content) onDelta(d.content);
            } catch (e) {}
          }
          return pump();
        });
      }
      return pump();
    });
  }

  function anthropicStream(cfg, messages, model, onDelta) {
    var sys = [], rest = [];
    messages.forEach(function (m) {
      if (m.role === 'system') { sys.push(typeof m.content === 'string' ? m.content : ''); return; }
      rest.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    });
    var body = { model: model, messages: rest, max_tokens: 1500, stream: true };
    if (sys.length) body.system = sys.join('\n\n');
    return fetch(cfg.base + '/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(httpErr(res.status, t)); });
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var s = lines[i].trim();
            if (s.indexOf('data:') !== 0) continue;
            var p = s.slice(5).trim();
            if (!p) continue;
            try {
              var j = JSON.parse(p);
              if (j.type === 'content_block_delta' && j.delta && j.delta.text) onDelta(j.delta.text);
            } catch (e) {}
          }
          return pump();
        });
      }
      return pump();
    });
  }

  function aiStream(messages, model, onDelta) {
    var cfg = aiCfg();
    if (!cfg.key) return Promise.reject(new Error('NO_KEY'));
    if (!cfg.base) return Promise.reject(new Error('NO_BASE'));
    if (cfg.provider === 'anthropic') return anthropicStream(cfg, messages, model, onDelta);
    return openaiStream(cfg, messages, model, onDelta);
  }

  function aiCall(messages, model) {
    var out = '';
    return aiStream(messages, model, function (d) { out += d; }).then(function () { return out; });
  }

  function extractJson(text) {
    var s = String(text || '').replace(/```(?:json)?/gi, '');
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  }

  function shrinkImage(file, max, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        var scale = Math.min(1, (max || 1024) / Math.max(w, h, 1));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        try { resolve(c.toDataURL('image/jpeg', quality || 0.8)); }
        catch (e) { reject(new Error('Не удалось обработать фото')); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть фото')); };
      img.src = url;
    });
  }

  function systemPrompt() {
    var p = S.profile, tg = targets(), t = totals(view.date), d = day(view.date);
    var act = ACTIVITY.filter(function (a) { return a.v === p.activity; })[0];
    var meals = d.meals.map(function (m) { return '- ' + m.name + ' ' + m.grams + ' г / ' + Math.round(m.kcal) + ' ккал'; });
    return 'Ты — персональный нутрициолог и коуч по снижению веса внутри приложения SlimTrack. ' +
      'Отвечай по-русски, по делу и коротко (3–6 предложений), дружелюбно, без воды. ' +
      'Не ставь медицинских диагнозов; при болезнях и симптомах отправь к врачу.\n\n' +
      'Профиль: пол ' + (p.sex === 'male' ? 'мужской' : 'женский') + ', возраст ' + p.age + ', рост ' + p.height + ' см.\n' +
      'Вес сейчас: ' + lastWeight() + ' кг; старт ' + p.startWeight + ' кг; цель ' + p.goalWeight + ' кг.\n' +
      'Активность: ' + (act ? act.label : p.activity) + '.\n' +
      'Норма: ' + tg.target + ' ккал/сутки (BMR ' + tg.bmr + ', TDEE ' + tg.tdee + '). Цель по белку ' + tg.protein + ' г, по жирам ' + tg.fat + ' г.\n\n' +
      'Сегодня (' + view.date + '): съедено ' + t.kcal + ' ккал из ' + t.budget + ', осталось ' + t.left + '. ' +
      'Белки ' + t.p + ' г, жиры ' + t.f + ' г, углеводы ' + t.c + ' г. Вода ' + (d.water || 0) + ' мл из ' + S.settings.waterGoal + '.\n' +
      (meals.length ? 'Съедено сегодня:\n' + meals.join('\n') + '\n' : 'Сегодня пока ничего не записано.\n') +
      '\nОтвечай конкретно и с цифрами. Учитывай остаток калорий на сегодня.';
  }

  /* ---------------- чат ---------------- */
  function fmtText(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }
  function msgHtml(m) {
    var cls = m.role === 'user' ? 'user' : (m.error ? 'err' : 'bot');
    return '<div class="msg ' + cls + (m.pending ? ' pending' : '') + '">' + fmtText(m.content || '') + '</div>';
  }
  function trimChat() {
    if (S.chat.length > 40) S.chat = S.chat.slice(-40);
  }
  function scrollMsgs() {
    var box = document.getElementById('msgs');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function renderAi() {
    var cfg = aiCfg();
    var needsSetup = !cfg.key;
    var html = '';

    html += '<div class="ai-actions">' +
      '<button class="btn" data-act="take-photo">Сфоткать еду</button>' +
      '<button class="btn secondary" data-act="pick-photo">Галерея</button>' +
      '</div>';
    html += '<button class="btn" data-act="plan-meal" style="margin-bottom:12px">Подобрать меню под остаток дня</button>';

    if (needsSetup) {
      html += '<div class="card"><div class="card-title">Нужен ключ</div>' +
        '<div class="small muted" style="margin-bottom:10px">' +
        'Бесплатный ключ за 30 сек: <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a> → Create Key → пополни на $5 → вставь сюда.' +
        '</div>' +
        '<button class="btn" data-act="goto-ai-settings">Добавить ключ</button></div>';
    }

    html += '<div class="msgs" id="msgs">' +
      (S.chat.length ? S.chat.map(msgHtml).join('') :
        '<div class="msg bot">Привет! Я твой нутрициолог в кармане.<br><br>' +
        '• <b>Сфоткай еду</b> — я оценю порцию и посчитаю КБЖУ<br>' +
        '• <b>Спроси что угодно</b> — про меню, вес, срывы, дефицит<br><br>' +
        'Я вижу твой профиль, норму и то, что ты съел за день.</div>') +
      '</div>';

    html += '<div class="quick">' + QUICK.map(function (q, i) {
      return '<button class="chip" data-act="quick-ai" data-i="' + i + '">' + esc(q) + '</button>';
    }).join('') + '</div>';

    html += '<div class="compose">' +
      '<textarea id="chatInput" rows="1" placeholder="Спроси у нутрициолога…"></textarea>' +
      '<button class="send-btn" data-act="send-chat" aria-label="Отправить">↑</button>' +
      '</div>';

    $('#screen-ai').innerHTML = html;
    var ta = document.getElementById('chatInput');
    if (ta) {
      ta.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(120, this.scrollHeight) + 'px';
      });
    }
    scrollMsgs();
  }

  function sendChat(text) {
    var el = document.getElementById('chatInput');
    var msg = (text != null ? text : (el ? el.value : '')).trim();
    if (!msg) return;
    var cfg = aiCfg();
    if (!cfg.key) { toast('Добавь API-ключ в Профиле'); view.screen = 'profile'; render(); return; }

    if (el) { el.value = ''; el.style.height = 'auto'; }
    S.chat.push({ role: 'user', content: msg });

    var req = [{ role: 'system', content: systemPrompt() }];
    S.chat.slice(-24).forEach(function (m) {
      if (m.pending || m.error || !m.content) return;
      req.push({ role: m.role, content: m.content });
    });

    S.chat.push({ role: 'assistant', content: '', pending: true });
    trimChat();
    renderAi();

    var acc = '';
    aiStream(req, cfg.model, function (delta) {
      acc += delta;
      var last = S.chat[S.chat.length - 1];
      last.content = acc;
      paintLast();
    }).then(function () {
      var last = S.chat[S.chat.length - 1];
      last.pending = false;
      if (!last.content) last.content = 'Пустой ответ. Попробуй переформулировать вопрос.';
      save(); renderAi();
    }).catch(function (err) {
      var last = S.chat[S.chat.length - 1];
      last.pending = false;
      last.error = true;
      last.content = errText(err);
      save(); renderAi();
    });
  }

  function paintLast() {
    var box = document.getElementById('msgs');
    if (!box) return;
    var near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    var nodes = box.querySelectorAll('.msg');
    var node = nodes[nodes.length - 1];
    if (node) node.innerHTML = fmtText(S.chat[S.chat.length - 1].content || '');
    if (near) box.scrollTop = box.scrollHeight;
  }

  /* ---------------- фото → калории ---------------- */
  var photo = { dataUrl: '', items: [], meal: 'snack', dish: '', comment: '', busy: false, error: '' };

  function visionMessages(dataUrl) {
    var cfg = aiCfg();
    var b64 = dataUrl.split(',')[1] || '';
    if (cfg.provider === 'anthropic') {
      return [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: VISION_PROMPT }
        ]
      }];
    }
    return [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: VISION_PROMPT }
      ]
    }];
  }

  function handlePhoto(file) {
    if (!file) return;
    var cfg = aiCfg();
    if (!cfg.key) { toast('Сначала добавь API-ключ в Профиле'); return; }

    photo = { dataUrl: '', items: [], meal: guessMeal(), dish: '', comment: '', busy: true, error: '' };
    sheetState.mode = 'photo';
    openSheet('Анализ фото',
      '<div style="text-align:center;padding:34px 0"><span class="spinner"></span>' +
      '<div class="small muted" style="margin-top:10px">Обрабатываю фото…</div></div>');

    shrinkImage(file, 1024, 0.8).then(function (dataUrl) {
      photo.dataUrl = dataUrl;
      renderPhotoSheet();
      return aiCall(visionMessages(dataUrl), cfg.visionModel || cfg.model);
    }).then(function (text) {
      var j = extractJson(text);
      if (!j) throw new Error('ИИ ответил не JSON. Попробуй ещё раз или смени модель.');
      if (j.error) throw new Error(String(j.error));
      var items = (j.items || []).filter(function (it) { return it && it.name; }).map(function (it) {
        return {
          name: String(it.name).slice(0, 80),
          grams: Math.max(1, Math.round(Number(it.grams) || 100)),
          kcal: Math.max(0, Number(it.kcal) || 0),
          p: Math.max(0, Number(it.p) || 0),
          f: Math.max(0, Number(it.f) || 0),
          c: Math.max(0, Number(it.c) || 0)
        };
      });
      if (!items.length) throw new Error('Не нашёл еду на фото. Сфоткай тарелку ближе.');
      photo.items = items;
      photo.dish = String(j.dish || '').slice(0, 100);
      photo.comment = String(j.comment || '').slice(0, 300);
      photo.busy = false;
      renderPhotoSheet();
    }).catch(function (err) {
      photo.busy = false;
      photo.error = errText(err);
      renderPhotoSheet();
    });
  }

  function renderPhotoSheet() {
    var html = '';
    if (photo.dataUrl) html += '<img class="photo-preview" src="' + photo.dataUrl + '" alt="фото еды">';

    if (photo.busy) {
      html += '<div style="text-align:center;padding:16px 0"><span class="spinner"></span>' +
        '<div class="small muted" style="margin-top:10px">ИИ считает калории…</div></div>';
    } else if (photo.error) {
      html += '<div class="warn">' + esc(photo.error) + '</div>' +
        '<div style="height:10px"></div><button class="btn secondary" data-act="close-sheet">Закрыть</button>';
    } else {
      var sum = photo.items.reduce(function (a, it) { return a + (it.kcal || 0); }, 0);
      var leftNow = totals(view.date).left;
      var afterPhoto = Math.round(leftNow - sum);
      if (photo.dish) {
        html += '<div class="card"><div class="card-title"><span class="badge-ai">ИИ</span></div>' +
          '<div style="font-weight:600;font-size:16px">' + esc(photo.dish) + '</div>' +
          (photo.comment ? '<div class="small muted" style="margin-top:6px">' + esc(photo.comment) + '</div>' : '') +
          '</div>';
      }
      html += '<div class="card"><div class="card-title"><span>Что нашёл</span><span class="mono">' + Math.round(sum) + ' ккал</span></div>' +
        '<div class="' + (afterPhoto >= 0 ? 'plan-ok' : 'plan-over') + '" style="margin-bottom:8px">' +
        (afterPhoto >= 0 ? 'Если съешь это — останется ' + afterPhoto + ' ккал' : 'Это на ' + Math.abs(afterPhoto) + ' ккал больше остатка') +
        '</div>';
      photo.items.forEach(function (it, i) {
        html += '<div class="ai-item"><div class="food-main"><div class="food-name">' + esc(it.name) + '</div>' +
          '<div class="food-sub mono">' + it.grams + ' г · Б ' + n1(it.p) + ' · Ж ' + n1(it.f) + ' · У ' + n1(it.c) + '</div></div>' +
          '<div class="food-kcal mono">' + Math.round(it.kcal) + '</div>' +
          '<button class="icon-btn" data-act="photo-del" data-i="' + i + '">✕</button></div>';
      });
      html += '</div>';
      html += '<div class="card"><div class="card-title">Приём пищи</div><div class="water-row">' +
        MEALS.map(function (m) {
          return '<button class="chip' + (photo.meal === m.id ? ' is-on' : '') + '" data-act="photo-meal" data-m="' + m.id + '">' + m.name + '</button>';
        }).join('') + '</div></div>';
      if (afterPhoto > 40) {
        html += '<button class="btn secondary" data-act="plan-meal" style="margin-bottom:8px">Что ещё можно съесть?</button>';
      }
      html += '<button class="btn" data-act="photo-add">Добавить в дневник</button>' +
        '<div style="height:8px"></div><button class="btn secondary" data-act="close-sheet">Отмена</button>';
    }
    openSheet('Анализ фото', html);
  }

  /* ---------------- ИИ-менеджер: меню под остаток ---------------- */
  var plan = { items: [], comment: '', busy: false, error: '', closed: false };

  function matchFood(name) {
    var q = String(name || '').trim().toLowerCase();
    if (!q) return null;
    var list = allFoods(), i;
    for (i = 0; i < list.length; i++) if (list[i].n.toLowerCase() === q) return list[i];
    for (i = 0; i < list.length; i++) if (list[i].n.toLowerCase().indexOf(q) === 0) return list[i];
    for (i = 0; i < list.length; i++) if (q.indexOf(list[i].n.toLowerCase()) === 0) return list[i];
    var first = q.split(/[ ,(]/)[0];
    if (first.length > 3) {
      for (i = 0; i < list.length; i++) if (list[i].n.toLowerCase().indexOf(first) >= 0) return list[i];
    }
    return null;
  }

  function buildPlan(json) {
    return (json.plan || []).map(function (it) {
      var grams = Math.max(5, Math.round((Number(it.grams) || 100) / 5) * 5);
      var meal = ['breakfast', 'lunch', 'dinner', 'snack'].indexOf(it.meal) >= 0 ? it.meal : 'snack';
      var f = matchFood(it.name);
      if (f) {
        var m = grams / 100;
        return { name: f.n, grams: grams, meal: meal, kcal: f.k * m, p: f.p * m, fat: f.f * m, c: f.c * m, exact: true };
      }
      return {
        name: String(it.name || 'Продукт').slice(0, 60), grams: grams, meal: meal,
        kcal: Number(it.kcal) || 0, p: Number(it.p) || 0, fat: Number(it.f) || 0, c: Number(it.c) || 0, exact: false
      };
    });
  }

  function planPrompt() {
    var t = totals(view.date), tg = targets(), d = day(view.date);
    var leftK = Math.round(t.left);
    var leftP = Math.max(0, Math.round(tg.protein - t.p));
    var db = allFoods().map(function (f) {
      return f.n + '|' + f.k + '|' + f.p + '|' + f.f + '|' + f.c;
    }).join('\n');
    var eaten = d.meals.length
      ? d.meals.map(function (m) { return '- ' + m.name + ' ' + m.grams + ' г'; }).join('\n')
      : 'ничего';
    return 'Составь меню на остаток дня.\n\n' +
      'Осталось: ' + leftK + ' ккал, белок ' + leftP + ' г.\n' +
      'Уже съедено сегодня:\n' + eaten + '\n\n' +
      'Доступные продукты (название|ккал|белок|жиры|углеводы на 100 г):\n' + db + '\n\n' +
      'Требования:\n' +
      '1. Используй ТОЛЬКО продукты из списка, название копируй точь-в-точь как в списке.\n' +
      '2. Суммарные калории должны получиться от ' + Math.max(0, leftK - 70) + ' до ' + (leftK + 40) + ' ккал. Пересчитай сам перед ответом.\n' +
      '3. Постарайся добрать белок, но не перебирай калории.\n' +
      '4. Поле meal — одно из: breakfast, lunch, dinner, snack.\n' +
      '5. Порции реалистичные и кратные 5.\n' +
      '6. Ответь ТОЛЬКО JSON, без пояснений: {"plan":[{"name":"точное название из списка","grams":150,"meal":"dinner"}],"comment":"одно предложение на русском"}';
  }

  function openPlan() {
    var cfg = aiCfg();
    if (!cfg.key) { toast('Добавь API-ключ в Профиле'); view.screen = 'profile'; render(); return; }

    var t = totals(view.date);
    if (t.left <= 40) {
      plan = { items: [], comment: '', busy: false, error: '', closed: true };
      sheetState.mode = 'plan';
      return renderPlanSheet();
    }

    plan = { items: [], comment: '', busy: true, error: '', closed: false };
    sheetState.mode = 'plan';
    openSheet('Что съесть',
      '<div style="text-align:center;padding:36px 0"><span class="spinner"></span>' +
      '<div class="small muted" style="margin-top:10px">Считаю остаток и подбираю меню…</div></div>');

    aiCall([{ role: 'user', content: planPrompt() }], cfg.model).then(function (text) {
      var j = extractJson(text);
      if (!j) throw new Error('ИИ ответил непонятно. Нажми «Другой вариант».');
      if (j.error) throw new Error(String(j.error));
      var items = buildPlan(j);
      if (!items.length) throw new Error('Не вышло составить меню. Нажми «Другой вариант».');
      plan.items = items;
      plan.comment = String(j.comment || '').slice(0, 300);
      plan.busy = false;
      renderPlanSheet();
    }).catch(function (err) {
      plan.busy = false;
      plan.error = errText(err);
      renderPlanSheet();
    });
  }

  function renderPlanSheet() {
    var html = '';

    if (plan.busy) {
      html = '<div style="text-align:center;padding:36px 0"><span class="spinner"></span>' +
        '<div class="small muted" style="margin-top:10px">Считаю остаток и подбираю меню…</div></div>';
    } else if (plan.error) {
      html = '<div class="warn">' + esc(plan.error) + '</div>' +
        '<div style="height:10px"></div><button class="btn" data-act="plan-retry">Попробовать снова</button>' +
        '<div style="height:8px"></div><button class="btn ghost" data-act="close-sheet">Закрыть</button>';
    } else if (plan.closed) {
      var t0 = totals(view.date);
      html = '<div class="card" style="text-align:center;padding:26px 16px">' +
        '<div style="font-size:36px;font-weight:700;letter-spacing:-1.2px">' + t0.left + '</div>' +
        '<div class="small muted">ккал осталось на сегодня</div>' +
        '<div class="small" style="margin-top:14px;line-height:1.5">Дневная норма уже закрыта. ' +
        'Добавь тренировку — и появится запас, под который можно составить меню.</div></div>' +
        '<button class="btn secondary" data-act="close-sheet">Понятно</button>';
    } else {
      var sum = { kcal: 0, p: 0, fat: 0, c: 0 };
      plan.items.forEach(function (it) {
        sum.kcal += it.kcal; sum.p += it.p; sum.fat += it.fat; sum.c += it.c;
      });
      var t1 = totals(view.date);
      var after = Math.round(t1.left - sum.kcal);

      html += '<div class="card"><div class="card-title"><span class="badge-ai">План от ИИ</span></div>' +
        '<div class="plan-total"><b>' + Math.round(sum.kcal) + '</b><span class="small muted">ккал в меню</span></div>' +
        '<div class="' + (after >= 0 ? 'plan-ok' : 'plan-over') + '">' +
        (after >= 0 ? 'После этого останется ' + after + ' ккал' : 'Это на ' + Math.abs(after) + ' ккал больше остатка') +
        '</div>' +
        '<div class="small muted mono" style="margin-top:7px">Б ' + n1(sum.p) + ' г · Ж ' + n1(sum.fat) + ' г · У ' + n1(sum.c) + ' г</div>' +
        (plan.comment ? '<div class="small muted" style="margin-top:9px;line-height:1.5">' + esc(plan.comment) + '</div>' : '') +
        '</div>';

      MEALS.forEach(function (m) {
        var its = plan.items.filter(function (x) { return x.meal === m.id; });
        if (!its.length) return;
        var sk = its.reduce(function (a, x) { return a + x.kcal; }, 0);
        html += '<div class="card"><div class="meal-head"><span>' + m.name + '</span><span class="mono">' + Math.round(sk) + ' ккал</span></div>';
        its.forEach(function (it) {
          var idx = plan.items.indexOf(it);
          html += '<div class="ai-item"><div class="food-main"><div class="food-name">' + esc(it.name) +
            (it.exact ? '<span class="tag-exact">по базе</span>' : '<span class="tag-est">оценка ИИ</span>') + '</div>' +
            '<div class="food-sub mono">' + it.grams + ' г · Б ' + n1(it.p) + ' · Ж ' + n1(it.fat) + ' · У ' + n1(it.c) + '</div></div>' +
            '<div class="food-kcal mono">' + Math.round(it.kcal) + '</div>' +
            '<button class="icon-btn" data-act="plan-del" data-i="' + idx + '">✕</button></div>';
        });
        html += '</div>';
      });

      html += '<div class="small muted" style="padding:2px 4px 10px;line-height:1.5">' +
        '<b>«По базе»</b> — калории посчитаны по локальной базе продуктов, этим цифрам можно верить. ' +
        '<b>«Оценка ИИ»</b> — продукта нет в базе, цифры приблизительные.</div>';
      html += '<button class="btn" data-act="plan-add">Добавить в дневник</button>' +
        '<div style="height:8px"></div><button class="btn secondary" data-act="plan-retry">Другой вариант</button>' +
        '<div style="height:8px"></div><button class="btn ghost" data-act="close-sheet">Закрыть</button>';
    }

    openSheet('Что съесть', html);
  }

  /* ---------------- экраны ---------------- */
  var TITLES ={ today: 'Сегодня', diary: 'Дневник', ai: 'ИИ-помощник', progress: 'Прогресс', profile: 'Профиль' };
  var SCREENS = ['today', 'diary', 'ai', 'progress', 'profile'];

  function render() {
    $('#screenTitle').textContent = TITLES[view.screen];
    SCREENS.forEach(function (s) {
      $('#screen-' + s).hidden = s !== view.screen;
    });
    $$('.tab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.screen === view.screen); });
    renderTop();
    if (view.screen === 'today') renderToday();
    if (view.screen === 'diary') renderDiary();
    if (view.screen === 'ai') renderAi();
    if (view.screen === 'progress') renderProgress();
    if (view.screen === 'profile') renderProfile();
    window.scrollTo(0, 0);
  }

  function renderTop() {
    var box = $('#topbarRight');
    if (view.screen === 'today' || view.screen === 'diary') {
      box.innerHTML = '<button class="chip" data-act="add-food">+ Еда</button>';
    } else if (view.screen === 'progress') {
      box.innerHTML = '<button class="chip" data-act="set-weight">+ Вес</button>';
    } else if (view.screen === 'ai') {
      box.innerHTML = '<button class="chip" data-act="clear-chat">Очистить</button>';
    } else {
      box.innerHTML = '';
    }
  }

  function activityRings(pKcal, pProt, pWat) {
    var W = 160, cx = 80, cy = 80;
    function ring(r, p, color, gap) {
      var c = 2 * Math.PI * r;
      var pp = Math.max(0, Math.min(1, p));
      var off = c - c * pp;
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color +
        '" stroke-width="' + gap + '" stroke-linecap="round"' +
        ' stroke-dasharray="' + (c * pp).toFixed(1) + ' ' + c.toFixed(1) + '"' +
        ' stroke-dashoffset="' + (c / 2).toFixed(1) + '"' +
        ' transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
    }
    return '<svg width="' + W + '" height="' + W + '" viewBox="0 0 ' + W + ' ' + W + '">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="70" fill="none" stroke="#fde8ea" stroke-width="10"/>' +
      ring(70, pKcal, '#ff3b30', 10) +
      '<circle cx="' + cx + '" cy="' + cy + '" r="56" fill="none" stroke="#dff1e1" stroke-width="10"/>' +
      ring(56, pProt, '#34c759', 10) +
      '<circle cx="' + cx + '" cy="' + cy + '" r="42" fill="none" stroke="#dceaff" stroke-width="10"/>' +
      ring(42, pWat, '#0a84ff', 10) +
      '</svg>';
  }

  function ring(pct, over, main, sub) {
    var r = 48, c = 2 * Math.PI * r;
    var p = Math.max(0, Math.min(1, pct));
    var stroke = over ? '#ff3b30' : 'url(#ringGrad)';
    return '<div class="ring">' +
      '<svg width="122" height="122" viewBox="0 0 118 118">' +
      '<defs>' +
      '<linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#34c759"/><stop offset="55%" stop-color="#2f9fe0"/><stop offset="100%" stop-color="#0a84ff"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<circle cx="59" cy="59" r="' + r + '" fill="none" stroke="#ececf0" stroke-width="11"/>' +
      '<circle cx="59" cy="59" r="' + r + '" fill="none" stroke="' + stroke + '" stroke-width="11" stroke-linecap="round" ' +
      'stroke-dasharray="' + (c * p).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 59 59)"/>' +
      '</svg>' +
      '<div class="ring-txt"><b>' + main + '</b><small>' + sub + '</small></div>' +
      '</div>';
  }

  function renderToday() {
    var t = totals(view.date);
    var tg = targets();
    var d = day(view.date);
    var over = t.kcal > t.budget;
    var pKcal = t.budget > 0 ? t.kcal / t.budget : 0;
    var pProt = tg.protein > 0 ? t.p / tg.protein : 0;
    var pWat = (S.settings.waterGoal || 2000) > 0 ? (d.water || 0) / (S.settings.waterGoal || 2000) : 0;

    var glasses = Math.round((S.settings.waterGoal || 2000) / (S.settings.waterStep || 250));
    var filled = Math.round((d.water || 0) / (S.settings.waterStep || 250));
    var water = '';
    for (var i = 0; i < glasses; i++) {
      water += '<button class="glass' + (i < filled ? ' on' : '') + '" data-act="water" data-i="' + i + '"></button>';
    }

    // быстрые продукты — последние уникальные
    var recent = [];
    var keys = Object.keys(S.days).sort().reverse();
    for (var a = 0; a < keys.length && recent.length < 6; a++) {
      var ms = S.days[keys[a]].meals || [];
      for (var b = ms.length - 1; b >= 0; b--) {
        if (!recent.some(function (r) { return r.name === ms[b].name; })) recent.push(ms[b]);
        if (recent.length >= 6) break;
      }
    }

    var html = '';

    html += '<div class="card rings-card">' +
      '<div class="rings-wrap">' +
      activityRings(pKcal, pProt, pWat) +
      '<div class="rings-center"><b>' + (over ? '+' + Math.abs(t.left) : t.left) + '</b><small>ккал</small>' +
      '<div class="rings-sub">' + (over ? 'перебор' : 'осталось') + '</div></div>' +
      '</div>' +
      '<div class="rings-legend">' +
      '<div class="leg"><span class="dot" style="background:#ff3b30"></span><div><b>' + t.kcal + '</b><span>из ' + t.budget + ' ккал</span></div></div>' +
      '<div class="leg"><span class="dot" style="background:#34c759"></span><div><b>' + t.p + 'г</b><span>белок из ' + tg.protein + 'г</span></div></div>' +
      '<div class="leg"><span class="dot" style="background:#0a84ff"></span><div><b>' + (d.water || 0) + '</b><span>вода из ' + S.settings.waterGoal + ' мл</span></div></div>' +
      '</div>' +
      '</div>';

    var planTitle, planText;
    if (t.left > 40) {
      planTitle = 'Осталось ' + t.left + ' ккал';
      planText = 'ИИ подберёт меню под этот остаток из твоей базы продуктов и сразу посчитает КБЖУ.';
    } else if (t.left >= 0) {
      planTitle = 'Осталось всего ' + t.left + ' ккал';
      planText = 'Почти ничего не осталось. Добавь тренировку — и появится запас.';
    } else {
      planTitle = 'Перебор на ' + Math.abs(t.left) + ' ккал';
      planText = 'Сегодня норма превышена. Закрой день и начни завтра заново — один день ничего не решает.';
    }
    html += '<div class="card ai-hint">' +
      '<div class="card-title"><span class="badge-ai">ИИ</span></div>' +
      '<div style="font-size:17px;font-weight:600;letter-spacing:-.3px;margin-bottom:4px">' + planTitle + '</div>' +
      '<div class="small muted" style="line-height:1.5;margin-bottom:11px">' + planText + '</div>' +
      '<button class="btn" data-act="plan-meal">Что мне съесть?</button>' +
      '</div>';

    html += '<div class="card"><div class="card-title">Белки · Жиры · Углеводы</div><div class="bars">' +
      bar('Белок', t.p, tg.protein, 'г', '#34c759') +
      bar('Жиры', t.f, tg.fat, 'г', '#ff9f0a') +
      bar('Углев.', t.c, tg.carbs, 'г', '#0a84ff') +
      '</div></div>';

    html += '<div class="card"><div class="card-title"><span>Вода</span><span class="mono">' + (d.water || 0) + ' / ' + S.settings.waterGoal + ' мл</span></div>' +
      '<div class="water-row">' + water + '</div>' +
      '<div class="btn-row" style="margin-top:12px">' +
      '<button class="btn secondary" data-act="water-minus">− ' + S.settings.waterStep + ' мл</button>' +
      '<button class="btn" data-act="water-plus">+ ' + S.settings.waterStep + ' мл</button>' +
      '</div></div>';

    html += '<div class="card"><div class="card-title"><span>Вес сегодня</span></div>' +
      '<div class="row"><div class="big mono">' + (d.weight ? d.weight + ' кг' : '—') + '</div>' +
      '<button class="chip" data-act="set-weight">Записать</button></div>' +
      '<div class="small muted" style="margin-top:6px">Цель: ' + S.profile.goalWeight + ' кг · старт: ' + S.profile.startWeight + ' кг</div>' +
      '</div>';

    if (recent.length) {
      html += '<div class="card"><div class="card-title">Быстро добавить</div><div class="water-row">' +
        recent.map(function (m, i) {
          return '<button class="chip" data-act="quick" data-i="' + i + '">' + esc(m.name) + ' · ' + m.grams + ' г</button>';
        }).join('') + '</div></div>';
    }

    html += '<div class="card"><div class="card-title">Тренировка</div>' +
      '<div class="row"><div class="mono big">' + (d.burn || 0) + ' <span style="font-size:14px;color:var(--muted);font-weight:500">ккал</span></div>' +
      '<button class="chip" data-act="add-burn">Изменить</button></div></div>';

    $('#screen-today').innerHTML = html;
    $('#screen-today')._recent = recent;
  }

  function bar(name, val, goal, unit, color) {
    var p = goal > 0 ? Math.min(1, val / goal) : 0;
    return '<div class="bar-line"><span class="name">' + name + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="width:' + (p * 100).toFixed(0) + '%;background:' + color + '"></span></span>' +
      '<span class="val mono">' + val + ' / ' + goal + ' ' + unit + '</span></div>';
  }

  function renderDiary() {
    var d = day(view.date);
    var t = totals(view.date);
    var html = '';
    html += '<div class="daynav">' +
      '<button class="icon-btn" data-act="day-prev">‹</button>' +
      '<div class="date">' + prettyDate(view.date) + (view.date === dateKey(new Date()) ? ' · сегодня' : '') + '</div>' +
      '<button class="icon-btn" data-act="day-next">›</button>' +
      '</div>';
    html += '<div class="card"><div class="card-title"><span>Итого за день</span><span class="mono">' + t.kcal + ' ккал</span></div>' +
      '<div class="small muted mono">Б ' + t.p + ' г · Ж ' + t.f + ' г · У ' + t.c + ' г · осталось ' + t.left + ' ккал</div></div>';

    var any = false;
    MEALS.forEach(function (m) {
      var items = d.meals.filter(function (x) { return x.meal === m.id; });
      if (!items.length) return;
      any = true;
      var sum = items.reduce(function (a, x) { return a + x.kcal; }, 0);
      html += '<div class="card meal"><div class="meal-head"><span>' + m.name + '</span><span class="mono">' + Math.round(sum) + ' ккал</span></div>';
      items.forEach(function (x) {
        any = true;
        html += '<div class="food-item"><div class="food-main"><div class="food-name">' + esc(x.name) + '</div>' +
          '<div class="food-sub mono">' + x.grams + ' г · Б ' + x.p + ' · Ж ' + x.f + ' · У ' + x.c + '</div></div>' +
          '<div class="food-kcal mono">' + Math.round(x.kcal) + '</div>' +
          '<button class="icon-btn" data-act="del" data-id="' + x.id + '">✕</button></div>';
      });
      html += '</div>';
    });
    if (!any) html += '<div class="card"><div class="empty">Пока ничего не добавлено.<br>Нажми «+ Еда» сверху.</div></div>';

    html += '<div class="btn-row" style="margin:4px 0 16px"><button class="btn secondary" data-act="day-today">К сегодня</button>' +
      '<button class="btn" data-act="add-food">Добавить еду</button></div>';

    $('#screen-diary').innerHTML = html;
  }

  function renderProgress() {
    var pts = [];
    Object.keys(S.days).sort().forEach(function (k) {
      if (S.days[k].weight) pts.push({ k: k, w: Number(S.days[k].weight) });
    });
    var cur = lastWeight();
    var start = Number(S.profile.startWeight) || (pts[0] ? pts[0].w : cur);
    var goal = Number(S.profile.goalWeight);
    var lost = n1(start - cur);
    var toGo = n1(cur - goal);

    var html = '';
    html += '<div class="card"><div class="card-title">Вес</div>' +
      '<div class="row"><div class="big mono">' + cur + ' <span style="font-size:16px">кг</span></div>' +
      '<div style="text-align:right"><div class="mono" style="color:var(--green);font-weight:600">−' + (lost > 0 ? lost : 0) + ' кг</div>' +
      '<div class="small muted">от старта ' + start + ' кг</div></div></div>' +
      '<div class="bar-track" style="margin-top:12px"><span class="bar-fill" style="width:' +
      (start !== goal ? Math.max(0, Math.min(100, ((start - cur) / (start - goal)) * 100)).toFixed(0) : 100) + '%"></span></div>' +
      '<div class="small muted" style="margin-top:6px">До цели: ' + (toGo > 0 ? toGo : 0) + ' кг</div></div>';

    html += '<div class="stat-grid" style="margin-bottom:12px">' +
      stat('Серия', streak() + ' дн.') +
      stat('Записей веса', pts.length) +
      stat('Ср. за 7 дн.', avg7(pts) ? avg7(pts) + ' кг' : '—') +
      stat('Темп / нед', pace(pts)) +
      '</div>';

    html += '<div class="card"><div class="card-title"><span>График веса</span></div>' +
      '<div class="chart-wrap">' + chart(pts.slice(-30)) + '</div></div>';

    if (pts.length) {
      var rows = pts.slice().reverse().slice(0, 14).map(function (p) {
        return '<div class="food-item"><div class="food-main"><div class="food-name mono">' + p.w + ' кг</div>' +
          '<div class="food-sub">' + prettyDate(p.k) + '</div></div>' +
          '<button class="icon-btn" data-act="del-weight" data-k="' + p.k + '">✕</button></div>';
      }).join('');
      html += '<div class="card"><div class="card-title">История взвешиваний</div>' + rows + '</div>';
    } else {
      html += '<div class="card"><div class="empty">Нет записей веса. Нажми «+ Вес».</div></div>';
    }

    $('#screen-progress').innerHTML = html;
  }

  function stat(label, val) { return '<div class="stat"><b>' + val + '</b><span>' + label + '</span></div>'; }

  function avg7(pts) {
    var today = dateKey(new Date());
    var sum = 0, cnt = 0;
    for (var i = 0; i < 7; i++) {
      var k = addDays(today, -i);
      var hit = pts.filter(function (p) { return p.k === k; })[0];
      if (hit) { sum += hit.w; cnt++; }
    }
    return cnt ? n1(sum / cnt) : 0;
  }
  function pace(pts) {
    if (pts.length < 2) return '—';
    var first = pts[0], last = pts[pts.length - 1];
    var d1 = new Date(first.k.split('-').map(Number)[0], first.k.split('-').map(Number)[1] - 1, first.k.split('-').map(Number)[2]);
    var d2 = new Date(last.k.split('-').map(Number)[0], last.k.split('-').map(Number)[1] - 1, last.k.split('-').map(Number)[2]);
    var weeks = (d2 - d1) / (7 * 864e5);
    if (weeks < 0.3) return '—';
    var v = (last.w - first.w) / weeks;
    return (v > 0 ? '+' : '') + n1(v) + ' кг';
  }

  function chart(pts) {
    if (pts.length < 2) {
      return '<div class="empty">Нужно минимум два взвешивания</div>';
    }
    var W = 320, H = 150, padL = 30, padR = 8, padT = 12, padB = 20;
    var ws = pts.map(function (p) { return p.w; });
    var min = Math.min.apply(null, ws), max = Math.max.apply(null, ws);
    if (max - min < 1) { min -= 0.5; max += 0.5; }
    var padY = (max - min) * 0.15; min -= padY; max += padY;
    function x(i) { return padL + (i * (W - padL - padR)) / (pts.length - 1); }
    function y(v) { return padT + (1 - (v - min) / (max - min)) * (H - padT - padB); }

    var line = pts.map(function (p, i) { return x(i).toFixed(1) + ',' + y(p.w).toFixed(1); }).join(' ');
    var area = 'M' + x(0).toFixed(1) + ',' + (H - padB) + ' L' + line.split(' ').join(' L') + ' L' + x(pts.length - 1).toFixed(1) + ',' + (H - padB) + ' Z';
    var dots = pts.map(function (p, i) {
      return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.w).toFixed(1) + '" r="2.6" fill="#0a84ff"/>';
    }).join('');
    var labels = [0, Math.floor(pts.length / 2), pts.length - 1].map(function (i) {
      var short = pts[i].k.split('-');
      return '<text x="' + x(i).toFixed(1) + '" y="' + (H - 5) + '" font-size="9" fill="#8a8a8e" text-anchor="middle">' + short[2] + '.' + short[1] + '</text>';
    }).join('');
    var grid = [min, (min + max) / 2, max].map(function (v) {
      return '<line x1="' + padL + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(v).toFixed(1) + '" stroke="#ececf0" stroke-width="1"/>' +
        '<text x="0" y="' + (y(v) + 3).toFixed(1) + '" font-size="9" fill="#8a8a8e">' + n1(v) + '</text>';
    }).join('');

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" height="150">' +
      grid +
      '<path d="' + area + '" fill="rgba(10,132,255,0.10)"/>' +
      '<polyline points="' + line + '" fill="none" stroke="#0a84ff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + labels + '</svg>';
  }

  function renderProfile() {
    var p = S.profile, tg = targets();
    var standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

    var html = '';
    if (!standalone) {
      html += '<div class="card"><div class="card-title">Установить на iPhone</div><div class="install-box">' +
        'Открой эту страницу в <b>Safari</b>, затем:' +
        '<ol><li>Нажми кнопку «Поделиться» (квадрат со стрелкой внизу)</li>' +
        '<li>Прокрути и выбери <b>«На экран Домой»</b></li>' +
        '<li>Нажми «Добавить»</li></ol>' +
        '<div class="small muted" style="margin-top:8px">После этого приложение откроется без адресной строки и будет работать офлайн.</div>' +
        '</div></div>';
    }

    html += '<div class="card"><div class="card-title">Твоя норма</div>' +
      '<div class="row"><div class="mono"><b>' + tg.target + '</b> ккал/день</div><div class="small muted mono">дефицит ' + p.deficit + '</div></div>' +
      '<div class="small muted" style="margin-top:8px">BMR ' + tg.bmr + ' · TDEE ' + tg.tdee + ' · белок ' + tg.protein + ' г · жиры ' + tg.fat + ' г</div></div>';

    html += '<div class="card"><div class="card-title">Тело и цель</div>' +
      '<div class="grid2">' +
      field('Пол', select('sex', [['male', 'Мужской'], ['female', 'Женский']], p.sex)) +
      field('Возраст', '<input type="number" inputmode="numeric" id="f-age" value="' + p.age + '">') +
      field('Рост, см', '<input type="number" inputmode="numeric" id="f-height" value="' + p.height + '">') +
      field('Стартовый вес, кг', '<input type="number" step="0.1" inputmode="decimal" id="f-start" value="' + p.startWeight + '">') +
      field('Цель, кг', '<input type="number" step="0.1" inputmode="decimal" id="f-goal" value="' + p.goalWeight + '">') +
      field('Дефицит, ккал', '<input type="number" inputmode="numeric" id="f-deficit" value="' + p.deficit + '">') +
      '</div>' +
      field('Активность', select('activity', ACTIVITY.map(function (a) { return [a.v, a.label]; }), p.activity)) +
      '<div class="btn-row" style="margin-top:6px"><button class="btn" data-act="save-profile">Сохранить</button></div></div>';

    html += aiSettingsCard();

    html += '<div class="card"><div class="card-title">Вода</div>' +
      field('Цель, мл', '<input type="number" inputmode="numeric" id="f-water" value="' + S.settings.waterGoal + '">') +
      field('Объём стакана, мл', '<input type="number" inputmode="numeric" id="f-step" value="' + S.settings.waterStep + '">') +
      '<button class="btn" data-act="save-water">Сохранить</button></div>';

    html += '<div class="card"><div class="card-title">Данные</div>' +
      '<div class="small muted" style="margin-bottom:10px">Всё хранится только в этом браузере. Если Safari почистит кэш — данные пропадут, поэтому иногда делай экспорт.</div>' +
      '<div class="btn-row"><button class="btn secondary" data-act="export">Экспорт JSON</button>' +
      '<button class="btn secondary" data-act="import">Импорт</button></div>' +
      '<button class="btn secondary" data-act="my-foods" style="margin-top:8px">Мои продукты (' + (S.custom || []).length + ')</button>' +
      '<button class="btn secondary" data-act="restart-onboard" style="margin-top:8px">Пройти настройку заново</button>' +
      '<button class="btn danger" data-act="reset" style="margin-top:8px">Сбросить всё</button>' +
      (S.meta && S.meta.lastExport ? '<div class="small muted" style="margin-top:8px">Последний экспорт: ' + S.meta.lastExport + '</div>' : '') +
      '</div>';

    html += '<div class="card"><div class="warn"><b>Важно:</b> это не медицинский инструмент. Нормы рассчитаны по формуле Миффлина–Сан Жеора и подходят большинству здоровых взрослых. При заболеваниях, беременности или приёме лекарств — сначала врач.</div></div>';

    $('#screen-profile').innerHTML = html;
  }

  function aiSettingsCard() {
    var a = S.ai;
    var def = PROVIDERS[a.provider] || PROVIDERS.openrouter;
    var opts = Object.keys(PROVIDERS).map(function (k) { return [k, PROVIDERS[k].name]; });
    return '<div class="card"><div class="card-title"><span class="badge-ai">ИИ</span></div>' +
      field('Провайдер', select('ai-provider', opts, a.provider)) +
      (a.provider === 'custom'
        ? field('URL API (без /chat/completions)', '<input id="f-aibase" placeholder="https://мой-прокси/v1" value="' + esc(a.base) + '">')
        : '') +
      field('Модель чата', '<input id="f-aimodel" placeholder="' + esc(def.model) + '" value="' + esc(a.model) + '">') +
      field('Модель для фото (vision)', '<input id="f-aivision" placeholder="qwen/qwen3.7-flash" value="' + esc(a.visionModel) + '">') +
      field('API-ключ', '<input id="f-aikey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-or-…" value="' + esc(a.key) + '">') +
      '<div class="btn-row"><button class="btn" data-act="save-ai">Сохранить</button>' +
      '<button class="btn secondary" data-act="test-ai">Проверить</button></div>' +
      '<div style="height:8px"></div><button class="btn secondary" data-act="clear-chat">Очистить чат с ИИ</button>' +
      '<div class="small muted" style="margin-top:10px">' +
      'Ключ лежит только в IndexedDB этого браузера — никуда не уходит. ' +
      'Бесплатный ключ: <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a> → Create Key → пополнить на $5.' +
      ' Модель по умолчанию: <b>qwen/qwen3.7-flash</b> (чат и фото — она умеет и то, и другое).' +
      '</div>' +
      '</div>';
  }

  function field(label, input) {
    return '<label class="field"><span>' + label + '</span>' + input + '</label>';
  }
  function select(id, opts, val) {
    return '<select id="f-' + id + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }

  /* ---------------- модалка ---------------- */
  var sheetState = { mode: '', food: null, meal: 'snack' };

  function openSheet(title, html) {
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = html;
    $('#sheet').hidden = false;
    $('#sheetBackdrop').hidden = false;
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    $('#sheetBackdrop').hidden = true;
    sheetState = { mode: '', food: null, meal: 'snack' };
  }
  function refreshSheet() {
    var q = ($('#foodSearch') && $('#foodSearch').value || '').trim().toLowerCase();
    if (sheetState.mode === 'search') renderSearchSheet(q);
    else if (sheetState.mode === 'detail') renderDetailSheet();
  }

  function guessMeal() {
    var h = new Date().getHours();
    if (h < 11) return 'breakfast';
    if (h < 15) return 'lunch';
    if (h < 21) return 'dinner';
    return 'snack';
  }

  function openAddFood() {
    sheetState.mode = 'search';
    sheetState.meal = guessMeal();
    openSheet('Добавить еду', '');
    renderSearchSheet('');
  }

  function renderSearchSheet(q) {
    q = (q || '').toLowerCase();
    var list = allFoods();
    if (q) list = list.filter(function (f) { return f.n.toLowerCase().indexOf(q) >= 0; });
    list = list.slice(0, 60);

    var res = document.getElementById('searchResults');
    if (!res) {
      openSheet('Добавить еду',
        '<input id="foodSearch" placeholder="Поиск: курица, рис, яблоко…" autocomplete="off">' +
        '<div style="height:10px"></div>' +
        '<button class="btn secondary" data-act="custom-food">+ Свой продукт</button>' +
        '<div id="searchResults"></div>');
      var inp = $('#foodSearch');
      inp.addEventListener('input', function () { renderSearchSheet(this.value); });
      inp.focus();
      res = $('#searchResults');
    }

    var html = '';
    if (!list.length) {
      html = '<div class="empty">Ничего не найдено. Добавь свой продукт.</div>';
    } else {
      var lastGroup = '';
      list.forEach(function (f, i) {
        if (f.g && f.g !== lastGroup) { lastGroup = f.g; html += '<div class="group-title">' + esc(f.g) + '</div>'; }
        html += '<div class="food-row"><div class="food-main"><div class="food-name">' + esc(f.n) + '</div>' +
          '<div class="kcal mono">' + f.k + ' ккал / 100 г</div></div>' +
          '<button class="chip" data-act="pick" data-i="' + i + '">Выбрать</button></div>';
      });
    }
    res.innerHTML = html;
  }
  function moveCursorEnd(el) {
    var v = el.value; el.value = ''; el.value = v;
    try { el.setSelectionRange(v.length, v.length); } catch (e) {}
  }

  function renderDetailSheet() {
    var f = sheetState.food;
    var grams = Number($('#gramsInput') ? $('#gramsInput').value : 100) || 0;
    var mul = grams / 100;
    var kcal = Math.round(f.k * mul);

    if (!document.getElementById('gramsInput')) {
      var html = '';
      html += '<div class="card"><div class="food-name" style="font-size:17px;font-weight:600">' + esc(f.n) + '</div>' +
        '<div class="small muted mono">' + f.k + ' ккал / 100 г</div></div>';

      html += '<div class="card"><div class="field">' +
        '<span>Вес порции, г</span>' +
        '<input type="number" inputmode="decimal" id="gramsInput" value="' + grams + '">' +
        '</div>' +
        '<div class="water-row" style="margin-top:8px">' +
        [50, 100, 150, 200, 250, 300].map(function (g) { return '<button class="chip" data-act="set-grams" data-g="' + g + '">' + g + ' г</button>'; }).join('') +
        '</div></div>';

      html += '<div class="card"><div class="card-title">Приём пищи</div><div class="water-row" id="mealChips">' +
        MEALS.map(function (m) {
          return '<button class="chip' + (sheetState.meal === m.id ? ' is-on' : '') + '" data-act="set-meal" data-m="' + m.id + '">' + m.name + '</button>';
        }).join('') + '</div></div>';

      html += '<div class="card" id="kcalResult"><div class="row"><div><div class="big mono">' + kcal + ' <span style="font-size:14px">ккал</span></div>' +
        '<div class="small muted mono" id="macros">Б ' + n1(f.p * mul) + ' · Ж ' + n1(f.f * mul) + ' · У ' + n1(f.c * mul) + '</div></div></div></div>';

      html += '<button class="btn" data-act="confirm-add">Добавить в дневник</button><div style="height:10px"></div>';

      openSheet('Порция', html);
      var gi = $('#gramsInput');
      gi.addEventListener('input', renderDetailSheet);
      gi.focus();
      return;
    }

    // Обновляем только блок расчёта
    var big = $('#kcalResult .big');
    var macros = $('#macros');
    if (big) big.innerHTML = kcal + ' <span style="font-size:14px">ккал</span>';
    if (macros) macros.textContent = 'Б ' + n1(f.p * mul) + ' · Ж ' + n1(f.f * mul) + ' · У ' + n1(f.c * mul) + ' г';
  }

  function openCustomFood() {
    sheetState.mode = 'custom';
    openSheet('Свой продукт',
      field('Название', '<input id="cf-name" placeholder="Например: борщ бабушки">') +
      '<div class="grid2">' +
      field('ккал / 100 г', '<input type="number" inputmode="numeric" id="cf-k">') +
      field('Белки', '<input type="number" step="0.1" inputmode="decimal" id="cf-p">') +
      field('Жиры', '<input type="number" step="0.1" inputmode="decimal" id="cf-f">') +
      field('Углеводы', '<input type="number" step="0.1" inputmode="decimal" id="cf-c">') +
      '</div>' +
      '<div class="small muted" style="margin-bottom:10px">Значения на 100 г продукта. Можно указать «на порцию», если потом всегда ставить 100 г.</div>' +
      '<button class="btn" data-act="save-custom">Сохранить продукт</button>');
  }

  function openWeight() {
    sheetState.mode = 'weight';
    var cur = day(view.date).weight || '';
    openSheet('Вес за ' + prettyDate(view.date).toLowerCase(),
      field('Вес, кг', '<input type="number" step="0.1" inputmode="decimal" id="w-val" value="' + cur + '">') +
      '<button class="btn" data-act="save-weight">Сохранить</button>' +
      '<div style="height:8px"></div><button class="btn secondary" data-act="close-sheet">Отмена</button>');
    var el = $('#w-val'); if (el) el.focus();
  }

  function openBurn() {
    sheetState.mode = 'burn';
    openSheet('Тренировка',
      field('Сколько сжёг, ккал', '<input type="number" inputmode="numeric" id="b-val" value="' + (day(view.date).burn || 0) + '">') +
      '<div class="water-row" style="margin-bottom:12px">' +
      [100, 200, 300, 400, 500, 700].map(function (v) { return '<button class="chip" data-act="set-burn" data-v="' + v + '">' + v + '</button>'; }).join('') +
      '</div><button class="btn" data-act="save-burn">Сохранить</button>');
    var el = $('#b-val'); if (el) el.focus();
  }

  function openMyFoods() {
    sheetState.mode = 'myfoods';
    var list = S.custom || [];
    if (!list.length) {
      openSheet('Мои продукты', '<div class="empty">Пока пусто</div>' +
        '<button class="btn secondary" data-act="custom-food">+ Добавить продукт</button>');
      return;
    }
    openSheet('Мои продукты', list.map(function (f, i) {
      return '<div class="food-row"><div class="food-main"><div class="food-name">' + esc(f.n) + '</div>' +
        '<div class="kcal mono">' + f.k + ' ккал · Б ' + f.p + ' · Ж ' + f.f + ' · У ' + f.c + '</div></div>' +
        '<button class="icon-btn" data-act="del-custom" data-i="' + i + '">✕</button></div>';
    }).join('') + '<div style="height:10px"></div><button class="btn secondary" data-act="custom-food">+ Добавить продукт</button>');
  }

  /* ---------------- действия ---------------- */
  function addEntry(food, grams, meal) {
    var mul = grams / 100;
    day(view.date).meals.push({
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
      name: food.n, grams: grams, meal: meal,
      kcal: food.k * mul, p: food.p * mul, f: food.f * mul, c: food.c * mul
    });
    save();
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (el) {
      var act = el.dataset.act;

      if (act === 'add-food') return openAddFood();
      if (act === 'custom-food') return openCustomFood();
      if (act === 'my-foods') return openMyFoods();
      if (act === 'set-weight') return openWeight();
      if (act === 'add-burn') return openBurn();
      if (act === 'close-sheet') return closeSheet();

      if (act === 'pick') {
        var list = allFoods();
        var q = ($('#foodSearch') && $('#foodSearch').value || '').trim().toLowerCase();
        if (q) list = list.filter(function (f) { return f.n.toLowerCase().indexOf(q) >= 0; });
        sheetState.food = list.slice(0, 60)[Number(el.dataset.i)];
        sheetState.mode = 'detail';
        return renderDetailSheet();
      }
      if (act === 'set-grams') {
        var gi = document.getElementById('gramsInput');
        if (gi) {
          gi.value = el.dataset.g;
          renderDetailSheet();
        }
        return;
      }
      if (act === 'set-meal') { sheetState.meal = el.dataset.m; return renderDetailSheet(); }
      if (act === 'confirm-add') {
        var g = Number($('#gramsInput').value) || 0;
        if (g <= 0) return toast('Укажи вес порции');
        addEntry(sheetState.food, g, sheetState.meal);
        closeSheet(); render();
        return toast('Добавлено');
      }
      if (act === 'save-custom') {
        var name = ($('#cf-name').value || '').trim();
        if (!name) return toast('Введи название');
        S.custom = S.custom || [];
        S.custom.push({
          n: name,
          k: Number($('#cf-k').value) || 0,
          p: Number($('#cf-p').value) || 0,
          f: Number($('#cf-f').value) || 0,
          c: Number($('#cf-c').value) || 0,
          g: 'Мои продукты'
        });
        save(); closeSheet(); render();
        return toast('Продукт сохранён');
      }
      if (act === 'del-custom') {
        S.custom.splice(Number(el.dataset.i), 1);
        save(); return openMyFoods();
      }
      if (act === 'del') {
        var d = day(view.date);
        d.meals = d.meals.filter(function (m) { return m.id !== el.dataset.id; });
        save(); return render();
      }
      if (act === 'del-weight') {
        delete S.days[el.dataset.k].weight;
        save(); return render();
      }
      if (act === 'water') {
        var step = S.settings.waterStep || 250;
        var idx = Number(el.dataset.i);
        var cur = day(view.date).water || 0;
        day(view.date).water = (idx * step === cur) ? Math.max(0, cur - step) : (idx + 1) * step;
        save(); return render();
      }
      if (act === 'water-plus') {
        day(view.date).water = (day(view.date).water || 0) + (S.settings.waterStep || 250);
        save(); return render();
      }
      if (act === 'water-minus') {
        day(view.date).water = Math.max(0, (day(view.date).water || 0) - (S.settings.waterStep || 250));
        save(); return render();
      }
      if (act === 'save-weight') {
        var v = Number($('#w-val').value);
        if (!v || v < 20 || v > 400) return toast('Введи корректный вес');
        day(view.date).weight = n1(v);
        save(); closeSheet(); render();
        return toast('Вес сохранён');
      }
      if (act === 'set-burn') { $('#b-val').value = el.dataset.v; return; }
      if (act === 'save-burn') {
        day(view.date).burn = Number($('#b-val').value) || 0;
        save(); closeSheet(); render();
        return toast('Сохранено');
      }
      if (act === 'quick') {
        var r = $('#screen-today')._recent[Number(el.dataset.i)];
        if (r) {
          addEntry({ n: r.name, k: (r.kcal / r.grams) * 100, p: (r.p / r.grams) * 100, f: (r.f / r.grams) * 100, c: (r.c / r.grams) * 100 }, r.grams, guessMeal());
          render();
          return toast('Добавлено');
        }
      }
      if (act === 'day-prev') { view.date = addDays(view.date, -1); return render(); }
      if (act === 'day-next') { view.date = addDays(view.date, 1); return render(); }
      if (act === 'day-today') { view.date = dateKey(new Date()); return render(); }
      if (act === 'save-profile') {
        S.profile.sex = $('#f-sex').value;
        S.profile.age = Number($('#f-age').value) || S.profile.age;
        S.profile.height = Number($('#f-height').value) || S.profile.height;
        S.profile.startWeight = Number($('#f-start').value) || S.profile.startWeight;
        S.profile.goalWeight = Number($('#f-goal').value) || S.profile.goalWeight;
        S.profile.activity = Number($('#f-activity').value);
        S.profile.deficit = Number($('#f-deficit').value);
        save(); render();
        return toast('Профиль сохранён');
      }
      if (act === 'save-water') {
        S.settings.waterGoal = Number($('#f-water').value) || 2000;
        S.settings.waterStep = Number($('#f-step').value) || 250;
        save(); render();
        return toast('Сохранено');
      }
      if (act === 'ob-sex') { S.profile.sex = el.dataset.v; return renderOnboard(); }
      if (act === 'ob-activity') { S.profile.activity = Number(el.dataset.v); return renderOnboard(); }
      if (act === 'ob-deficit') { S.profile.deficit = Number(el.dataset.v); return renderOnboard(); }
      if (act === 'restart-onboard') {
        if (confirm('Пройти настройку сначала? Текущий профиль будет перезаписан.')) return startOnboard();
        return;
      }
      if (act === 'plan-meal') return openPlan();
      if (act === 'plan-retry') return openPlan();
      if (act === 'plan-del') {
        plan.items.splice(Number(el.dataset.i), 1);
        if (!plan.items.length) return closeSheet();
        return renderPlanSheet();
      }
      if (act === 'plan-add') {
        if (!plan.items.length) return closeSheet();
        plan.items.forEach(function (it) {
          day(view.date).meals.push({
            id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
            name: it.name, grams: it.grams, meal: it.meal,
            kcal: it.kcal, p: it.p, f: it.fat, c: it.c
          });
        });
        save(); closeSheet();
        view.screen = 'today';
        render();
        return toast('Меню добавлено в дневник');
      }
      if (act === 'take-photo') { var ci = document.getElementById('photoCamera'); if (ci) ci.click(); return; }
      if (act === 'pick-photo') { var gi2 = document.getElementById('photoGallery'); if (gi2) gi2.click(); return; }
      if (act === 'quick-ai') return sendChat(QUICK[Number(el.dataset.i)]);
      if (act === 'send-chat') return sendChat();
      if (act === 'goto-ai-settings') { view.screen = 'profile'; render(); return; }
      if (act === 'clear-chat') {
        if (S.chat.length && !confirm('Удалить историю чата с ИИ?')) return;
        S.chat = []; save();
        if (view.screen === 'ai') render(); else toast('Чат очищен');
        return;
      }
      if (act === 'save-ai') {
        S.ai.provider = $('#f-ai-provider').value;
        S.ai.model = ($('#f-aimodel').value || '').trim();
        S.ai.visionModel = ($('#f-aivision').value || '').trim();
        S.ai.key = ($('#f-aikey').value || '').trim();
        if ($('#f-aibase')) S.ai.base = ($('#f-aibase').value || '').trim();
        if (!S.ai.model) S.ai.model = (PROVIDERS[S.ai.provider] || PROVIDERS.openrouter).model;
        save(); render();
        return toast('Сохранено');
      }
      if (act === 'test-ai') {
        var tcfg = aiCfg();
        if (!tcfg.key) return toast('Введи ключ');
        if (!tcfg.base) return toast('Укажи URL');
        toast('Проверяю…');
        aiCall([{ role: 'user', content: 'Ответь одним словом: ок' }], tcfg.model)
          .then(function (r) { toast('Работает: ' + String(r).trim().slice(0, 40)); })
          .catch(function (e2) { toast(errText(e2)); });
        return;
      }
      if (act === 'photo-del') {
        photo.items.splice(Number(el.dataset.i), 1);
        if (!photo.items.length) return closeSheet();
        return renderPhotoSheet();
      }
      if (act === 'photo-meal') { photo.meal = el.dataset.m; return renderPhotoSheet(); }
      if (act === 'photo-add') {
        if (!photo.items.length) return closeSheet();
        photo.items.forEach(function (it) {
          day(view.date).meals.push({
            id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
            name: it.name, grams: it.grams, meal: photo.meal,
            kcal: it.kcal, p: it.p, f: it.f, c: it.c
          });
        });
        save(); closeSheet();
        view.screen = 'today';
        render();
        return toast('Добавлено: ' + photo.items.length + ' поз.');
      }
      if (act === 'export') return doExport();
      if (act === 'import') return $('#fileInput').click();
      if (act === 'reset') {
        if (confirm('Удалить все данные (дневник, вес, продукты)?')) {
          localStorage.removeItem(KEY);
          S = defState(); save(); render();
          toast('Сброшено');
        }
        return;
      }
    }

    var tab = e.target.closest('.tab');
    if (tab) {
      view.screen = tab.dataset.screen;
      if (view.screen === 'today') view.date = dateKey(new Date());
      return render();
    }
    if (e.target.id === 'sheetClose' || e.target.id === 'sheetBackdrop') return closeSheet();
  });

  function doExport() {
    var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'slimtrack-' + dateKey(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    S.meta.lastExport = dateKey(new Date());
    save(); render();
    toast('Файл сохранён');
  }

  // скрытый input для импорта
  var fi = document.createElement('input');
  fi.type = 'file'; fi.accept = 'application/json,.json'; fi.id = 'fileInput';
  fi.style.display = 'none';
  document.body.appendChild(fi);
  fi.addEventListener('change', function () {
    var file = fi.files[0];
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var data = JSON.parse(fr.result);
        if (!data.profile || !data.days) throw 0;
        if (confirm('Заменить текущие данные загруженными?')) {
          S = data;
          if (!S.settings) S.settings = { waterGoal: 2000, waterStep: 250 };
          if (!S.custom) S.custom = [];
          save(); render();
          toast('Данные загружены');
        }
      } catch (err) { toast('Не удалось прочитать файл'); }
      fi.value = '';
    };
    fr.readAsText(file);
  });

  /* ---------------- привязка камеры ---------------- */
  ['photoCamera', 'photoGallery'].forEach(function (id) {
    var inp = document.getElementById(id);
    if (!inp) return;
    inp.addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      handlePhoto(f);
    });
  });

  /* Enter отправляет, Shift+Enter — перенос строки */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'chatInput') {
      e.preventDefault();
      sendChat();
    }
    if (e.key === 'Enter' && document.getElementById('onboard') && !document.getElementById('onboard').hidden) {
      if (e.target && e.target.classList && e.target.classList.contains('ob-num')) {
        e.preventDefault();
        e.target.blur();
        obNext();
      }
    }
  });

  var obBtn = document.getElementById('obNext');
  if (obBtn) obBtn.addEventListener('click', obNext);
})();
