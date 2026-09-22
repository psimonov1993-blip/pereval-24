/*
 * Генератор .docx для договора-заявки на автомобильную перевозку
 * Без внешних библиотек: свой ZIP (метод store) + WordprocessingML
 * Работает и в браузере, и в Node (для теста)
 */
(function (root) {
  'use strict';

  /* ---------- CRC32 ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(str) {
    if (str instanceof Uint8Array) return str;                 // бинарная часть (картинка подписи)
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }

  /* ---------- ZIP (store, без сжатия) ---------- */
  function zip(files) {
    var parts = [], central = [], offset = 0;

    function u16(v) { return [v & 0xff, (v >>> 8) & 0xff]; }
    function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = utf8(f.content);
      var crc = crc32(data);
      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)
      );
      parts.push(new Uint8Array(local), name, data);

      central.push(new Uint8Array([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
      )), name);

      offset += local.length + name.length + data.length;
    });

    var centralSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var end = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralSize), u32(offset), u16(0)
    ));

    var all = parts.concat(central, [end]);
    var total = all.reduce(function (s, a) { return s + a.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (a) { out.set(a, pos); pos += a.length; });
    return out;
  }

  /* ---------- XML ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  // Абзац: text может содержать переводы строк
  function par(text, o) {
    o = o || {};
    var sz = o.sz || 18;                       // половины пункта: 18 = 9pt
    var jc = o.jc ? '<w:jc w:val="' + o.jc + '"/>' : '';
    var spacing = '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 0 : o.after) + '" w:line="240" w:lineRule="auto"/>';
    var ind = o.ind ? '<w:ind w:left="' + o.ind + '"/>' : '';
    var rPr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>' +
      (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : '') + (o.u ? '<w:u w:val="single"/>' : '') +
      '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>';
    var lines = String(text == null ? '' : text).split('\n');
    var runs = lines.map(function (ln, i) {
      return '<w:r>' + rPr + (i ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + esc(ln) + '</w:t></w:r>';
    }).join('');
    return '<w:p><w:pPr>' + spacing + jc + ind +
      '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="' + sz + '"/></w:rPr>' +
      '</w:pPr>' + runs + '</w:p>';
  }

  function cell(width, content, o) {
    o = o || {};
    var shd = o.shd ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.shd + '"/>' : '';
    var span = o.span ? '<w:gridSpan w:val="' + o.span + '"/>' : '';
    var valign = '<w:vAlign w:val="' + (o.valign || 'center') + '"/>';
    return '<w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/>' + span + shd + valign +
      '<w:tcMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>' +
      '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar>' +
      '</w:tcPr>' + content + '</w:tc>';
  }

  function tableOpen(widths) {
    var total = widths.reduce(function (s, w) { return s + w; }, 0);
    return '<w:tbl><w:tblPr><w:tblW w:w="' + total + '" w:type="dxa"/>' +
      '<w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
        return '<w:' + s + ' w:val="single" w:sz="6" w:space="0" w:color="000000"/>';
      }).join('') +
      '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>' +
      '<w:tblGrid>' + widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>';
  }

  /* ---------- Документ ---------- */
  var W_LEFT = 2700, W_RIGHT = 7788;          // ширины колонок основной таблицы (сумма = рабочая ширина листа)
  var H_LEFT = 5244, H_RIGHT = 5244;          // ширины колонок подвала

  function kv(label, value) {
    return '<w:tr>' +
      cell(W_LEFT, par(label, { sz: 18 })) +
      cell(W_RIGHT, par(value, { sz: 18 })) +
      '</w:tr>';
  }

  function section(title) {
    return '<w:tr>' +
      cell(W_LEFT + W_RIGHT, par(title, { b: true, jc: 'center', sz: 18 }), { span: 2, shd: 'F2F2F2' }) +
      '</w:tr>';
  }

  // Условия, когда МЫ ИСПОЛНИТЕЛЬ: пункт про полную ответственность за груз убран,
  // простой считается по-нашему (2 часа на погрузку, 2 на выгрузку, дальше по часам)
  var TERMS_EXECUTOR = [
    'В соответствии с настоящей Договор-заявкой Исполнитель обязуется оказать Заказчику транспортно-экспедиционные услуги, связанные с перевозкой груза автомобильным транспортом по территории РФ, а Заказчик произвести оплату по оказанным услугам.',
    'Исполнитель обязан подать под загрузку в установленное место и время технически исправное транспортное средство, соответствующее требованиям настоящей Договор-заявки и действующего законодательства РФ.',
    'Погрузка, размещение и крепление груза в кузове производятся силами и за счёт Заказчика (грузоотправителя). Водитель вправе присутствовать при погрузочно-разгрузочных работах и сверять количество груза с документами. Исполнитель не отвечает за скрытые недостатки упаковки и за последствия способа погрузки, выбранного грузоотправителем.',
    'Нормативное время на погрузку составляет 2 часа, на выгрузку 2 часа, при наличии соответствующих отметок в транспортной накладной. При превышении суммарного норматива в 4 часа Заказчик оплачивает Исполнителю простой из расчёта 1000 рублей за каждый час простоя сверх норматива.',
    'В случае отмены заявки Заказчиком менее чем за сутки до подачи транспортного средства либо при неготовности груза к погрузке Заказчик оплачивает Исполнителю 20% стоимости услуг настоящей Договор-заявки.',
    'Заказчик обязан обеспечить подъезд к местам погрузки и выгрузки, пригодный для транспортного средства указанного типа. Стоимость рассчитана исходя из заявленного маршрута; при изменении адресов, добавлении точек или изменении массы груза стоимость пересчитывается по соглашению сторон.',
    'Грузоотправитель подтверждает, что в отправленном им грузе отсутствуют предметы, категорически запрещённые к перевозке, а именно: взрывчатые, самовозгорающиеся, легковоспламеняющиеся, отравляющие, ядовитые, едкие и зловонные вещества, сжатые или сжиженные газы, а также другие запрещённые к перевозке грузы.'
  ];

  // Условия, когда МЫ ЗАКАЗЧИК и нанимаем перевозчика: бланк из образца № 232
  var TERMS_CUSTOMER = [
    'В соответствии с настоящей Договор-заявкой Исполнитель обязуется оказать Заказчику транспортно-экспедиционные услуги, связанные с перевозкой груза автомобильным транспортом по территории РФ, а Заказчик произвести оплату по оказанным услугам.',
    'Исполнитель обязан подать под загрузку в установленное место и время, технически исправное транспортное средство и соответствующее требованиям данной Договор-заявке и действующему законодательства РФ.',
    'Водитель ОБЯЗАН: контролировать погрузочно-разгрузочные работы (количество, объем, вес, размер груза, целостность упаковки, распределения груза по кузову) за неверное распределение груза по кузову несет ответственность грузоперевозчик, сверять количество загруженной продукции с документами.',
    'Исполнитель несет ответственность за повреждение и порчу груза в пути следования.',
    'В случае отказа от погрузки (менее чем за сутки) Исполнитель уплачивает штраф в размере 20% стоимости услуг настоящего Договора-заявки. За попытку прямого выхода на клиента штраф 50000 р.',
    'Нормативное время на погрузку составляет 2 часа, на выгрузку 2 часа, при наличии соответствующих отметок в транспортной накладной. При превышении суммарного норматива в 4 часа Заказчик оплачивает Исполнителю простой из расчёта 1000 рублей за каждый час простоя сверх норматива.',
    'Грузоотправитель подтверждает, что в отправленном им грузе отсутствуют предметы, категорически запрещённые к перевозке, а именно: взрывчатые, самовозгорающиеся, легковоспламеняющиеся, отравляющие, ядовитые, едкие и зловонные вещества, сжатые или сжиженные газы, а также другие запрещённые к перевозке грузы.'
  ];

  var DEFAULT_TERMS = TERMS_EXECUTOR;

  function partyBlock(p) {
    var out = [];
    if (p.name) out.push(par(p.name, { b: true, sz: 17 }));
    if (p.inn) out.push(par('ИНН ' + p.inn, { sz: 17 }));
    if (p.ogrn) out.push(par('ОГРНИП ' + p.ogrn, { sz: 17 }));
    if (p.address) out.push(par('Юр. адрес: ' + p.address, { sz: 17 }));
    if (p.phone) out.push(par('Телефон: ' + p.phone, { sz: 17 }));
    if (p.email) out.push(par('E-mail: ' + p.email, { sz: 17 }));
    if (p.account || p.bank || p.bik || p.corr) {
      out.push(par('Банковские реквизиты:', { b: true, sz: 17, before: 40 }));
      if (p.account) out.push(par('р/с ' + p.account, { sz: 17 }));
      if (p.bank) out.push(par(p.bank, { sz: 17 }));
      if (p.bik) out.push(par('БИК ' + p.bik, { sz: 17 }));
      if (p.corr) out.push(par('к/с ' + p.corr, { sz: 17 }));
    }
    if (!out.length) out.push(par('', { sz: 17 }));
    return out.join('');
  }

  // Картинка факсимиле внутри абзаца подписи: рисуется поверх строки, как живая роспись
  function signatureRun(sig) {
    if (!sig || !sig.widthEmu || !sig.heightEmu) return '';
    return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + sig.widthEmu + '" cy="' + sig.heightEmu + '"/>' +
      '<wp:docPr id="1" name="Подпись"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:nvPicPr><pic:cNvPr id="1" name="Подпись"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId10"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + sig.widthEmu + '" cy="' + sig.heightEmu + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  // Ячейка подписи: сверху факсимиле (если есть), под ним линия и расшифровка
  function signCell(width, name, sig) {
    var inner = '';
    if (sig) {
      inner += '<w:p><w:pPr><w:spacing w:before="40" w:after="0"/></w:pPr>' + signatureRun(sig) + '</w:p>';
      inner += par('____________________  ' + shortName(name), { sz: 17, after: 60 });
    } else {
      inner = par('Подпись ____________________  ' + shortName(name), { sz: 17, before: 100, after: 100 });
    }
    return cell(width, inner);
  }

  function shortName(fullName) {
    if (!fullName) return '';
    var m = String(fullName).replace(/^(Индивидуальный предприниматель|ИП|ООО|Общество с ограниченной ответственностью)\s*/i, '').trim();
    m = m.replace(/[«»"]/g, '').trim();
    var parts = m.split(/\s+/);
    if (parts.length >= 3) return parts[0] + ' ' + parts[1][0] + '.' + parts[2][0] + '.';
    return m;
  }

  function buildDocumentXml(d) {
    var terms = (d.terms && d.terms.length ? d.terms : DEFAULT_TERMS);
    var body = [];

    body.push(par('Договор-заявка на автомобильную перевозку № ' + (d.number || '') + ' от ' + (d.date || '') + 'г.',
      { b: true, jc: 'center', sz: 22, after: 20 }));
    body.push(par('Данный договор-заявка, заключённый по средствам факсимильной связи или по электронной почте, имеет юридическую силу.',
      { jc: 'center', sz: 15, after: 60 }));

    var t = [tableOpen([W_LEFT, W_RIGHT])];
    t.push(kv('Маршрут следования', d.route));
    t.push(kv('Адрес загрузки', d.loadAddress));
    t.push(kv('Дата и время загрузки', d.loadDate));
    t.push(kv('Контактное лицо, тел.', d.loadContact));
    t.push(kv('Адрес разгрузки', d.unloadAddress));
    t.push(kv('Дата и время разгрузки', d.unloadDate));
    t.push(kv('Контактное лицо, тел.', d.unloadContact));
    t.push(section('Характеристики груза'));
    t.push(kv('Характер груза', d.cargo));
    t.push(kv('Тип кузова', d.bodyType));
    t.push(kv('Примечание', d.note));
    t.push(kv('Стоимость перевозки', d.price));
    t.push(kv('Срок и форма оплаты', d.payment));
    t.push(section('Данные водителя и т/с'));
    t.push(kv('ФИО водителя', d.driverName));
    t.push(kv('Телефон', d.driverPhone));
    t.push(kv('Паспортные данные', d.driverPassport));
    t.push(kv('Марка т/с, гос/номер', d.vehicle));
    t.push('</w:tbl>');
    body.push(t.join(''));

    body.push(par('', { sz: 10, after: 40 }));
    terms.forEach(function (txt, i) {
      body.push(par((i + 1) + '. ' + txt, { sz: 16, after: 10, jc: 'both' }));
    });
    body.push(par('', { sz: 10, after: 40 }));

    var f = [tableOpen([H_LEFT, H_RIGHT])];
    f.push('<w:tr>' +
      cell(H_LEFT, par('ЗАКАЗЧИК', { b: true, jc: 'center', sz: 17 }), { shd: 'F2F2F2' }) +
      cell(H_RIGHT, par('ИСПОЛНИТЕЛЬ', { b: true, jc: 'center', sz: 17 }), { shd: 'F2F2F2' }) +
      '</w:tr>');
    f.push('<w:tr>' +
      cell(H_LEFT, partyBlock(d.customer || {}), { valign: 'top' }) +
      cell(H_RIGHT, partyBlock(d.executor || {}), { valign: 'top' }) +
      '</w:tr>');
    var sig = d.signature && d.signature.widthEmu ? d.signature : null;
    var sigSide = sig ? (sig.side || 'executor') : null;
    f.push('<w:tr>' +
      signCell(H_LEFT, (d.customer || {}).name, sigSide === 'customer' ? sig : null) +
      signCell(H_RIGHT, (d.executor || {}).name, sigSide === 'executor' ? sig : null) +
      '</w:tr>');
    f.push('</w:tbl>');
    body.push(f.join(''));

    var sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="851" w:header="284" w:footer="284" w:gutter="0"/>' +
      '</w:sectPr>';

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<w:body>' + body.join('') + sect + '</w:body></w:document>';
  }

  var CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  var RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>';

  var DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>' +
    '<w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="ru-RU"/>' +
    '</w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '</w:styles>';

  function coreXml(d) {
    var title = 'Договор-заявка № ' + (d.number || '') + ' от ' + (d.date || '');
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(title) + '</dc:title>' +
      '<dc:creator>' + esc((d.executor || {}).name || 'Перевал 24') + '</dc:creator>' +
      '<cp:lastModifiedBy>' + esc((d.executor || {}).name || 'Перевал 24') + '</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }

  var APP_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>Perevalu 24 Dogovor-Zayavka</Application></Properties>';

  function buildDocx(data) {
    var sig = data.signature && data.signature.bytes && data.signature.widthEmu ? data.signature : null;
    var ext = sig ? (sig.ext || 'png') : 'png';

    var types = CONTENT_TYPES;
    var docRels = DOC_RELS;
    var parts = [];

    if (sig) {
      types = types.replace('<Default Extension="xml"',
        '<Default Extension="' + ext + '" ContentType="image/' + (ext === 'jpg' ? 'jpeg' : ext) + '"/>' +
        '<Default Extension="xml"');
      docRels = docRels.replace('</Relationships>',
        '<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
        'Target="media/signature.' + ext + '"/></Relationships>');
      parts.push({ name: 'word/media/signature.' + ext, content: sig.bytes });
    }

    return zip([
      { name: '[Content_Types].xml', content: types },
      { name: '_rels/.rels', content: RELS },
      { name: 'docProps/core.xml', content: coreXml(data) },
      { name: 'docProps/app.xml', content: APP_XML },
      { name: 'word/_rels/document.xml.rels', content: docRels },
      { name: 'word/document.xml', content: buildDocumentXml(data) },
      { name: 'word/styles.xml', content: STYLES }
    ].concat(parts));
  }

  var api = {
    buildDocx: buildDocx,
    DEFAULT_TERMS: DEFAULT_TERMS,
    TERMS_EXECUTOR: TERMS_EXECUTOR,
    TERMS_CUSTOMER: TERMS_CUSTOMER,
    shortName: shortName
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DocxGen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
