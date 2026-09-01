/* Smoke-тест: прогоняем приложение в jsdom без браузера.
   Запуск: node smoke-test.js  (нужен jsdom, NODE_PATH на workspace) */
const fs = require('fs');
const path = require('path');

const { JSDOM } = require('jsdom');
const DIR = __dirname;

const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8')
  .replace(/<script src="[^"]*"><\/script>/g, '')
  .replace(/<script>[\s\S]*?<\/script>/g, '');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const calls = [];
const errors = [];

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    window.scrollTo = () => {};
    window.confirm = () => true;
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    window.URL.createObjectURL = () => 'blob:fake';
    window.URL.revokeObjectURL = () => {};

    const origCreate = window.document.createElement.bind(window.document);
    window.document.createElement = function (tag) {
      if (String(tag).toLowerCase() === 'canvas') {
        return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,AAAAFAKE' };
      }
      return origCreate(tag);
    };
    window.Image = function () {
      Object.defineProperty(this, 'src', { set() { setTimeout(() => this.onload && this.onload(), 0); }, get() { return ''; } });
      this.naturalWidth = 800; this.naturalHeight = 600;
    };

    window.fetch = function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push({ url, body, headers: opts.headers });
      const joined = JSON.stringify(body.messages || []);
      const isAnthropic = /\/messages$/.test(url);
      let payload;

      if (/image_url|"type":"image"/.test(joined)) {
        payload = JSON.stringify({
          dish: 'Куриная грудка с рисом',
          items: [
            { name: 'Куриное филе (грудка)', grams: 180, kcal: 203, p: 42, f: 3, c: 1 },
            { name: 'Рис варёный', grams: 150, kcal: 174, p: 4, f: 0, c: 38 }
          ],
          comment: 'Нормальная порция, около 377 ккал.'
        });
      } else if (/Составь меню на остаток дня/.test(joined)) {
        payload = JSON.stringify({
          plan: [
            { name: 'Куриное филе (грудка)', grams: 200, meal: 'dinner' },
            { name: 'Рис варёный', grams: 150, meal: 'dinner' }
          ],
          comment: 'Белка много, в остаток укладываешься.'
        });
      } else {
        payload = 'Держись в дефиците 400–500 ккал и набери белок.';
      }

      const chunks = isAnthropic
        ? ['event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: payload } }) + '\n\n']
        : ['data: ' + JSON.stringify({ choices: [{ delta: { content: payload } }] }) + '\n\n', 'data: [DONE]\n\n'];

      const all = chunks.join('');
      const enc = new TextEncoder();
      let sent = false;
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(all),
        body: {
          getReader() {
            return {
              read() {
                if (sent) return Promise.resolve({ done: true, value: undefined });
                sent = true;
                return Promise.resolve({ done: false, value: enc.encode(all) });
              }
            };
          }
        }
      });
    };
  }
});

const win = dom.window;
const doc = win.document;
win.addEventListener('error', (e) => errors.push(String(e.message || e.error)));
process.on('unhandledRejection', (r) => errors.push('unhandledRejection: ' + r));

function run(file) { win.eval(fs.readFileSync(path.join(DIR, file), 'utf8')); }
function click(sel) {
  const el = doc.querySelector(sel);
  if (!el) throw new Error('нет элемента ' + sel);
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
}
function text(sel) { const el = doc.querySelector(sel); return el ? el.textContent : ''; }
function fire(el, type) { el.dispatchEvent(new win.Event(type, { bubbles: true })); }
function setVal(sel, v) { const el = doc.querySelector(sel); if (!el) throw new Error('нет поля ' + sel); el.value = v; }

(async function main() {
  console.log('\n1. Онбординг (первый запуск)');
  run('foods.js');
  run('db.js');
  run('app.js');
  await sleep(50);
  ok('визард показан', doc.querySelector('#onboard').hidden === false);
  ok('шаг 1 — приветствие', /Давай познакомимся/.test(text('#obBody')));
  click('#obNext');

  ok('шаг 2 — пол и возраст', /Сколько тебе лет/.test(text('#obBody')));
  click('[data-act="ob-sex"][data-v="male"]');
  setVal('#ob-age', '30');
  click('#obNext');

  ok('шаг 3 — рост и вес', /Рост/.test(text('#obBody')));
  setVal('#ob-height', '175');
  setVal('#ob-weight', '80');
  click('#obNext');

  ok('шаг 4 — цель', /Хочу весить/.test(text('#obBody')));
  setVal('#ob-goal', '70');
  click('#obNext');

  ok('шаг 5 — активность', /активность/i.test(text('#obBody')));
  click('[data-act="ob-activity"][data-v="1.375"]');
  ok('активность выбрана', doc.querySelectorAll('.ob-card.on').length === 1);
  click('#obNext');

  ok('шаг 6 — темп', /С какой скоростью/.test(text('#obBody')));
  click('[data-act="ob-deficit"][data-v="500"]');
  click('#obNext');

  ok('шаг 7 — итог', /Твоя норма на день/.test(text('#obBody')));
  ok('норма посчитана верно (1900)', /1900/.test(text('#obBody')), text('#obBody').slice(0, 90));
  ok('макросы показаны', /белок/.test(text('#obBody')) && /жиры/.test(text('#obBody')));
  click('#obNext');
  ok('визард закрылся', doc.querySelector('#onboard').hidden === true);
  ok('главный экран отрисован', /осталось/.test(text('#screen-today')));
  ok('5 вкладок', doc.querySelectorAll('.tab').length === 5);
  ok('вес из визарда записан', /80 кг|80\b/.test(text('#screen-today')));

  console.log('\n2. Навигация');
  click('.tab[data-screen="diary"]');
  ok('дневник пуст', /ничего не добавлено/i.test(text('#screen-diary')));
  click('.tab[data-screen="progress"]');
  ok('прогресс открыт', /график веса|взвешивани/i.test(text('#screen-progress')));

  console.log('\n3. Подключение ИИ через интерфейс');
  click('.tab[data-screen="profile"]');
  ok('карточка ИИ на месте', /API-ключ/.test(text('#screen-profile')));
  ok('до конца визарда дошёл: есть «заново»', /Пройти настройку заново/.test(text('#screen-profile')));
  setVal('#f-aikey', 'sk-test-key');
  click('[data-act="save-ai"]');
  ok('ключ сохранён (поле не пустое)', doc.querySelector('#f-aikey').value === 'sk-test-key');

  console.log('\n4. Добавление еды вручную');
  click('.tab[data-screen="today"]');
  click('[data-act="add-food"]');
  const search = doc.querySelector('#foodSearch');
  search.value = 'курин';
  fire(search, 'input');
  ok('поиск нашёл курицу', /Куриное филе/.test(text('#searchResults')));
  click('#searchResults [data-act="pick"]');
  const gi = doc.querySelector('#gramsInput');
  gi.value = '200';
  fire(gi, 'input');
  ok('ккал пересчитались (~226)', /22[0-9]/.test(text('#kcalResult')), text('#kcalResult'));
  click('[data-act="confirm-add"]');
  click('.tab[data-screen="diary"]');
  ok('запись в дневнике', /Куриное филе/.test(text('#screen-diary')));

  console.log('\n5. Вода и вес');
  click('.tab[data-screen="today"]');
  click('[data-act="water-plus"]');
  click('[data-act="water-plus"]');
  ok('вода = 500 мл', /500 \/ 2000 мл/.test(text('#screen-today')));
  click('[data-act="set-weight"]');
  setVal('#w-val', '78.5');
  click('[data-act="save-weight"]');
  ok('вес сохранился', /78\.5 кг/.test(text('#screen-today')));

  console.log('\n6. ИИ-чат');
  click('.tab[data-screen="ai"]');
  setVal('#chatInput', 'Что съесть на ужин?');
  calls.length = 0;
  click('[data-act="send-chat"]');
  await sleep(60);
  ok('сообщение юзера в чате', /Что съесть на ужин\?/.test(text('#msgs')));
  await sleep(150);
  ok('ответ ИИ пришёл', /дефиците 400/.test(text('#msgs')), text('#msgs').slice(-100));
  const chatCall = calls.filter((c) => /chat\/completions$/.test(c.url)).pop();
  ok('ушло на /chat/completions', !!chatCall);
  ok('system-промпт с профилем', !!chatCall && /Норма: \d+ ккал/.test(chatCall.body.messages[0].content));
  ok('в промпте есть остаток', !!chatCall && /осталось/.test(chatCall.body.messages[0].content));
  ok('ключ как Bearer', !!chatCall && chatCall.headers.Authorization === 'Bearer sk-test-key');

  console.log('\n7. Фото → калории');
  const cam = doc.querySelector('#photoCamera');
  const file = new win.File(['x'], 'lunch.jpg', { type: 'image/jpeg' });
  Object.defineProperty(cam, 'files', { value: [file], configurable: true });
  calls.length = 0;
  fire(cam, 'change');
  await sleep(150);
  ok('модалка анализа открыта', doc.querySelector('#sheet').hidden === false);
  ok('ИИ назвал блюдо', /Куриная грудка с рисом/.test(text('#sheetBody')));
  ok('показан остаток после еды', /останется|больше остатка/.test(text('#sheetBody')), (text('#sheetBody').match(/Если съешь[^<]*/) || [])[0]);
  ok('2 позиции', doc.querySelectorAll('#sheetBody .ai-item').length === 2);
  const visionCall = calls[calls.length - 1];
  ok('картинка ушла в API', !!visionCall && /image_url/.test(JSON.stringify(visionCall.body)));
  click('[data-act="photo-add"]');
  ok('фото-еда добавлена', doc.querySelector('#sheet').hidden === true);

  console.log('\n8. ИИ-менеджер: меню под остаток');
  click('.tab[data-screen="today"]');
  ok('есть кнопка «Что съесть»', !!doc.querySelector('[data-act="plan-meal"]'));
  calls.length = 0;
  click('[data-act="plan-meal"]');
  await sleep(200);
  const planBody = text('#sheetBody');
  ok('план построен', /План от ИИ/.test(planBody), planBody.slice(0, 120));
  ok('калории посчитаны по базе (400)', /400/.test(planBody), (planBody.match(/\d+ ккал в меню/) || [])[0]);
  ok('обе позиции помечены «по базе»', doc.querySelectorAll('#sheetBody .tag-exact').length === 2);
  ok('в плане нет «оценка ИИ»', doc.querySelectorAll('#sheetBody .tag-est').length === 0);
  const planCall = calls[calls.length - 1];
  ok('в промпте передана база продуктов', !!planCall && /Куриное филе \(грудка\)\|113/.test(planCall.body.messages[0].content));
  ok('в промпте передан остаток', !!planCall && /Осталось: -?\d+ ккал/.test(planCall.body.messages[0].content));
  click('[data-act="plan-add"]');
  click('.tab[data-screen="diary"]');
  ok('план попал в дневник', /Рис варёный/.test(text('#screen-diary')));

  console.log('\n9. Закрытая норма');
  click('.tab[data-screen="today"]');
  const eaten = doc.querySelector('#screen-today').textContent;
  ok('экран сегодня пересчитан', /осталось|перебор/.test(eaten));

  console.log('\n10. Ошибки API');
  win.fetch = () => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('{"error":{"message":"bad key"}}') });
  click('.tab[data-screen="ai"]');
  setVal('#chatInput', 'тест');
  click('[data-act="send-chat"]');
  await sleep(150);
  ok('401 показан понятно', /Неверный API-ключ/.test(text('#msgs')), text('#msgs').slice(-90));

  console.log('\n11. Итог');
  ok('не было JS-ошибок', errors.length === 0, errors.join(' | '));
  console.log('\n' + (fail ? 'FAILED' : 'ALL GREEN') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('\nCRASH: ' + e.stack + '\n');
  process.exit(1);
});
