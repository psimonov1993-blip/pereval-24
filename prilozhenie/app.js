/* Перевал 24 - рабочее место менеджера.
   Считает по методу, пишет рейсы и контрагентов в общую базу проекта.
   Базы две, те же, что у формы договора-заявки и карточки рейса:
     pv24-reysy       - рейсы, договоры, документы
     pv24-spravochnik - контрагенты, водители, машины
   Ключ доступа вводит менеджер сам, в коде его нет. */
(function () {
'use strict';

var API_TRIPS = 'https://terminator.pw/webhook/pv24-reysy';
var API_BOOK  = 'https://terminator.pw/webhook/pv24-spravochnik';
var CARD_URL  = 'https://pereval24.ru/dogovor-zayavka/reys.html';

/* ---------------------------------------------------------- хранилище */
var LS = {
  get: function (k, d) {
    try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }
    catch (e) { return d; }
  },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

var state = {
  key: LS.get('pv24_key', ''),
  who: LS.get('pv24_who', ''),
  tab: 'calc',
  screen: 'calc',
  trips: LS.get('pv24_trips_cache', []),
  syncedAt: LS.get('pv24_synced_at', ''),
  parties: LS.get('pv24_parties_cache', []),
  online: navigator.onLine,
  lastTrip: null,
  draft: LS.get('pv24_draft', {})
};

/* -------------------------------------------------------------- метод
   Нормативы листа Справочники на 23.09.2026. Проверка складываемости:
   фикс за день  7667 + 2000 + 120        = 9 787 ₽
   за километр   25,50 + 15 + 5,19 + 0,80 = 46,49 ₽
   Эти два числа совпадают с методом расчёта тарифа, поэтому цена
   приложения равна цене таблицы при тех же ставках аренды.          */
var NORM = LS.get('pv24_norm', {
  rent: 7667, drvDay: 2000, waybill: 120,
  fuelL: 30, fuelP: 85, drvKm: 15, platon: 5.19, adblue: 0.80,
  markup: 0.25, usn: 0.06, vat: 0.22
});

function costLines(km, days, toll, payFix) {
  var L = [
    ['Аренда тягача и полуприцепа', NORM.rent * days],
    [payFix ? 'Водитель: фикс за рейс' : 'Водитель за дни',
      payFix ? payFix : NORM.drvDay * days],
    ['Путевой лист', NORM.waybill * days],
    ['Топливо', km * NORM.fuelL / 100 * NORM.fuelP],
    [payFix ? 'Водитель за км (в фиксе)' : 'Водитель за км', payFix ? 0 : NORM.drvKm * km],
    ['Платон', NORM.platon * km],
    ['Мочевина', NORM.adblue * km],
    ['Платные дороги', toll]
  ];
  return L;
}

function calcTrip(km, days, toll, payFix) {
  var lines = costLines(km, days, toll, payFix), cost = 0;
  lines.forEach(function (l) { cost += l[1]; });
  var price = cost * (1 + NORM.markup) / (1 - NORM.usn);
  var usn = price * NORM.usn, vat = price * NORM.vat;
  return {
    lines: lines, cost: cost, price: price, usn: usn, vat: vat,
    full: price + vat, left: price - usn - cost,
    floor: cost / (1 - NORM.usn)   // ниже этого рейс не окупается
  };
}

/* ------------------------------------------------------------- утилиты */
/**
 * Число из чего угодно: база хранит ставку и числом (рейс из приложения),
 * и строкой «61 000 ₽» (рейс пришёл из таблицы). Без разбора строки такие
 * рейсы показывали прочерк вместо ставки.
 */
function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  var s = String(v).replace(/ /g, ' ').replace(/[^\d,.\-]/g, '').replace(',', '.');
  if (!s || s === '-' || s === '.') return null;
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}
function money(v) {
  var n = toNum(v);
  if (n === null) return '-';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}
function money2(v) {
  return isFinite(v) ? v.toFixed(2).replace('.', ',') + ' ₽' : '-';
}
/** «1 рейс · 2 рейса · 5 рейсов»: число вместе со словом в нужной форме */
function plural(n, one, few, many) {
  var a = Math.abs(n) % 100, b = a % 10;
  var w = (a > 10 && a < 20) || b === 0 || b > 4 ? many : (b === 1 ? one : few);
  return n + ' ' + w;
}
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function num(id) { var e = $(id); return e ? (parseFloat(String(e.value).replace(',', '.')) || 0) : 0; }
function $(id) { return document.getElementById(id); }
function val(id) { var e = $(id); return e ? e.value.trim() : ''; }

var toastTimer;
function toast(msg) {
  var t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('on'); }, 3200);
}

function today() {
  var d = new Date();
  return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) +
         '.' + d.getFullYear();
}

/* ------------------------------------------------------------- сеть */
function call(url, payload) {
  if (!state.key) return Promise.reject(new Error('нет ключа'));
  var body = Object.assign({ key: state.key, author: state.who || 'менеджер' }, payload);
  return fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); });
}
var apiTrips = function (p) { return call(API_TRIPS, p); };
var apiBook  = function (p) { return call(API_BOOK, p); };

window.addEventListener('online',  function () { state.online = true;  paint(); });
window.addEventListener('offline', function () { state.online = false; paint(); });

/* ------------------------------------------------------------- статусы */
/* Цвета те же, что в таблице учёта: голубой назначен, персиковый в пути,
   жёлтый завершён, зелёный завершён с деньгами, серый закрыт, красный отменён */
var STATUS = {
  'назначен':  '#cfe8ff', 'в пути': '#ffd9b3', 'завершён': '#fff3b0',
  'оплачен':   '#c6efce', 'закрыт': '#dcdfe4', 'отменён': '#ffc7ce'
};
var LINE = {
  'назначен': '#7bb6ef', 'в пути': '#f0a860', 'завершён': '#e8c53c',
  'оплачен': '#5cb85c', 'закрыт': '#b4b9c0', 'отменён': '#e07b7b'
};
var UNKNOWN = { bg: '#e6e8ec', line: '#9aa0a8', text: 'статус неизвестен' };

/**
 * Статус рейса или null, если базa прислала пустое либо незнакомое значение.
 *
 * Раньше здесь стояло «не знаю - значит назначен», и менеджер видел
 * правдоподобную ложь: закрытые рейсы выглядели только что назначенными.
 * Пробел показываем пробелом.
 */
function statusOf(t) {
  var s = String((t && t.status) || '').trim().toLowerCase();
  return STATUS[s] ? s : null;
}
/** Цвет полоски и фона пилюли для известного и неизвестного статуса */
function statusLine(st) { return st ? LINE[st] : UNKNOWN.line; }
function statusPill(st, raw) {
  if (st) {
    return '<span class="pill" style="background:' + STATUS[st] + '">' + st + '</span>';
  }
  var s = String(raw || '').trim();
  return '<span class="pill" style="background:' + UNKNOWN.bg + ';color:#4a5058">' +
         UNKNOWN.text + (s ? ': «' + esc(s) + '»' : '') + '</span>';
}

/* =====================================================================
   ЭКРАНЫ
   ===================================================================== */
var SCREENS = {};

/* ---------------------------------------------------- калькулятор */
SCREENS.calc = {
  tab: 'calc', title: 'Калькулятор', sub: 'расчёт по методу',
  render: function () {
    var d = state.draft;
    return '' +
      '<div class="sect">Блок 1 · Ввод</div>' +
      '<div class="card">' +
        '<div class="two">' +
          '<div><label for="cFrom">Откуда</label>' +
          '<input id="cFrom" value="' + esc(d.from || 'Подольск') + '"></div>' +
          '<div><label for="cTo">Куда</label>' +
          '<input id="cTo" value="' + esc(d.to || '') + '"></div>' +
        '</div>' +
        '<label for="cKm">Километраж всего, км</label>' +
        '<input id="cKm" type="number" inputmode="decimal" value="' + esc(d.km || '') + '">' +
        '<div class="two">' +
          '<div><label for="cDays">Дней рейса</label>' +
          '<input id="cDays" type="number" inputmode="numeric" value="' + esc(d.days || 1) + '"></div>' +
          '<div><label for="cToll">Платные дороги, ₽</label>' +
          '<input id="cToll" type="number" inputmode="numeric" value="' + esc(d.toll || 0) + '"></div>' +
        '</div>' +
        '<label for="cFix">Зарплата водителя фикс, ₽ (пусто = по нормативу)</label>' +
        '<input id="cFix" type="number" inputmode="numeric" value="' + esc(d.fix || '') + '">' +
        '<button class="btn ghost slim" id="cMap">Открыть маршрут в Яндекс.Картах</button>' +
      '</div>' +
      '<div id="cOut"></div>' +
      '<button class="btn" id="cToTrip">Завести рейс с этим расчётом</button>' +
      '<button class="btn ghost" id="cToClient">Клиент назвал свою цену</button>' +
      '<p class="tiny">Километраж берём из Яндекс.Карт по правилам: грузовик свыше 20 т, ' +
      'без платных дорог, в Москву не глубже ТТК</p>';
  },
  wire: function () {
    ['cKm', 'cDays', 'cToll', 'cFix'].forEach(function (id) {
      $(id).addEventListener('input', recalc);
    });
    ['cFrom', 'cTo'].forEach(function (id) { $(id).addEventListener('input', saveDraft); });
    $('cMap').addEventListener('click', function () {
      var a = val('cFrom'), b = val('cTo');
      if (!a || !b) { toast('Впиши «Откуда» и «Куда»'); return; }
      window.open('https://yandex.ru/maps/?rtt=auto&rtext=' +
        encodeURIComponent(a) + '~' + encodeURIComponent(b), '_blank');
    });
    $('cToTrip').addEventListener('click', function () {
      if (!num('cKm') || !num('cDays')) { toast('Сначала километраж и дни'); return; }
      saveDraft(); go('newtrip');
    });
    $('cToClient').addEventListener('click', function () { saveDraft(); go('client'); });
    recalc();
  }
};

function saveDraft() {
  state.draft = {
    from: val('cFrom'), to: val('cTo'), km: val('cKm'),
    days: val('cDays'), toll: val('cToll'), fix: val('cFix')
  };
  LS.set('pv24_draft', state.draft);
}

function recalc() {
  saveDraft();
  var km = num('cKm'), days = num('cDays'), toll = num('cToll'), fix = num('cFix');
  var out = $('cOut');
  if (!days) {
    $('cDays').classList.add('bad');
    out.innerHTML = '<div class="sect">Блок 2 · Расшифровка</div>' +
      '<div class="res bad"><div class="lbl">Расчёт остановлен</div>' +
      '<div class="big small">впиши «Дней рейса»: без него из цены выпадут ' +
      'аренда тягача, аренда прицепа и путевой лист</div></div>';
    return;
  }
  $('cDays').classList.remove('bad');
  if (!km) {
    out.innerHTML = '<div class="sect">Блок 2 · Расшифровка</div>' +
      '<div class="res bad"><div class="lbl">Расчёт остановлен</div>' +
      '<div class="big small">впиши километраж</div></div>';
    return;
  }
  var c = calcTrip(km, days, toll, fix);
  var h = '<div class="sect">Блок 2 · Расшифровка</div><div class="card">';
  c.lines.forEach(function (l) { h += row(l[0], money(l[1])); });
  h += '</div>' +
    '<div class="tot">' + row('СЕБЕСТОИМОСТЬ', money(c.cost)) + '</div>' +
    '<div class="card">' +
      row('Наценка ' + Math.round(NORM.markup * 100) + '%', money(c.cost * NORM.markup)) +
      row('УСН ' + Math.round(NORM.usn * 100) + '% внутри цены', money(c.usn)) +
    '</div>' +
    '<div class="tot">' + row('ЦЕНА БЕЗ НДС', money(c.price)) + '</div>' +
    '<div class="card">' + row('НДС ' + Math.round(NORM.vat * 100) + '% сверху', money(c.vat)) + '</div>' +
    '<div class="tot">' + row('ЦЕНА С НДС', money(c.full)) + '</div>' +
    '<div class="card">' +
      row('Остаётся после УСН', money(c.left), c.left > 0 ? 'pos' : 'neg') +
      row('Нижний порог, ниже - убыток', money(c.floor)) +
      row('За км без НДС', money2(c.price / km)) +
      row('За км с НДС', money2(c.full / km)) +
    '</div>' +
    '<div class="res"><div class="lbl">Называем клиенту</div>' +
    '<div class="big">' + money(c.full) + '</div>' +
    '<div class="lbl">без НДС ' + money(c.price) + '</div></div>';
  if (km / days > 650) {
    h += '<div class="note">Больше 650 км в день: по норме 9 часов за рулём не успеть, ' +
         'проверь число дней</div>';
  }
  if (toll > 0) {
    h += '<div class="note">Платные дороги в цене: по правилу берём бесплатный объезд</div>';
  }
  out.innerHTML = h;
}

function row(k, v, cls) {
  return '<div class="row"><span class="k">' + k + '</span>' +
         '<span class="v ' + (cls || '') + '">' + v + '</span></div>';
}

/* ------------------------------------------ блок 3: цену назвал клиент */
SCREENS.client = {
  tab: 'calc', title: 'Цену назвал клиент', sub: 'проверка ставки', back: 'calc',
  render: function () {
    var d = state.draft;
    return '<div class="card">' +
      '<div class="row"><span class="k">Расчёт</span><span class="v">' +
      esc(d.km || 0) + ' км · ' + esc(d.days || 1) + ' дн</span></div></div>' +
      '<label for="kPrice">Цена клиента, ₽</label>' +
      '<input id="kPrice" type="number" inputmode="numeric" placeholder="сколько даёт клиент">' +
      '<label for="kVat">НДС в цене клиента</label>' +
      '<select id="kVat"><option value="0">без НДС</option>' +
      '<option value="0.22">с НДС 22%</option><option value="0.20">с НДС 20%</option>' +
      '<option value="0.10">с НДС 10%</option><option value="0.07">с НДС 7%</option>' +
      '<option value="0.05">с НДС 5%</option></select>' +
      '<div id="kOut"></div>';
  },
  wire: function () {
    $('kPrice').addEventListener('input', clientCalc);
    $('kVat').addEventListener('change', clientCalc);
    clientCalc();
  }
};

function clientCalc() {
  var d = state.draft, km = parseFloat(d.km) || 0, days = parseFloat(d.days) || 0;
  var out = $('kOut');
  if (!km || !days) {
    out.innerHTML = '<div class="res bad"><div class="big small">' +
      'Сначала посчитай рейс в калькуляторе</div></div>';
    return;
  }
  var p = num('kPrice');
  if (!p) { out.innerHTML = '<p class="tiny">Впиши цену клиента</p>'; return; }
  var vatRate = parseFloat($('kVat').value) || 0;
  var c = calcTrip(km, days, parseFloat(d.toll) || 0, parseFloat(d.fix) || 0);
  var vatIn = vatRate ? p * vatRate / (1 + vatRate) : 0;
  var net = p - vatIn, usn = net * NORM.usn, margin = net - usn - c.cost;
  var diff = net - c.price;
  var verdict = margin < 0 ? ['УБЫТОК, рейс не брать', 'bad']
    : (diff < 0 ? ['Берём дешевле нашей цены, маржа ниже плановой', '']
                : ['Цена клиента не ниже нашей', 'good']);
  out.innerHTML = '<div class="sect">Разбор ставки</div><div class="card">' +
    row('НДС внутри цены', money(vatIn)) +
    row('Выручка без НДС', money(net)) +
    row('УСН ' + Math.round(NORM.usn * 100) + '%', money(usn)) +
    row('Себестоимость', money(c.cost)) +
    '</div><div class="tot">' + row('МАРЖА', money(margin), margin < 0 ? 'neg' : 'pos') +
    '</div><div class="card">' +
    row('Рентабельность к выручке', net ? (margin / net * 100).toFixed(1).replace('.', ',') + '%' : '-') +
    row('Наценка к себестоимости', c.cost ? (margin / c.cost * 100).toFixed(1).replace('.', ',') + '%' : '-') +
    row('Против нашей цены без НДС', money(diff), diff < 0 ? 'neg' : 'pos') +
    '</div><div class="res ' + verdict[1] + '"><div class="lbl">Вывод</div>' +
    '<div class="big small">' + verdict[0] + '</div></div>';
}

/* ------------------------------------------------------------ рейсы */
SCREENS.trips = {
  tab: 'trips', title: 'Рейсы', sub: 'из общей базы', act: ['+ Рейс', 'newtrip'],
  render: function () {
    if (!state.trips.length) {
      return '<div class="empty">Рейсов пока нет.<br>Посчитай в калькуляторе и заведи первый</div>';
    }
    var h = freshness();
    state.trips.forEach(function (t) {
      var st = statusOf(t);
      h += '<div class="trip" data-trip="' + esc(t.id) + '" style="border-left-color:' +
        statusLine(st) + '"><div class="top"><span class="id">' + esc(t.id) + '</span>' +
        '<span class="sum">' + money(t.price) + '</span></div>' +
        '<div class="rt">' + esc(t.route || 'маршрут не указан') + '</div>' +
        '<div class="meta">' + statusPill(st, t.status) +
        (t.contract ? '<span>договор № ' + esc(t.contract) + '</span>' : '') +
        (t.customer ? '<span>' + esc(t.customer) + '</span>' : '') +
        '</div></div>';
    });
    return h;
  },
  wire: function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-trip]'), function (el) {
      el.addEventListener('click', function () {
        state.lastTrip = el.getAttribute('data-trip');
        go('trip');
      });
    });
    loadTrips();
  }
};

/**
 * Опрос базы: не чаще раза в 10 секунд и без наложений.
 *
 * Отрисовка экрана рейсов вызывает загрузку, а загрузка перерисовывает экран -
 * без этого тормоза приложение крутило запросы к базе по кругу, пока открыт
 * список рейсов. Перерисовываем ещё и только когда данные правда изменились.
 */
var tripsLoadedAt = 0, tripsLoading = false;

function loadTrips(force) {
  if (!state.key || !state.online || tripsLoading) return;
  var now = Date.now();
  if (!force && now - tripsLoadedAt < 10000) return;
  tripsLoadedAt = now;
  tripsLoading = true;
  var before = JSON.stringify([state.trips, state.syncedAt]);
  apiTrips({ action: 'trip.list' }).then(function (res) {
    tripsLoading = false;
    if (!res || !res.ok) return;
    var list = res.trips || res.list || [];
    if (!Array.isArray(list)) return;
    state.trips = list.map(function (t) {
      var d = t.trip_data || t.data || t;
      return {
        id: t.trip || t.id || d.id, route: d.route, customer: d.customer,
        price: d.price, status: d.status, contract: t.contract || d.contract,
        driver: d.driver, vehicle: d.vehicle, date: d.date, customerInn: d.customerInn,
        billed: d.billed, credited: d.credited, updatedAt: d.updatedAt, km: d.km, vat: d.vat
      };
    });
    state.syncedAt = res.syncedAt || '';
    LS.set('pv24_trips_cache', state.trips);
    LS.set('pv24_synced_at', state.syncedAt);
    var changed = JSON.stringify([state.trips, state.syncedAt]) !== before;
    if (changed && (state.screen === 'trips' || state.screen === 'money')) paint();
  }).catch(function () { tripsLoading = false; });
}

/** «24.09.2026 14:27» в Date. Формат задаёт база, чужой формат вернёт null */
function parseStamp(s) {
  var m = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/.exec(String(s || '').trim());
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
}

/**
 * Строка свежести данных. Менеджер должен видеть, на какой момент цифры,
 * а не догадываться: таблица отправляет рейсы в базу по кнопке или по
 * расписанию, между отправками статусы в приложении отстают.
 */
function freshness() {
  var s = state.syncedAt;
  if (!s) {
    return '<div class="note">Таблица ещё ни разу не отправляла рейсы сюда. ' +
           'Статусы могут отставать: в таблице меню «Перевал 24» → «Отправить рейсы в приложение»</div>';
  }
  var d = parseStamp(s), cls = 'stamp', warn = '';
  if (d) {
    var hours = (Date.now() - d.getTime()) / 3600000;
    if (hours > 24) { cls = 'stamp old'; warn = ' · больше суток назад, статусы могли устареть'; }
    else if (hours > 4) { cls = 'stamp old'; warn = ' · больше четырёх часов назад'; }
  }
  return '<div class="' + cls + '">Данные из таблицы на ' + esc(s.replace(/^(\d{2}\.\d{2})\.\d{4}\s/, '$1 в ')) +
         warn + ' · нажми, чтобы обновить</div>';
}

SCREENS.trip = {
  tab: 'trips', title: 'Рейс', sub: '', back: 'trips',
  render: function () {
    var t = null;
    state.trips.forEach(function (x) { if (x.id === state.lastTrip) t = x; });
    if (!t) return '<div class="empty">Рейс не найден</div>';
    var st = statusOf(t);
    var billed = toNum(t.billed), credited = toNum(t.credited);
    var h = freshness() + '<div class="card">' +
      row('Рейс', esc(t.id)) +
      row('Статус', st || UNKNOWN.text + (t.status ? ': «' + esc(t.status) + '»' : '')) +
      row('Маршрут', esc(t.route || '-')) +
      row('Заказчик', esc(t.customer || '-')) +
      row('Водитель', esc(t.driver || '-')) +
      row('Машина', esc(t.vehicle || '-')) +
      row('Дата', esc(t.date || '-')) +
      (t.updatedAt ? row('Обновлён', esc(t.updatedAt)) : '') +
      '</div>' +
      '<div class="sect">Деньги</div><div class="tot">' +
      row('Ставка заказчика', money(t.price)) + '</div>' +
      '<div class="card">' +
      row('Выставлено счетами', billed === null ? 'данных нет'
          : (billed ? money(billed) : 'счёт не выставлен')) +
      row('Зачтено', credited === null ? 'данных нет' : money(credited)) +
      (billed
        ? row('Ждём оплату', money(Math.max(billed - (credited || 0), 0)),
              billed - (credited || 0) > 0 ? 'neg' : 'pos')
        : '') +
      '</div>';
    if (t.contract) {
      h += '<div class="sect">Документы</div><div class="card">' +
        row('Договор-заявка', '№ ' + esc(t.contract)) + '</div>';
    }
    h += '<button class="btn ghost" id="openCard">Открыть карточку рейса</button>' +
      '<p class="tiny">В карточке договор в Word, загрузка накладной и фото от водителя</p>';
    return h;
  },
  wire: function () {
    var b = $('openCard');
    if (b) b.addEventListener('click', function () {
      window.open(CARD_URL + '?id=' + encodeURIComponent(state.lastTrip), '_blank');
    });
  }
};

/* -------------------------------------------------------- новый рейс */
SCREENS.newtrip = {
  tab: 'trips', title: 'Новый рейс', sub: 'запись в общую базу', back: 'trips',
  render: function () {
    var d = state.draft;
    var km = parseFloat(d.km) || 0, days = parseFloat(d.days) || 1;
    var c = km ? calcTrip(km, days, parseFloat(d.toll) || 0, parseFloat(d.fix) || 0) : null;
    var opts = '<option value="">выбери из справочника</option>';
    state.parties.forEach(function (p) {
      opts += '<option value="' + esc(p.pName) + '" data-inn="' + esc(p.pInn || '') + '">' +
              esc(p.pName) + '</option>';
    });
    return '' +
      '<div class="sect">Заказчик</div>' +
      '<select id="nCust">' + opts + '</select>' +
      '<button class="btn ghost slim" id="nNewCust">+ Заказчика нет в списке</button>' +
      '<label for="nInn">ИНН заказчика</label><input id="nInn" inputmode="numeric">' +
      '<div class="sect">Рейс</div>' +
      '<label for="nId">Номер рейса</label>' +
      '<input id="nId" value="' + esc(nextTripId()) + '">' +
      '<label for="nRoute">Маршрут</label>' +
      '<input id="nRoute" value="' + esc([d.from, d.to].filter(Boolean).join(' - ')) + '">' +
      '<div class="two">' +
        '<div><label for="nDate">Дата старта</label>' +
        '<input id="nDate" value="' + today() + '"></div>' +
        '<div><label for="nKm">Километраж</label>' +
        '<input id="nKm" type="number" inputmode="decimal" value="' + esc(d.km || '') + '"></div>' +
      '</div>' +
      '<div class="sect">Машина и водитель</div>' +
      '<label for="nVeh">Тягач и прицеп</label><input id="nVeh" placeholder="госномера">' +
      '<label for="nDrv">Водитель</label><input id="nDrv" placeholder="ФИО">' +
      '<div class="sect">Цена</div>' +
      (c ? '<div class="card">' + row('Тариф по методу без НДС', money(c.price)) +
           row('С НДС ' + Math.round(NORM.vat * 100) + '%', money(c.full)) +
           row('Нижний порог', money(c.floor)) + '</div>' : '') +
      '<label for="nPrice">Ставка заказчика, ₽</label>' +
      '<input id="nPrice" type="number" inputmode="numeric" value="' +
        (c ? Math.round(c.price) : '') + '">' +
      '<label for="nVat">Ставка НДС</label>' +
      '<select id="nVat"><option>без НДС</option><option>22%</option><option>20%</option>' +
      '<option>10%</option><option>7%</option><option>5%</option></select>' +
      '<button class="btn" id="nSave">Завести рейс и договор</button>' +
      '<p class="tiny">Рейс уходит в общую базу, номер договора выдаёт она же. ' +
      'В лист Рейсы строка попадёт по кнопке «Забрать рейсы из базы» в меню таблицы</p>';
  },
  wire: function () {
    $('nNewCust').addEventListener('click', function () { go('newcust'); });
    $('nCust').addEventListener('change', function () {
      var o = this.options[this.selectedIndex];
      if (o) $('nInn').value = o.getAttribute('data-inn') || '';
    });
    $('nSave').addEventListener('click', saveTrip);
  }
};

function nextTripId() {
  var max = 0;
  state.trips.forEach(function (t) {
    var m = /(\d+)\s*$/.exec(t.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'Р-' + ('00' + (max + 1)).slice(-3);
}

function saveTrip() {
  if (!state.key) { openGate(); return; }
  var id = val('nId'), cust = val('nCust'), route = val('nRoute'), price = num('nPrice');
  if (!id)    { toast('Впиши номер рейса'); return; }
  if (!cust)  { toast('Выбери заказчика'); return; }
  if (!route) { toast('Впиши маршрут'); return; }
  if (!price) { toast('Впиши ставку заказчика'); return; }

  var btn = $('nSave'); btn.disabled = true; btn.textContent = 'Записываю…';
  var data = {
    date: val('nDate'), dateFinish: '', customer: cust, customerInn: val('nInn'),
    route: route, driver: val('nDrv'), vehicle: val('nVeh'),
    price: price, status: 'назначен', km: num('nKm'), vat: val('nVat'),
    source: 'приложение'
  };
  apiTrips({ action: 'trip.save', trip: id, trip_data: data }).then(function (res) {
    if (!res || !res.ok) throw new Error((res && res.error) || 'база не приняла рейс');
    return apiTrips({ action: 'contract.create', trip: id, contract: {
      customerName: cust, customerInn: val('nInn'), route: route,
      price: price, driverName: val('nDrv'), vehicle: val('nVeh'), date: val('nDate')
    }});
  }).then(function (res) {
    var number = res && res.contract ? res.contract.number : null;
    state.trips.unshift({
      id: id, route: route, customer: cust, price: price, status: 'назначен',
      contract: number, driver: val('nDrv'), vehicle: val('nVeh'), date: val('nDate')
    });
    LS.set('pv24_trips_cache', state.trips);
    toast(number ? ('Рейс ' + id + ' заведён, договор № ' + number) : ('Рейс ' + id + ' заведён'));
    state.lastTrip = id;
    go('trip');
  }).catch(function (e) {
    btn.disabled = false; btn.textContent = 'Завести рейс и договор';
    toast(state.online ? ('Не вышло: ' + e.message) : 'Нет сети, рейс не записан');
  });
}

/* ----------------------------------------------------------- деньги */
SCREENS.money = {
  tab: 'money', title: 'Деньги', sub: 'счета и оплаты из таблицы',
  render: function () {
    if (!state.trips.length) return '<div class="empty">Рейсов ещё нет</div>';
    // Считаем по счетам листа «Деньги», а не по статусу рейса: статус говорит,
    // где машина, а не пришли ли деньги. Раньше «ждём оплату» складывалось из
    // статусов и врало ровно там же, где врал статус
    var billed = 0, credited = 0, noBill = 0, noBillSum = 0, known = 0;
    state.trips.forEach(function (t) {
      var b = toNum(t.billed), c = toNum(t.credited);
      if (b === null && c === null) { noBill++; noBillSum += toNum(t.price) || 0; return; }
      known++;
      billed += b || 0;
      credited += c || 0;
      if (!b) { noBill++; noBillSum += toNum(t.price) || 0; }
    });
    var h = freshness() + '<div class="card">' +
      row('Выставлено счетами', money(billed)) +
      row('Зачтено', money(credited), 'pos') +
      row('Ждём оплату', money(Math.max(billed - credited, 0)),
          billed - credited > 0 ? 'neg' : 'pos') +
      '</div>';
    if (noBill) {
      h += '<div class="note">Без счёта: ' + plural(noBill, 'рейс', 'рейса', 'рейсов') +
           ' на ' + money(noBillSum) +
           '. Эти деньги ещё не выставлены заказчику, в «ждём оплату» они не входят</div>';
    }
    if (!known) {
      h += '<div class="note">Данных по счетам от таблицы ещё не приходило: ' +
           'в таблице меню «Перевал 24» → «Отправить рейсы в приложение»</div>';
    }
    h += '<div class="sect">По рейсам</div>';
    state.trips.forEach(function (t) {
      var st = statusOf(t), b = toNum(t.billed), c = toNum(t.credited) || 0;
      // ноль и пробел - разные вещи: счёта нет вовсе против счёта на ноль рублей
      var tail = b === null ? 'данных по счетам нет'
        : (!b ? 'счёт не выставлен'
             : (c >= b ? 'оплачен' : 'ждём ' + money(b - c)));
      h += '<div class="trip" style="border-left-color:' + statusLine(st) + '">' +
        '<div class="top"><span class="id">' + esc(t.id) + '</span>' +
        '<span class="sum">' + money(t.price) + '</span></div>' +
        '<div class="rt">' + esc(t.customer || 'заказчик не указан') + '</div>' +
        '<div class="meta">' + statusPill(st, t.status) + '<span>' + tail + '</span>' +
        '</div></div>';
    });
    h += '<p class="tiny">Счета и поступления ведутся в листе Деньги таблицы, ' +
         'сюда они приходят с синхронизацией</p>';
    return h;
  },
  wire: function () { loadTrips(); }
};

/* ------------------------------------------------------ справочники */
SCREENS.refs = {
  tab: 'refs', title: 'Справочники', sub: 'общие для всех менеджеров',
  render: function () {
    return '<div class="menu">' +
      '<button data-go="parties"><span>Заказчики</span>' +
      '<span class="cnt">' + state.parties.length + '</span></button>' +
      '<button data-go="norms"><span>Нормативы расчёта</span>' +
      '<span class="cnt">метод</span></button>' +
      '</div>' +
      '<p class="tiny"><span class="live' + (state.online ? '' : ' off') + '"></span>' +
      (state.online ? 'База на связи: что внёс один менеджер, видят остальные'
                    : 'Сети нет, показываю последнюю копию') + '</p>';
  },
  wire: wireGo
};

SCREENS.parties = {
  tab: 'refs', title: 'Заказчики', sub: 'общая база', back: 'refs', act: ['+ Новый', 'newcust'],
  render: function () {
    if (!state.parties.length) {
      return '<div class="empty">Справочник пуст или не загружен.<br>' +
             'Добавь заказчика кнопкой вверху</div>';
    }
    var h = '<div class="menu">';
    state.parties.forEach(function (p) {
      h += '<button><span>' + esc(p.pName) + '</span><span class="cnt">' +
           esc(p.pInn || 'без ИНН') + '</span></button>';
    });
    return h + '</div>';
  },
  wire: loadBook
};

function loadBook() {
  if (!state.key || !state.online) return;
  apiBook({ action: 'list' }).then(function (res) {
    if (!res || !res.ok) return;
    var list = res.parties || (res.book && res.book.parties) || [];
    if (!Array.isArray(list)) return;
    state.parties = list;
    LS.set('pv24_parties_cache', list);
    if (state.screen === 'parties' || state.screen === 'refs') paint();
  }).catch(function () {});
}

SCREENS.newcust = {
  tab: 'refs', title: 'Новый заказчик', sub: 'пишется в общую базу', back: 'parties',
  render: function () {
    return '<p class="tiny" style="margin-top:0">Запись сразу видят остальные менеджеры. ' +
      'Дубли база ловит по ИНН: та же фирма обновится, а не удвоится</p>' +
      '<label for="pName">Название</label><input id="pName" placeholder="ООО или ИП">' +
      '<label for="pInn">ИНН</label><input id="pInn" inputmode="numeric">' +
      '<div class="two">' +
        '<div><label for="pVat">НДС</label><select id="pVat">' +
        '<option>без НДС</option><option>с НДС</option></select></div>' +
        '<div><label for="pDelay">Отсрочка, дней</label>' +
        '<input id="pDelay" type="number" inputmode="numeric" value="0"></div>' +
      '</div>' +
      '<label for="pPhone">Телефон</label><input id="pPhone" inputmode="tel">' +
      '<label for="pEmail">Почта</label><input id="pEmail" inputmode="email">' +
      '<label for="pAddress">Адрес</label><input id="pAddress">' +
      '<button class="btn" id="pSave">Сохранить в справочник</button>';
  },
  wire: function () {
    $('pSave').addEventListener('click', function () {
      if (!state.key) { openGate(); return; }
      var name = val('pName');
      if (!name) { toast('Впиши название'); return; }
      var rec = {
        pName: name, pInn: val('pInn'), pPhone: val('pPhone'), pEmail: val('pEmail'),
        pAddress: val('pAddress'), pVat: val('pVat'), pDelay: val('pDelay')
      };
      var btn = $('pSave'); btn.disabled = true; btn.textContent = 'Сохраняю…';
      apiBook({ action: 'save', kind: 'party', record: rec }).then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'база не приняла запись');
        var i = -1;
        state.parties.forEach(function (p, idx) {
          if ((p.pInn && p.pInn === rec.pInn) || p.pName === rec.pName) i = idx;
        });
        if (i >= 0) state.parties[i] = rec; else state.parties.push(rec);
        LS.set('pv24_parties_cache', state.parties);
        toast('«' + name + '» в общей базе, видят все менеджеры');
        go('parties');
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = 'Сохранить в справочник';
        toast(state.online ? ('Не вышло: ' + e.message) : 'Нет сети, запись не ушла');
      });
    });
  }
};

SCREENS.norms = {
  tab: 'refs', title: 'Нормативы', sub: 'из них считается цена', back: 'refs',
  render: function () {
    var fix = NORM.rent + NORM.drvDay + NORM.waybill;
    var perKm = NORM.fuelL / 100 * NORM.fuelP + NORM.drvKm + NORM.platon + NORM.adblue;
    return '<div class="card">' +
      row('Аренда сцепки, ₽/день', money(NORM.rent)) +
      row('Водитель, ₽/день', money(NORM.drvDay)) +
      row('Путевой лист, ₽/день', money(NORM.waybill)) +
      '</div><div class="tot">' + row('Фикс за день', money(fix)) + '</div>' +
      '<div class="card">' +
      row('Расход, л/100 км', NORM.fuelL) +
      row('Топливо, ₽/л', money(NORM.fuelP)) +
      row('Водитель, ₽/км', money(NORM.drvKm)) +
      row('Платон, ₽/км', money2(NORM.platon)) +
      row('Мочевина, ₽/км', money2(NORM.adblue)) +
      '</div><div class="tot">' + row('Переменные за км', money2(perKm)) + '</div>' +
      '<div class="card">' +
      row('Наценка', Math.round(NORM.markup * 100) + '%') +
      row('УСН с оборота', Math.round(NORM.usn * 100) + '%') +
      row('НДС по умолчанию', Math.round(NORM.vat * 100) + '%') +
      '</div>' +
      '<p class="tiny">Те же значения, что в листе Справочники. Меняются они там: ' +
      'цена рейсов прошлых месяцев не должна поехать задним числом</p>';
  }
};

/* -------------------------------------------------------------- ещё */
SCREENS.more = {
  tab: 'more', title: 'Ещё', sub: '', render: function () {
    return '<div class="menu">' +
      '<button data-go="norms"><span>Нормативы расчёта</span><span class="cnt">метод</span></button>' +
      '<button data-go="account"><span>Доступ и менеджер</span>' +
      '<span class="cnt">' + esc(state.who || 'не указан') + '</span></button>' +
      '</div>' +
      '<div class="sect">Заполняет водитель</div>' +
      '<div class="menu">' +
      '<button data-card><span>Заправки, расходы, накладные</span>' +
      '<span class="cnt">карточка рейса</span></button></div>' +
      '<p class="tiny">Водитель грузит чеки и накладные в карточке рейса, ' +
      'оттуда они уходят в Telegram-группу Перевал24</p>' +
      '<p class="tiny">Версия 1.0 · 23.09.2026</p>';
  },
  wire: function () {
    wireGo();
    var c = document.querySelector('[data-card]');
    if (c) c.addEventListener('click', function () {
      if (!state.lastTrip) { toast('Сначала открой рейс в списке'); return; }
      window.open(CARD_URL + '?id=' + encodeURIComponent(state.lastTrip), '_blank');
    });
  }
};

SCREENS.account = {
  tab: 'more', title: 'Доступ', sub: 'ключ и имя менеджера', back: 'more',
  render: function () {
    return '<label for="aWho">Имя менеджера</label>' +
      '<input id="aWho" value="' + esc(state.who) + '" placeholder="как подписывать записи">' +
      '<label for="aKey">Ключ доступа к базе</label>' +
      '<input id="aKey" type="password" value="' + esc(state.key) + '">' +
      '<button class="btn" id="aSave">Сохранить</button>' +
      '<button class="btn ghost" id="aTest">Проверить связь с базой</button>' +
      '<p class="tiny">Ключ хранится только в этом телефоне и уходит лишь на сервер ' +
      'Перевал 24. Тот же ключ, что в форме договора-заявки</p>';
  },
  wire: function () {
    $('aSave').addEventListener('click', function () {
      state.who = val('aWho'); state.key = val('aKey');
      LS.set('pv24_who', state.who); LS.set('pv24_key', state.key);
      toast('Сохранено'); loadTrips(); loadBook();
    });
    $('aTest').addEventListener('click', function () {
      state.key = val('aKey');
      if (!state.key) { toast('Впиши ключ'); return; }
      toast('Проверяю…');
      apiTrips({ action: 'trip.list' }).then(function (res) {
        toast(res && res.ok ? 'База отвечает, ключ подходит'
                            : ('База: ' + ((res && res.error) || 'отказ')));
      }).catch(function () { toast('Сервер базы недоступен'); });
    });
  }
};

function wireGo() {
  Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (el) {
    el.addEventListener('click', function () { go(el.getAttribute('data-go')); });
  });
}

/* ===================================================== отрисовка и вход */
var TABS = [
  { k: 'trips', ic: '🚚', t: 'Рейсы' },
  { k: 'calc',  ic: '🧮', t: 'Калькулятор' },
  { k: 'money', ic: '₽',  t: 'Деньги' },
  { k: 'refs',  ic: '📁', t: 'Справочники' },
  { k: 'more',  ic: '⋯',  t: 'Ещё' }
];
var FIRST = { trips: 'trips', calc: 'calc', money: 'money', refs: 'refs', more: 'more' };

function go(name) {
  if (!SCREENS[name]) return;
  state.screen = name;
  state.tab = SCREENS[name].tab || state.tab;
  paint();
  window.scrollTo(0, 0);
}

function paint() {
  var s = SCREENS[state.screen];
  $('title').textContent = s.title;
  $('sub').textContent = s.sub || '';
  $('sub').style.display = s.sub ? 'block' : 'none';

  var back = $('back');
  back.style.display = s.back ? 'block' : 'none';
  back.onclick = function () { go(s.back); };

  var act = $('act');
  if (s.act) {
    act.style.display = 'block'; act.textContent = s.act[0];
    act.onclick = function () { go(s.act[1]); };
  } else { act.style.display = 'none'; }

  $('main').innerHTML = s.render();
  if (s.wire) s.wire();

  var nav = $('nav'); nav.innerHTML = '';
  TABS.forEach(function (t) {
    var b = document.createElement('button');
    b.className = state.tab === t.k ? 'on' : '';
    b.innerHTML = '<span class="ic">' + t.ic + '</span>' + t.t;
    b.onclick = function () { go(FIRST[t.k]); };
    nav.appendChild(b);
  });

  // строка свежести работает кнопкой: нажал - обновилось сейчас же
  var stampEl = document.querySelector('.stamp');
  if (stampEl) {
    stampEl.style.cursor = 'pointer';
    stampEl.title = 'Обновить сейчас';
    stampEl.onclick = function () { refreshNow(); };
  }
  watchLive();
}

/** Обновить немедленно, не дожидаясь ни таймера, ни тормоза в 10 секунд */
function refreshNow() {
  if (!state.online) { toast('Нет сети, показываю последнюю копию'); return; }
  toast('Обновляю…');
  loadTrips(true);
}

/**
 * Пока открыт экран рейсов или денег, данные подтягиваются сами раз в 20
 * секунд. Таблица шлёт правку в базу сразу, поэтому смена статуса доезжает
 * до телефона за секунды, а не к следующему открытию экрана.
 */
var liveTimer = null;
function watchLive() {
  var live = state.screen === 'trips' || state.screen === 'money' || state.screen === 'trip';
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  if (!live) return;
  liveTimer = setInterval(function () {
    if (document.hidden || !state.online) return;
    loadTrips(true);
  }, 20000);
}

// вернулись в приложение с другого экрана телефона - показываем свежее
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) loadTrips(true);
});

function openGate() {
  $('gate').style.display = 'block';
  $('gKey').value = state.key;
  $('gWho').value = state.who;
}

function initGate() {
  $('gSave').addEventListener('click', function () {
    state.who = $('gWho').value.trim();
    state.key = $('gKey').value.trim();
    LS.set('pv24_who', state.who); LS.set('pv24_key', state.key);
    $('gate').style.display = 'none';
    loadTrips(); loadBook(); paint();
  });
  $('gSkip').addEventListener('click', function () {
    $('gate').style.display = 'none';
    go('calc');
  });
}

/* ------------------------------------------------------------- старт */
initGate();
if (!state.key) { openGate(); }
go(state.key ? 'trips' : 'calc');
loadTrips(); loadBook();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}

})();
