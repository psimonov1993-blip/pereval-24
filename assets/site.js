/* Общие скрипты внутренних страниц: заявка, запасной канал, кнопка наверх, звонок с компьютера */
(function(){
  var LEAD_URL = "https://terminator.pw/webhook/pereval24-lead";
  var SID = localStorage.getItem('pv24_sid');
  if(!SID){ SID = 'w'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); localStorage.setItem('pv24_sid', SID); }

  function toast(text){
    var t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:120;background:#1a212c;border:1px solid #ff8a1e;color:#eef2f7;padding:12px 20px;border-radius:12px;font-size:14.5px;font-weight:600;box-shadow:0 12px 32px rgba(0,0,0,.45)';
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

  /* заявка */
  var form = document.getElementById('lead');
  if(form){
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
      if(!data.phone){ f['phone'].focus(); return; }
      btn.disabled = true; btn.textContent = 'Отправляем...';
      fetch(LEAD_URL, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)})
        .then(function(r){ if(!r.ok) throw 0; return r; })
        .then(function(){
          window.ym && ym(111004046,'reachGoal','lead');
          form.innerHTML = '<div class="form-done">Заявка принята. Перезвоним и рассчитаем стоимость. Спасибо!</div>';
        })
        .catch(function(){
          var text = 'Заявка с сайта pereval24.ru'
            + (data.name ? '. Имя: ' + data.name : '')
            + (data.phone ? '. Телефон: ' + data.phone : '')
            + (data.cargo ? '. ' + data.cargo : '')
            + '. ' + data.source;
          form.innerHTML = '<div class="fallback"><b>Отправьте заявку в один клик</b>'
            + '<p>Автоматическая отправка сейчас недоступна. Нажмите кнопку - заявка уйдёт менеджеру напрямую.</p>'
            + '<div class="row">'
            + '<a class="tg" href="https://t.me/NarimanRam" target="_blank" rel="noopener" id="fbTg">Telegram</a>'
            + '<a class="wa" href="https://wa.me/79684418885?text=' + encodeURIComponent(text) + '" target="_blank" rel="noopener">WhatsApp</a>'
            + '<a href="tel:+79684418885">Позвонить</a>'
            + '</div></div>';
          var tg = document.getElementById('fbTg');
          if(tg) tg.addEventListener('click', function(){ copy(text, 'Текст заявки скопирован - вставьте в чат'); });
        });
    });
  }

  /* кнопка наверх */
  var top = document.getElementById('toTop');
  if(top){
    top.addEventListener('click', function(){ window.scrollTo({top:0, behavior:'smooth'}); });
    var onScroll = function(){ top.classList.toggle('show', window.pageYOffset > 700); };
    window.addEventListener('scroll', onScroll, {passive:true});
    onScroll();
  }

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
