/* Перевал 24 - общие скрипты сайта (редизайн 03.11.2026): заявка с проверкой полей и запасным каналом,
   меню на телефоне, отметка текущего раздела, проявление блоков и слогана по словам, кнопка наверх,
   плашка про cookie, звонок с компьютера копирует номер */
(function(){
  var LEAD_URL = "https://terminator.pw/webhook/pereval24-lead";
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SID = null;
  try {
    SID = localStorage.getItem('pv24_sid');
    if(!SID){ SID = 'w'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); localStorage.setItem('pv24_sid', SID); }
  } catch(e){ SID = 'w'+Date.now().toString(36); }
  document.documentElement.classList.add('js');

  function toast(text){
    var t = document.createElement('div');
    t.textContent = text;
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:120;background:#1F1F1F;border:1px solid #FF8A1E;color:#FAFAFA;padding:12px 16px;border-radius:12px;font-size:14px;line-height:20px;font-weight:600';
    document.body.appendChild(t);
    setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
  function copy(text, msg){
    var done = function(){ toast(msg); };
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done, done); }
    else {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch(e){}
      document.body.removeChild(ta); done();
    }
  }

  /* заявка: телефон обязателен, ошибка рядом с полем, во время отправки кнопка занята */
  var form = document.getElementById('lead');
  if(form){
    var phone = form.elements['phone'];
    var err = document.createElement('p');
    err.className = 'field-error'; err.id = 'phoneErr'; err.hidden = true;
    if(phone){ phone.insertAdjacentElement('afterend', err); phone.setAttribute('aria-describedby', 'phoneErr'); }
    var clearErr = function(){ err.hidden = true; phone.removeAttribute('aria-invalid'); };
    if(phone) phone.addEventListener('input', clearErr);
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var f = form.elements, btn = form.querySelector('button[type=submit]');
      var data = {
        name: (f['name'] && f['name'].value || '').trim(),
        phone: (f['phone'] && f['phone'].value || '').trim(),
        cargo: (f['cargo'] && f['cargo'].value || '').trim(),
        source: (f['source'] && f['source'].value || 'Внутренняя страница'),
        session: SID
      };
      var digits = data.phone.replace(/\D/g, '');
      if(digits.length < 10){
        err.textContent = digits.length ? 'В номере не хватает цифр. Нужно 10 или 11, например +7 900 123 45 67' : 'Укажите телефон, по нему перезвоним с ценой рейса';
        err.hidden = false; phone.setAttribute('aria-invalid', 'true'); phone.focus();
        return;
      }
      btn.disabled = true; btn.textContent = 'Отправляем заявку';
      fetch(LEAD_URL, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)})
        .then(function(r){ if(!r.ok) throw 0; return r; })
        .then(function(){
          window.ym && ym(111004046,'reachGoal','lead');
          form.innerHTML = '<div class="form-done" role="status">Заявка принята. Перезвоним и назовём цену рейса</div>';
        })
        .catch(function(){
          var text = 'Заявка с сайта pereval-24.ru'
            + (data.name ? '. Имя: ' + data.name : '')
            + (data.phone ? '. Телефон: ' + data.phone : '')
            + (data.cargo ? '. ' + data.cargo : '')
            + '. ' + data.source;
          form.innerHTML = '<div class="fallback" role="alert"><b>Заявка не ушла автоматически</b>'
            + '<p>Сервер приёма заявок не ответил. Отправьте её в один клик, она уйдёт менеджеру напрямую</p>'
            + '<div class="row">'
            + '<a class="tg" href="https://t.me/NarimanRam" target="_blank" rel="noopener" id="fbTg">Telegram</a>'
            + '<a class="wa" href="https://wa.me/79684418885?text=' + encodeURIComponent(text) + '" target="_blank" rel="noopener">WhatsApp</a>'
            + '<a href="tel:+79684418885">Позвонить</a>'
            + '</div></div>';
          var tg = document.getElementById('fbTg');
          if(tg) tg.addEventListener('click', function(){ copy(text, 'Текст заявки скопирован, вставьте его в чат'); });
        });
    });
  }

  /* меню: отметка текущего раздела и полноэкранная панель на телефоне */
  var menu = document.querySelector('.nav-menu'), nav = document.querySelector('header .nav');
  if(menu){
    var here = location.pathname;
    [].forEach.call(menu.querySelectorAll('a'), function(a){
      var h = a.getAttribute('href') || '';
      if(h.charAt(0) === '/' && h === here) a.setAttribute('aria-current', 'page');
    });
  }
  if(menu && nav){
    var tgl = document.createElement('button');
    tgl.type = 'button'; tgl.className = 'menu-toggle'; tgl.setAttribute('aria-label', 'Открыть меню'); tgl.setAttribute('aria-expanded', 'false');
    tgl.innerHTML = '<i></i><i></i><i></i>';
    nav.appendChild(tgl);
    var panel = document.createElement('nav');
    panel.className = 'mpanel'; panel.setAttribute('aria-label', 'Меню');
    var links = [].map.call(menu.querySelectorAll('a'), function(a){ return [a.getAttribute('href'), a.textContent]; });
    if(here !== '/') links.unshift(['/', 'Главная']);
    var html = links.map(function(l){ return '<a href="' + l[0] + '">' + l[1] + '</a>'; }).join('');
    html += '<a class="small" href="tel:+79684418885">+7 968 441-88-85</a>'
      + '<a class="small" href="https://wa.me/79684418885" target="_blank" rel="noopener">WhatsApp</a>'
      + '<a class="small" href="https://t.me/NarimanRam" target="_blank" rel="noopener">Telegram @NarimanRam</a>'
      + '<a class="small js-max" href="#" data-phone="+7 968 441-88-85" role="button">Max: +7 968 441-88-85</a>'
      + '<a class="small" href="mailto:kristina@pereval-24.ru">kristina@pereval-24.ru</a>';
    panel.innerHTML = html;
    document.body.appendChild(panel);
    var items = panel.querySelectorAll('a'), step = Math.min(60, Math.floor(400 / Math.max(items.length, 1)));
    [].forEach.call(items, function(a, i){ a.style.transitionDelay = (i * step) + 'ms'; });
    var setOpen = function(open){
      document.body.classList.toggle('menu-open', open);
      tgl.setAttribute('aria-expanded', open ? 'true' : 'false');
      tgl.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    };
    tgl.addEventListener('click', function(){ setOpen(!document.body.classList.contains('menu-open')); });
    panel.addEventListener('click', function(e){ if(e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') setOpen(false); });
  }

  /* проявление блоков: один раз, только прозрачность */
  var rev = document.querySelectorAll('[data-reveal]');
  if(rev.length){
    if(reduce || !('IntersectionObserver' in window)){ [].forEach.call(rev, function(el){ el.classList.add('in'); }); }
    else {
      var io = new IntersectionObserver(function(es){
        es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
      }, {rootMargin:'0px 0px -10% 0px'});
      [].forEach.call(rev, function(el){ io.observe(el); });
    }
  }

  /* слоган: каждое слово по очереди из приглушённого в полный цвет, когда пересекает линию на 60% высоты экрана */
  [].forEach.call(document.querySelectorAll('[data-words]'), function(box){
    var walk = function(node){
      [].slice.call(node.childNodes).forEach(function(n){
        if(n.nodeType === 3){
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function(part){
            if(!part) return;
            if(/^\s+$/.test(part)){ frag.appendChild(document.createTextNode(part)); return; }
            var s = document.createElement('span'); s.className = 'w'; s.textContent = part; frag.appendChild(s);
          });
          n.parentNode.replaceChild(frag, n);
        } else if(n.nodeType === 1 && n.tagName !== 'BR'){ walk(n); }
      });
    };
    walk(box);
    var words = box.querySelectorAll('.w');
    if(reduce || !('IntersectionObserver' in window)){ [].forEach.call(words, function(w){ w.classList.add('on'); }); return; }
    var wio = new IntersectionObserver(function(es){
      var hits = es.filter(function(e){ return e.isIntersecting; }).map(function(e){ return e.target; });
      hits.sort(function(a, b){ return a.compareDocumentPosition(b) & 4 ? -1 : 1; });
      hits.forEach(function(w, i){ w.style.transitionDelay = (i * 70) + 'ms'; w.classList.add('on'); wio.unobserve(w); });
    }, {rootMargin:'0px 0px -40% 0px'});
    [].forEach.call(words, function(w){ wio.observe(w); });
  });

  /* кнопка наверх: прокрутка через requestAnimationFrame, без работы на каждом кадре */
  var top = document.getElementById('toTop');
  if(top){
    top.addEventListener('click', function(){ window.scrollTo({top:0, behavior: reduce ? 'auto' : 'smooth'}); });
    var ticking = false;
    var onScroll = function(){
      if(ticking) return; ticking = true;
      requestAnimationFrame(function(){ top.classList.toggle('show', window.pageYOffset > 700); ticking = false; });
    };
    window.addEventListener('scroll', onScroll, {passive:true});
    onScroll();
  }

  /* cookie: Метрика ставит cookie, сообщаем один раз */
  var seen = null;
  try { seen = localStorage.getItem('pv24_cookie'); } catch(e){}
  if(!seen){
    var c = document.createElement('div');
    c.className = 'cookie show'; c.setAttribute('role', 'region'); c.setAttribute('aria-label', 'Cookie');
    c.innerHTML = '<p>Сайт использует cookie и Яндекс Метрику, чтобы считать посещения. Подробнее в <a href="/privacy.html">политике конфиденциальности</a></p><button type="button" class="btn ghost">Понятно</button>';
    document.body.appendChild(c);
    c.querySelector('button').addEventListener('click', function(){
      try { localStorage.setItem('pv24_cookie', '1'); } catch(e){}
      c.classList.remove('show');
    });
  }

  /* Max: публичной ссылки по номеру у Max нет - копируем номер и подсказываем, где его вставить */
  document.addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('.js-max') : null;
    if(!b) return;
    e.preventDefault();
    var num = b.getAttribute('data-phone') || '+7 968 441-88-85';
    copy(num.replace(/[^\d+]/g, ''), 'Номер ' + num + ' скопирован. Откройте Max, нажмите поиск и вставьте номер');
    window.ym && ym(111004046, 'reachGoal', 'max_click');
  });

  /* звонок с компьютера: копируем номер вместо tel: */
  var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if(!isTouch){
    document.addEventListener('click', function(e){
      var a = e.target && e.target.closest ? e.target.closest('a[href^="tel:"]') : null;
      if(!a) return;
      e.preventDefault();
      var num = a.getAttribute('href').replace('tel:', '');
      copy(num, 'Номер ' + num + ' скопирован');
    });
  }
})();
