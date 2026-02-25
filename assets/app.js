/* app.js — SINESP painel (ZIP + layout)
   Dependências no index.html:
   - papaparse
   - jszip
   - plotly
   - leaflet
*/
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // ---------- elementos ----------
  const els = {
    panel: $("panelSelect"),
    event: $("eventSelect"),
    scope: $("scopeSelect"),
    mun: $("munSelect"),
    series: $("metricSelect"),      // Total/Feminino/Masculino (valores)
    year: $("yearSelect"),
    extra: $("extraSelect"),
    reset: $("resetBtn"),
    daily: $("dailyToggle"),

    yearA: $("yearASelect"),
    yearB: $("yearBSelect"),
    calcAbs: $("calcDeltaAbs"),
    calcPct: $("calcDeltaPct"),
    calcTax: $("calcTaxInfo"),

    kpi1L: $("kpi1Label"),
    kpi1V: $("kpi1Value"),
    kpi1F: $("kpi1Foot"),
    kpi2L: $("kpi2Label"),
    kpi2V: $("kpi2Value"),
    kpi2F: $("kpi2Foot"),
    kpi3V: $("kpi3Value"),
    kpi3F: $("kpi3Foot"),

    tsDiv: $("tsChart"),
    sexDiv: $("sexChart"),
    rankDiv: $("rankChart"),
    mapDiv: $("map"),
    mapLegend: $("mapLegend"),
  };

  // ---------- utils ----------
  const isNil = (v) => v === null || v === undefined || v === "";
  const stripBOM = (t) => (t || "").replace(/^\uFEFF/, "");

  function fixMojibake(s) {
    if (s === null || s === undefined) return s;
    const str = String(s);
    if (!/Ã|Â/.test(str)) return str;
    try { return decodeURIComponent(escape(str)); } catch { return str; }
  }

  function toNumber(x) {
    if (x === null || x === undefined) return NaN;
    if (typeof x === "number") return x;
    let s = String(x).trim();
    if (!s) return NaN;

    // remove espaços e símbolos não numéricos comuns (mantém . , -)
    s = s.replace(/\s+/g, "").replace(/[^\d.,\-]/g, "");

    const hasC = s.includes(",");
    const hasD = s.includes(".");
    if (hasC && hasD) {
      // escolhe separador decimal pelo último que aparece
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
        // 1.234.567,89 => 1234567.89
        s = s.replace(/\./g, "").replace(",", ".");
      } else {
        // 1,234,567.89 => 1234567.89
        s = s.replace(/,/g, "");
      }
    } else if (hasC) {
      // 123,45 => 123.45
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (hasD) {
      // se tiver múltiplos pontos, assume milhares e mantém o último como decimal
      const parts = s.split(".");
      if (parts.length > 2) {
        const last = parts.pop();
        s = parts.join("") + "." + last;
      }
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("pt-BR") : "—");
  const fmtFloat = (n, d = 2) =>
    Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";

  function yearFromAny(x) {
    if (x === null || x === undefined) return null;
    const m = String(x).match(/(19|20)\d{2}/);
    return m ? Number(m[0]) : null;
  }

  function parseMonthStart(s) {
    if (!s) return null;
    const str = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + "T00:00:00");
    if (/^\d{4}-\d{2}$/.test(str)) return new Date(str + "-01T00:00:00");
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
    return null;
  }

  function daysInMonth(dt) {
    const y = dt.getFullYear(), m = dt.getMonth();
    return new Date(y, m + 1, 0).getDate();
  }

  function normNivelGeo(x) {
    const s = fixMojibake(String(x || "").trim());
    const low = s.toLowerCase();
    if (low.startsWith("estad")) return "Estado";          // Estado / Estadual
    if (low.startsWith("mun")) return "Município";         // Município / Municipal
    return s;
  }

  function normIBGE7(x) {
    if (x === null || x === undefined) return "";
    const digits = String(x).replace(/\D/g, "");
    if (!digits) return "";
    const d = digits.length > 7 ? digits.slice(-7) : digits.padStart(7, "0");
    return d;
  }

  function detectDelimiter(firstLine) {
    const line = firstLine || "";
    const semis = (line.match(/;/g) || []).length;
    const commas = (line.match(/,/g) || []).length;
    return semis > commas ? ";" : ",";
  }

  // ---------- load CSV / ZIP ----------
  function decodeArrayBufferSmart(buf) {
    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (!utf8.includes("�")) return utf8;
    try { return new TextDecoder("iso-8859-1", { fatal: false }).decode(buf); } catch { return utf8; }
  }

  async function fetchTextMaybeZip(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    const ab = await res.arrayBuffer();

    // ZIP?
    if (url.toLowerCase().endsWith(".zip")) {
      const zip = await JSZip.loadAsync(ab);
      const names = Object.keys(zip.files || {});
      const csvName = names.find((n) => n.toLowerCase().endsWith(".csv")) || names[0];
      if (!csvName) throw new Error("ZIP vazio");
      const file = zip.file(csvName);
      const buf = await file.async("arraybuffer");
      return decodeArrayBufferSmart(buf);
    }
    return decodeArrayBufferSmart(ab);
  }

  async function csvLoad(url) {
    const raw = stripBOM(await fetchTextMaybeZip(url));
    const firstLine = raw.split(/\r?\n/)[0] || "";
    const delim = detectDelimiter(firstLine);

    const parsed = Papa.parse(raw, {
      header: true,
      skipEmptyLines: true,
      delimiter: delim,
      dynamicTyping: false,
    });
    if (parsed.errors && parsed.errors.length) console.warn("PapaParse", url, parsed.errors.slice(0, 5));
    return parsed.data || [];
  }

  function uniqSorted(arr) {
    const s = new Set(arr.filter((v) => !isNil(v)));
    return Array.from(s).sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
  }

  // ---------- breaks (Jenks + zero-aware) ----------
  function jenks(values, nClasses) {
    const data = values.slice().sort((a, b) => a - b);
    const n = data.length;
    if (n === 0) return null;
    if (nClasses <= 1) return [data[0], data[n - 1]];

    const lower = Array.from({ length: n + 1 }, () => Array(nClasses + 1).fill(0));
    const varc = Array.from({ length: n + 1 }, () => Array(nClasses + 1).fill(0));

    for (let i = 1; i <= nClasses; i++) {
      lower[1][i] = 1;
      varc[1][i] = 0;
      for (let j = 2; j <= n; j++) varc[j][i] = Infinity;
    }

    let variance = 0.0;
    for (let l = 2; l <= n; l++) {
      let sum = 0.0, sumSq = 0.0, w = 0.0;
      for (let m = 1; m <= l; m++) {
        const i3 = l - m + 1;
        const val = data[i3 - 1];

        w++;
        sum += val;
        sumSq += val * val;
        variance = sumSq - (sum * sum) / w;

        const i4 = i3 - 1;
        if (i4 !== 0) {
          for (let j = 2; j <= nClasses; j++) {
            if (varc[l][j] >= variance + varc[i4][j - 1]) {
              lower[l][j] = i3;
              varc[l][j] = variance + varc[i4][j - 1];
            }
          }
        }
      }
      lower[l][1] = 1;
      varc[l][1] = variance;
    }

    const kclass = Array(nClasses + 1).fill(0);
    kclass[nClasses] = data[n - 1];
    kclass[0] = data[0];

    let k = n;
    for (let j = nClasses; j >= 2; j--) {
      const id = lower[k][j] - 2;
      kclass[j - 1] = data[id];
      k = lower[k][j] - 1;
    }
    return kclass;
  }

  function smartBreaks(values, k = 5) {
    const vAll = values.filter(Number.isFinite);
    if (!vAll.length) return null;

    const zeros = vAll.filter((x) => x === 0).length;
    const pos = vAll.filter((x) => x > 0).sort((a, b) => a - b);

    // muitos zeros => cria 1 classe para zero + (k-1) para positivos via Jenks
    if (zeros > 0 && pos.length >= 2) {
      const brPos = jenks(pos, Math.max(2, k - 1));
      if (!brPos) return null;
      const br = [0, ...brPos.slice(1)];
      // garante monotonicidade
      for (let i = 1; i < br.length; i++) if (br[i] < br[i - 1]) br[i] = br[i - 1];
      return br;
    }

    // caso geral
    const br = jenks(vAll.sort((a, b) => a - b), Math.max(2, k));
    if (!br) return null;
    for (let i = 1; i < br.length; i++) if (br[i] < br[i - 1]) br[i] = br[i - 1];
    return br;
  }

  // ---------- inject controls + labels ----------
  function ensureInjectedControls() {
    const toggles = document.querySelector(".toggles");
    if (!toggles) return;

    // renomeia rótulos (sem mexer no HTML)
    const lblSeries = document.querySelector('label[for="metricSelect"]');
    if (lblSeries) lblSeries.textContent = "Série (Total/Feminino/Masculino)";

    const lblExtra = document.querySelector('label[for="extraSelect"]');
    if (lblExtra) lblExtra.textContent = "Filtro extra (quando existir)";

    if (!$("viewModeSelect")) {
      const wrap = document.createElement("div");
      wrap.className = "inline-controls";
      wrap.innerHTML = `
        <label class="inline"><span>Visualizar:</span>
          <select id="viewModeSelect">
            <option value="values">Valores</option>
            <option value="rates">Taxas anuais (100 mil)</option>
          </select>
        </label>
        <label class="inline"><span>Série temporal:</span>
          <select id="tsGranularitySelect">
            <option value="monthly">Anos e meses (mensal)</option>
            <option value="annual">Apenas anos (anual)</option>
          </select>
        </label>
        <label class="inline"><span>População (taxa):</span>
          <select id="popSelect">
            <option value="total">Total</option>
            <option value="fem">Feminina</option>
            <option value="masc">Masculina</option>
          </select>
        </label>`;
      toggles.appendChild(wrap);
    }
  }

  // ---------- config + state ----------
  const CFG = window.SINESP_CONFIG;
  if (!CFG || !CFG.panels) {
    console.error("SINESP_CONFIG ausente (assets/config.js).");
    return;
  }

  const STATE = {
    panelKey: null,
    monthly: [],
    annual: [],
    rates: [],
    geo: null,
    map: null,
    mapLayer: null,
    geoLoading: false,
  };

  // ---------- normalize ----------
  function normalizeRow(r) {
    const out = Object.assign({}, r);

    // textos
    for (const k of ["nivel_geo","abrangencia","municipio_sinesp","nome_municipio_pop","evento_clean","arma","agente","faixa_etaria","tipo_instituicao","instituicao"]) {
      if (out[k] !== undefined) out[k] = fixMojibake(String(out[k]).trim());
    }
    if (out.nivel_geo !== undefined) out.nivel_geo = normNivelGeo(out.nivel_geo);

    // chaves
    if (out.cod_ibge_7_pop !== undefined) out.cod_ibge_7_pop = normIBGE7(out.cod_ibge_7_pop);
    if (out.cod_mun_pop !== undefined) out.cod_mun_pop = normIBGE7(out.cod_mun_pop);

    // tempo
    out.ano = yearFromAny(out.ano);
    if (out.ano_mes !== undefined) out.ano_mes_dt = parseMonthStart(out.ano_mes);

    // numéricos (tolerante)
    for (const k of ["num_total","num_fem","num_masc","pop_total","pop_fem","pop_masc","tx_total_100k","tx_fem_100k","tx_masc_100k"]) {
      if (out[k] !== undefined) out[k] = toNumber(out[k]);
    }
    return out;
  }

  const normalizeData = (rows) => (rows || []).map(normalizeRow).filter((r) => r && r.ano !== null);

  const isStateRow = (r) => String(r.nivel_geo || "").toLowerCase().startsWith("estad");
  const isMunicipioRow = (r) => {
    const ng = String(r.nivel_geo || "").toLowerCase();
    return ng.startsWith("mun") || ng.includes("munic");
  };

  function rebuildEstadoFromMunicipios(rows, { freq, extraKey }) {
    const mun = rows.filter(isMunicipioRow);
    if (!mun.length) return [];
    const g = new Map();

    for (const r of mun) {
      const y = r.ano;
      if (!Number.isFinite(y)) continue;

      const ym = freq === "monthly" ? (r.ano_mes_dt instanceof Date ? r.ano_mes_dt.toISOString().slice(0, 10) : null) : null;
      const ev = r.evento_clean || "";
      const extra = extraKey ? (r[extraKey] || "") : "";
      const key = freq === "monthly" ? `${y}|${ym}|${ev}|${extra}` : `${y}|${ev}|${extra}`;

      if (!g.has(key)) {
        g.set(key, {
          nivel_geo: "Estado",
          abrangencia: "Estado",
          cod_ibge_7_pop: "0000000",
          municipio_sinesp: "Rio Grande do Sul",
          nome_municipio_pop: "Rio Grande do Sul",
          ano: y,
          ano_mes_dt: ym ? new Date(ym) : null,
          ano_mes: ym ? ym.slice(0, 7) : null,
          evento_clean: ev,
          num_total: 0,
          num_fem: 0,
          num_masc: 0,
          pop_total: NaN,
          pop_fem: NaN,
          pop_masc: NaN,
          tx_total_100k: NaN,
          tx_fem_100k: NaN,
          tx_masc_100k: NaN,
        });
        if (extraKey) g.get(key)[extraKey] = extra;
      }
      const o = g.get(key);

      // somas
      if (Number.isFinite(r.num_total)) o.num_total += r.num_total;
      if (Number.isFinite(r.num_fem)) o.num_fem += r.num_fem;
      if (Number.isFinite(r.num_masc)) o.num_masc += r.num_masc;

      // pops (max)
      for (const pk of ["pop_total","pop_fem","pop_masc"]) {
        const v = r[pk];
        if (Number.isFinite(v)) {
          if (!Number.isFinite(o[pk]) || v > o[pk]) o[pk] = v;
        }
      }
    }

    // calcula taxas (apenas anual, mas não atrapalha)
    for (const o of g.values()) {
      if (Number.isFinite(o.pop_total) && o.pop_total > 0) o.tx_total_100k = (o.num_total / o.pop_total) * 100000;
      if (Number.isFinite(o.pop_fem) && o.pop_fem > 0) o.tx_fem_100k = (o.num_fem / o.pop_fem) * 100000;
      if (Number.isFinite(o.pop_masc) && o.pop_masc > 0) o.tx_masc_100k = (o.num_masc / o.pop_masc) * 100000;
    }
    return Array.from(g.values());
  }

  // ---------- geo/map ----------
  async function ensureGeo() {
    if (STATE.geo || STATE.geoLoading) return;
    if (!CFG.geojson_url) return;
    STATE.geoLoading = true;
    try {
      const res = await fetch(CFG.geojson_url, { cache: "no-store" });
      if (!res.ok) throw new Error("geojson 404");
      STATE.geo = await res.json();
    } catch (e) {
      console.warn("GeoJSON não carregou:", e);
      STATE.geo = null;
    } finally {
      STATE.geoLoading = false;
    }
  }

  function initMap() {
    if (!els.mapDiv) return;
    if (STATE.map) return;
    STATE.map = L.map(els.mapDiv);
    STATE.map.setView(CFG.map_center || [-30.0346, -51.2177], CFG.map_zoom || 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap" }).addTo(STATE.map);
  }

  function clearMap() {
    if (STATE.map && STATE.mapLayer) {
      STATE.map.removeLayer(STATE.mapLayer);
      STATE.mapLayer = null;
    }
    if (els.mapLegend) els.mapLegend.innerHTML = "";
  }

  function renderMap(valuesByCode, breaks, { isRate = false } = {}) {
    initMap();
    clearMap();
    if (!STATE.map || !STATE.geo) return;

    const colors = CFG.map_colors || ["#ffffb2","#fecc5c","#fd8d3c","#f03b20","#bd0026"];
    const colorFor = (v) => {
      if (!Number.isFinite(v) || !breaks) return "#f0f0f0";
      for (let i = 1; i < breaks.length; i++) if (v <= breaks[i]) return colors[i - 1] || colors[colors.length - 1];
      return colors[colors.length - 1] || "#bd0026";
    };

    const styleFn = (feature) => {
      const p = feature.properties || {};
      const code = normIBGE7(p.CD_MUN || p.cod_ibge_7 || p.CD_GEOCMU || p.CD_MUN7 || "");
      const v = valuesByCode.get(code);
      return { weight: 0.7, color: "#4b5563", fillOpacity: 0.85, fillColor: colorFor(v) };
    };

    const onEach = (feature, layer) => {
      const p = feature.properties || {};
      const name = fixMojibake(p.NM_MUN || p.nome || p.NM_MUNICIP || "Município");
      const code = normIBGE7(p.CD_MUN || p.cod_ibge_7 || p.CD_GEOCMU || p.CD_MUN7 || "");
      const v = valuesByCode.get(code);
      layer.bindTooltip(`${name}<br><b>${isRate ? fmtFloat(v, 2) : fmtInt(v)}</b>`, { sticky: true });
    };

    STATE.mapLayer = L.geoJSON(STATE.geo, { style: styleFn, onEachFeature: onEach }).addTo(STATE.map);

    // legenda
    if (els.mapLegend && breaks) {
      const rows = [];
      for (let i = 0; i < breaks.length - 1; i++) {
        const a = breaks[i], b = breaks[i + 1];
        const txt = (a === b) ? `${isRate ? fmtFloat(b, 2) : fmtInt(b)}` :
          `${isRate ? fmtFloat(a, 2) : fmtInt(a)} – ${isRate ? fmtFloat(b, 2) : fmtInt(b)}`;
        rows.push(`<div class="leg-row"><span class="swatch" style="background:${colors[i] || colors[colors.length-1]}"></span><span>${txt}</span></div>`);
      }
      els.mapLegend.innerHTML = `<div class="leg-title">Distribuição (classes naturais)</div>${rows.join("")}`;
    }

    // corrige o “mapa branco” por renderização em container escondido/resize
    setTimeout(() => {
      try { STATE.map.invalidateSize(); } catch {}
    }, 120);
  }

  // ---------- plot ----------
  function plotTimeSeries(rows, { timeKey, viewMode, valKey, numKey, popKey, seriesName, yTitle, daily }) {
    const div = els.tsDiv;
    if (!div) return;

    const g = new Map();
    for (const r of rows) {
      const t = timeKey === "month" ? r.ano_mes_dt : r.ano;
      if (!t) continue;
      const k = timeKey === "month" ? r.ano_mes_dt.toISOString().slice(0, 10) : String(r.ano);

      if (viewMode === "rates" && numKey && popKey) {
        const num = toNumber(r[numKey]);
        const pop = toNumber(r[popKey]);
        if (!g.has(k)) g.set(k, { num: 0, pop: NaN });
        const o = g.get(k);
        if (Number.isFinite(num)) o.num += num;
        if (Number.isFinite(pop)) {
          if (!Number.isFinite(o.pop) || pop > o.pop) o.pop = pop; // max (não soma)
        }
      } else {
        const v = toNumber(r[valKey]);
        if (!Number.isFinite(v)) continue;
        g.set(k, (g.get(k) || 0) + v);
      }
    }

    const xs = Array.from(g.keys()).sort();
    let ys = [];

    if (viewMode === "rates" && numKey && popKey) {
      ys = xs.map((k) => {
        const o = g.get(k);
        if (!o || !Number.isFinite(o.pop) || o.pop <= 0) return NaN;
        return (o.num / o.pop) * 100000;
      });
    } else {
      ys = xs.map((k) => g.get(k));
    }

    let yAdj = ys.slice();
    if (daily && timeKey === "month" && viewMode === "values") {
      yAdj = xs.map((k, i) => Math.round(ys[i] / daysInMonth(new Date(k + "T00:00:00"))));
    }

    const n = yAdj.filter(Number.isFinite).length;
    const mean = n ? yAdj.filter(Number.isFinite).reduce((a, b) => a + b, 0) / n : NaN;
    const meanArr = xs.map(() => mean);

    // tendência simples
    const idxs = xs.map((_, i) => i);
    let trendArr = xs.map(() => NaN);
    if (xs.length >= 2 && Number.isFinite(mean)) {
      const xMean = (xs.length - 1) / 2;
      const yMean = mean;
      let num = 0, den = 0;
      for (let i = 0; i < xs.length; i++) {
        const yi = yAdj[i];
        if (!Number.isFinite(yi)) continue;
        num += (i - xMean) * (yi - yMean);
        den += (i - xMean) * (i - xMean);
      }
      const b = den ? num / den : 0;
      const a = yMean - b * xMean;
      trendArr = idxs.map((i) => a + b * i);
    }

    Plotly.newPlot(
      div,
      [
        { x: xs, y: yAdj, type: "scatter", mode: "lines+markers", name: seriesName },
        { x: xs, y: meanArr, type: "scatter", mode: "lines", name: "Média", line: { dash: "dot" } },
        { x: xs, y: trendArr, type: "scatter", mode: "lines", name: "Tendência", line: { dash: "dash" } },
      ],
      { margin: { l: 40, r: 10, t: 20, b: 40 }, xaxis: { title: timeKey === "month" ? "Mês" : "Ano" }, yaxis: { title: yTitle }, showlegend: true },
      { responsive: true }
    );
  }

  function plotSexBars(rows, { viewMode, yTitle }) {
    const div = els.sexDiv;
    if (!div) return;

    const fKey = viewMode === "rates" ? "tx_fem_100k" : "num_fem";
    const mKey = viewMode === "rates" ? "tx_masc_100k" : "num_masc";

    // se não houver colunas de sexo, não plota
    const hasF = rows.some((r) => Number.isFinite(toNumber(r[fKey])));
    const hasM = rows.some((r) => Number.isFinite(toNumber(r[mKey])));
    if (!hasF && !hasM) {
      div.innerHTML = "<div class='rank-empty'>Sem desagregação por sexo</div>";
      return false;
    }

    // barras acumuladas do recorte filtrado
    const fem = rows.reduce((s, r) => s + (Number.isFinite(toNumber(r[fKey])) ? toNumber(r[fKey]) : 0), 0);
    const masc = rows.reduce((s, r) => s + (Number.isFinite(toNumber(r[mKey])) ? toNumber(r[mKey]) : 0), 0);

    Plotly.newPlot(
      div,
      [{ x: ["Feminino", "Masculino"], y: [fem, masc], type: "bar" }],
      { margin: { l: 40, r: 10, t: 20, b: 40 }, yaxis: { title: yTitle }, showlegend: false },
      { responsive: true }
    );

    return true;
  }


  function setSideChartTitle(text) {
    try {
      const titleEl = els.sexDiv && els.sexDiv.closest('.panel') ? els.sexDiv.closest('.panel').querySelector('.panel-title') : null;
      if (titleEl) titleEl.textContent = text;
    } catch {}
  }

  function plotExtraBars(rows, { extraKey, yearSel, yTitle }) {
    const div = els.sexDiv;
    if (!div) return;

    // usa o ano selecionado quando possível
    let slice = rows;
    if (Number.isFinite(yearSel)) {
      const s2 = rows.filter((r) => r.ano === yearSel);
      if (s2.length) slice = s2;
    }

    const acc = new Map();
    for (const r of slice) {
      const k = String(r[extraKey] || '').trim();
      if (!k || k.toUpperCase() === 'NÃO INFORMADO') continue;
      const v = toNumber(r.num_total);
      if (!Number.isFinite(v)) continue;
      acc.set(k, (acc.get(k) || 0) + v);
    }

    const items = Array.from(acc.entries()).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
    if (!items.length) {
      div.innerHTML = "<div class='rank-empty'>Sem categorias para comparar</div>";
      return;
    }

    const xs = items.map((d) => d.k);
    const ys = items.map((d) => d.v);

    Plotly.newPlot(
      div,
      [{ x: xs, y: ys, type: 'bar' }],
      { margin: { l: 40, r: 10, t: 20, b: 110 }, xaxis: { tickangle: -35 }, yaxis: { title: yTitle }, showlegend: false },
      { responsive: true }
    );
  }

  function renderRankingTable(items, { isRate, yTitle }) {
    const div = els.rankDiv;
    if (!div) return;
    const fmt = isRate ? (v) => fmtFloat(v, 2) : (v) => fmtInt(v);
    const rows = items
      .map((it, idx) => `<div class="rank-row"><span class="rank-idx">${idx + 1}</span><span class="rank-name">${it.name}</span><span class="rank-val">${fmt(it.value)}</span></div>`)
      .join("");
    div.innerHTML = `<div class="rank-wrap"><div class="rank-head"><span>#</span><span>Município</span><span>${yTitle}</span></div><div class="rank-body">${rows || "<div class='rank-empty'>Sem dados</div>"}</div></div>`;
  }

  // ---------- load panel ----------
  async function loadPanel(panelKey) {
    const p = CFG.panels[panelKey];
    if (!p) throw new Error("Painel inválido: " + panelKey);

    const monthly = p.monthly ? normalizeData(await csvLoad(p.monthly)) : [];
    const annual  = p.annual  ? normalizeData(await csvLoad(p.annual))  : [];
    const rates   = p.ratesAnnual ? normalizeData(await csvLoad(p.ratesAnnual)) : [];

    return { monthly, annual, rates };
  }

  // ---------- extra filter detection ----------
  const EXTRA_LABELS = {
    arma: "Tipo de arma",
    agente: "Agente",
    faixa_etaria: "Faixa etária",
    tipo_instituicao: "Tipo de instituição",
    instituicao: "Tipo de instituição",
  };
  const EXTRA_CANDIDATES = ["tipo_instituicao","instituicao","arma","agente","faixa_etaria"];

  function detectExtraKey(rows) {
    for (const k of EXTRA_CANDIDATES) {
      if (!rows.length) continue;
      if (!(k in rows[0])) continue;
      const uniq = new Set();
      for (const r of rows) {
        const v = r[k];
        if (isNil(v)) continue;
        const vv = String(v).trim();
        if (!vv || vv.toUpperCase() === "NÃO INFORMADO") continue;
        uniq.add(vv);
        if (uniq.size > 1) return k;
      }
    }
    return null;
  }

  // ---------- filtros ----------
  function fillSelect(el, options, { includeAll = false, allLabel = "Todos", allValue = "__ALL__" } = {}) {
    const cur = el.value;
    el.innerHTML = "";
    if (includeAll) {
      const o = document.createElement("option");
      o.value = allValue;
      o.textContent = allLabel;
      el.appendChild(o);
    }
    for (const v of options) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      el.appendChild(o);
    }
    if (cur && [...el.options].some((op) => op.value === cur)) el.value = cur;
  }

  function currentExtraKey() {
    return els.extra && els.extra.dataset && els.extra.dataset.key ? els.extra.dataset.key : null;
  }

  function applyFilters(baseRows, { freq, scope, event, mun, extraKey, extraVal }) {
    let rows = baseRows.slice();

    // evento é obrigatório
    rows = rows.filter((r) => (r.evento_clean || "") === event);

    // scope
    if (scope === "Estado") {
      let st = rows.filter(isStateRow);

      // FIX (Vítimas): quando o Estado existe mas vem zerado,
      // usa a soma dos municípios para não confundir o usuário.
      if (st.length && STATE.panelKey === "vitimas") {
        const sumSt = st.reduce((s, r) => s + (Number.isFinite(r.num_total) ? r.num_total : 0), 0);
        const mun = rows.filter(isMunicipioRow);
        const sumMun = mun.reduce((s, r) => s + (Number.isFinite(r.num_total) ? r.num_total : 0), 0);
        if (sumSt === 0 && sumMun > 0) {
          st = rebuildEstadoFromMunicipios(rows, { freq, extraKey });
        }
      }

      if (!st.length) st = rebuildEstadoFromMunicipios(rows, { freq, extraKey });
      rows = st;
    } else if (scope === "Município") {
      rows = rows.filter(isMunicipioRow);
    }

    // município (apenas quando scope município)
    if (scope === "Município" && mun && mun !== "__ALL__") {
      rows = rows.filter((r) => r.municipio_sinesp === mun || r.nome_municipio_pop === mun);
    }

    // extra
    if (extraKey && extraVal && extraVal !== "__ALL__") {
      rows = rows.filter((r) => String(r[extraKey] || "") === extraVal);
    }

    return rows;
  }

  // ---------- KPIs ----------
  function setKPIs({ monthlyRowsValues, annualRowsValues, annualRowsRates, yearSel, popKey }) {
    // KPI1: último mês (valores)
    let mm = monthlyRowsValues.filter((r) => r.ano_mes_dt instanceof Date);
    // usa o último mês *do ano selecionado* (evita ficar travado em 2025 quando o usuário escolhe 2015/2017 etc.)
    if (Number.isFinite(yearSel)) {
      const mmYear = mm.filter((r) => r.ano === yearSel);
      if (mmYear.length) mm = mmYear;
    }
    mm = mm.sort((a, b) => a.ano_mes_dt - b.ano_mes_dt);
    if (mm.length) {
      const last = mm[mm.length - 1];
      let v = toNumber(last.num_total);
      let label = "Total no último mês";
      if (els.daily.checked) {
        v = Math.round(v / daysInMonth(last.ano_mes_dt));
        label = "Casos por dia (inteiro)";
      }
      els.kpi1L.textContent = label;
      els.kpi1V.textContent = fmtInt(v);
      els.kpi1F.textContent = last.ano_mes_dt.toISOString().slice(0, 10);
    } else {
      els.kpi1L.textContent = "Total no último mês";
      els.kpi1V.textContent = "—";
      els.kpi1F.textContent = "—";
    }

    // KPI2: total no ano (valores)
    const totYear = annualRowsValues.filter((r) => r.ano === yearSel).reduce((s, r) => s + (Number.isFinite(r.num_total) ? r.num_total : 0), 0);
    els.kpi2L.textContent = "Total no ano";
    els.kpi2V.textContent = Number.isFinite(totYear) ? fmtInt(totYear) : "—";
    els.kpi2F.textContent = Number.isFinite(yearSel) ? String(yearSel) : "—";

    // KPI3: taxa anual (se houver)
    if (annualRowsRates.length) {
      const numKey = popKey === "fem" ? "num_fem" : popKey === "masc" ? "num_masc" : "num_total";
      const denKey = popKey === "fem" ? "pop_fem" : popKey === "masc" ? "pop_masc" : "pop_total";

      const slice = annualRowsRates.filter((r) => r.ano === yearSel);
      let num = 0;
      let den = NaN;
      for (const r of slice) {
        const n = toNumber(r[numKey]);
        const p = toNumber(r[denKey]);
        if (Number.isFinite(n)) num += n;
        if (Number.isFinite(p)) den = !Number.isFinite(den) ? p : Math.max(den, p); // max (não soma)
      }
      const rate = Number.isFinite(den) && den > 0 ? (num / den) * 100000 : NaN;
      els.kpi3V.textContent = fmtFloat(rate, 2);
      els.kpi3F.textContent = Number.isFinite(yearSel) ? String(yearSel) : "—";
    } else {
      els.kpi3V.textContent = "—";
      els.kpi3F.textContent = "Sem taxas";
    }
  }

  // ---------- render ----------
  async function render() {
    ensureInjectedControls();

    const viewModeEl = $("viewModeSelect");
    const granEl = $("tsGranularitySelect");
    const popEl = $("popSelect");

    const panelKey = els.panel.value;
    if (panelKey !== STATE.panelKey || (!STATE.monthly.length && !STATE.annual.length)) {
      STATE.panelKey = panelKey;
      const d = await loadPanel(panelKey);
      STATE.monthly = d.monthly;
      STATE.annual = d.annual;
      STATE.rates = d.rates;
      await ensureGeo();
    }

    // disponibilidade de taxas (apenas anuais)
    const hasRates = STATE.rates && STATE.rates.length;
    if (!hasRates) {
      // força "Valores"
      viewModeEl.value = "values";
      viewModeEl.querySelector('option[value="rates"]').disabled = true;
    } else {
      viewModeEl.querySelector('option[value="rates"]').disabled = false;
    }

    // taxas => sempre anual
    if (viewModeEl.value === "rates") {
      granEl.value = "annual";
    }
    // se estiver mensal, desabilita pop (taxa)
    popEl.disabled = viewModeEl.value !== "rates";

    // Evento: SEM "Todos"
    const baseForEvents = granEl.value === "annual" ? STATE.annual : STATE.monthly;
    const events = uniqSorted(baseForEvents.map((r) => r.evento_clean).filter((v) => !isNil(v)));
    fillSelect(els.event, events, { includeAll: false });
    if (!els.event.value && events.length) els.event.value = events[0];

    const eventSel = els.event.value;

    // scope: habilita/desabilita conforme disponibilidade (ou reconstrução)
    const hasMun = baseForEvents.some((r) => (r.evento_clean === eventSel) && isMunicipioRow(r));
    const hasState = baseForEvents.some((r) => (r.evento_clean === eventSel) && isStateRow(r)) || hasMun;
    // aplica
    const optEstado = els.scope.querySelector('option[value="Estado"]');
    const optMun = els.scope.querySelector('option[value="Município"]');
    if (optEstado) optEstado.disabled = !hasState;
    if (optMun) optMun.disabled = !hasMun;
    if (els.scope.value === "Estado" && !hasState && hasMun) els.scope.value = "Município";
    if (els.scope.value === "Município" && !hasMun && hasState) els.scope.value = "Estado";

    // Série (valores): só mostra sexo se existir no painel/evento
    const baseForSeries = STATE.annual.length ? STATE.annual : baseForEvents;
    const evSliceForSeries = baseForSeries.filter((r) => (r.evento_clean === eventSel));
    const hasSex = evSliceForSeries.some((r) => Number.isFinite(toNumber(r.num_fem)) || Number.isFinite(toNumber(r.num_masc)));
    const seriesOpts = hasSex ? [
      { v: "total", t: "Total" },
      { v: "fem", t: "Feminino" },
      { v: "masc", t: "Masculino" },
    ] : [{ v: "total", t: "Total" }];
    // preenche
    els.series.innerHTML = "";
    for (const o of seriesOpts) {
      const op = document.createElement("option");
      op.value = o.v;
      op.textContent = o.t;
      els.series.appendChild(op);
    }
    if (![...els.series.options].some((x) => x.value === els.series.value)) els.series.value = "total";

    // Município select (quando aplicável) — mantém opção "Todos os municípios"
    els.mun.disabled = els.scope.value !== "Município";
    if (els.scope.value === "Município") {
      const munRows = STATE.monthly.filter((r) => isMunicipioRow(r) && (r.evento_clean === eventSel));
      const muns = uniqSorted(munRows.map((r) => r.municipio_sinesp).filter((v) => !isNil(v) && String(v).toUpperCase() !== "NÃO INFORMADO"));
      fillSelect(els.mun, muns, { includeAll: true, allLabel: "Todos os municípios", allValue: "__ALL__" });
      if (!els.mun.value) els.mun.value = "__ALL__";
    } else {
      els.mun.innerHTML = "";
      els.mun.value = "";
    }

    // Extra filter: detecta chave depois de evento + scope (hierarquia)
    let extraPool = baseForEvents.filter((r) => (r.evento_clean === eventSel));
    if (scopeSel === "Estado") {
      const st = extraPool.filter(isStateRow);
      extraPool = st.length ? st : extraPool.filter(isMunicipioRow); // fallback: usa municípios p/ detectar extra
    } else {
      extraPool = extraPool.filter(isMunicipioRow);
    }

    const extraKey = detectExtraKey(extraPool);
    const lblExtra = document.querySelector('label[for="extraSelect"]');
    if (extraKey) {
      els.extra.disabled = false;
      els.extra.dataset.key = extraKey;
      const opts = uniqSorted(extraPool.map((r) => r[extraKey]).filter((v) => !isNil(v) && String(v).toUpperCase() !== "NÃO INFORMADO"));
      fillSelect(els.extra, opts, { includeAll: true, allLabel: "Todos", allValue: "__ALL__" });
      if (!els.extra.value) els.extra.value = "__ALL__";
      if (lblExtra) lblExtra.textContent = (EXTRA_LABELS[extraKey] || "Filtro extra") + " (quando existir)";
    } else {
      els.extra.disabled = true;
      els.extra.innerHTML = "";
      els.extra.value = "";
      if (els.extra.dataset) delete els.extra.dataset.key;
      if (lblExtra) lblExtra.textContent = "Filtro extra (não aplicável)";
    }

    const extraVal = extraKey ? (els.extra.value || "__ALL__") : "__ALL__";

    // Anos (sempre vindo do ANUAL de valores — coerente com cards/map/calculadora)
    const annualForYearsRaw = applyFilters(STATE.annual, { freq: "annual", scope: scopeSel, event: eventSel, mun: els.mun.value || "__ALL__", extraKey, extraVal });
    const yrs = uniqSorted(annualForYearsRaw.map((r) => r.ano)).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    fillSelect(els.year, yrs.map(String));
    fillSelect(els.yearA, yrs.map(String));
    fillSelect(els.yearB, yrs.map(String));
    if (!els.year.value && yrs.length) els.year.value = String(yrs[0]);
    if (!els.yearA.value && yrs.length) els.yearA.value = String(yrs[0]);
    if (!els.yearB.value && yrs.length) els.yearB.value = String(yrs[yrs.length - 1]);

    const yearSel = Number(els.year.value);

    // recortes finais para render
    const monthlyValues = applyFilters(STATE.monthly, { freq: "monthly", scope: scopeSel, event: eventSel, mun: els.mun.value || "__ALL__", extraKey, extraVal });
    const annualValues  = applyFilters(STATE.annual,  { freq: "annual",  scope: scopeSel, event: eventSel, mun: els.mun.value || "__ALL__", extraKey, extraVal });
    const annualRates   = hasRates ? applyFilters(STATE.rates, { freq: "annual", scope: scopeSel, event: eventSel, mun: els.mun.value || "__ALL__", extraKey, extraVal }) : [];

    // KPIs (valores + taxa anual)
    const popKey = popEl.value;
    setKPIs({ monthlyRowsValues: monthlyValues, annualRowsValues: annualValues, annualRowsRates: annualRates, yearSel, popKey });

    // plot: time series
    let yTitle = "Casos";
    let seriesName = els.series.value === "fem" ? "Feminino" : els.series.value === "masc" ? "Masculino" : "Total";

    if (viewModeEl.value === "rates") {
      yTitle = "Taxa (100 mil) — anual";
      const numKey = popKey === "fem" ? "num_fem" : popKey === "masc" ? "num_masc" : "num_total";
      const popCol = popKey === "fem" ? "pop_fem" : popKey === "masc" ? "pop_masc" : "pop_total";
      plotTimeSeries(annualRates, { timeKey: "year", viewMode: "rates", valKey: null, numKey, popKey: popCol, seriesName: `Taxa (${popKey})`, yTitle, daily: false });
    } else {
      const valKey = els.series.value === "fem" ? "num_fem" : els.series.value === "masc" ? "num_masc" : "num_total";
      if (granEl.value === "annual") plotTimeSeries(annualValues, { timeKey: "year", viewMode: "values", valKey, seriesName, yTitle, daily: false });
      else plotTimeSeries(monthlyValues, { timeKey: "month", viewMode: "values", valKey, seriesName, yTitle, daily: els.daily.checked });
    }

    // barras (sexo quando existir; senão, usa o filtro extra quando aplicável)
    const sideRows = viewModeEl.value === "rates" ? annualRates : annualValues;
    const sideYTitle = viewModeEl.value === "rates" ? "Taxa (100 mil)" : "Casos";
    const didSex = plotSexBars(sideRows, { viewMode: viewModeEl.value, yTitle: sideYTitle });
    if (!didSex && extraKey) {
      setSideChartTitle(`Distribuição por ${EXTRA_LABELS[extraKey] || extraKey}`);
      plotExtraBars(sideRows, { extraKey, yearSel, yTitle: sideYTitle });
    } else {
      setSideChartTitle('Comparativo por sexo (barras — quando existir)');
    }

    // ranking + mapa (apenas para scope município)
    if (scopeSel === "Município") {
      const baseRankRaw = viewModeEl.value === "rates" ? (hasRates ? STATE.rates : []) : STATE.annual;
      let rankRows = baseRankRaw.filter(isMunicipioRow).filter((r) => r.ano === yearSel).filter((r) => r.evento_clean === eventSel);

      // aplica extra (hierarquia)
      if (extraKey && extraVal && extraVal !== "__ALL__") rankRows = rankRows.filter((r) => String(r[extraKey] || "") === extraVal);

      // agrega por município (valores soma; taxas recalculadas por num/pop)
      const items = [];
      const byCode = new Map();
      const vals = [];

      if (viewModeEl.value === "rates" && hasRates) {
        const popKey2 = popEl.value;
        const numKey = popKey2 === "fem" ? "num_fem" : popKey2 === "masc" ? "num_masc" : "num_total";
        const denKey = popKey2 === "fem" ? "pop_fem" : popKey2 === "masc" ? "pop_masc" : "pop_total";

        const acc = new Map(); // name -> {num, pop}
        const accCode = new Map(); // code -> {num,pop}
        for (const r of rankRows) {
          const name = r.municipio_sinesp || r.nome_municipio_pop;
          const code = normIBGE7(r.cod_ibge_7_pop || r.cod_mun_pop || "");
          if (isNil(name) || String(name).toUpperCase() === "NÃO INFORMADO") continue;

          const n = toNumber(r[numKey]);
          const p = toNumber(r[denKey]);

          if (!acc.has(name)) acc.set(name, { num: 0, pop: NaN });
          const o = acc.get(name);
          if (Number.isFinite(n)) o.num += n;
          if (Number.isFinite(p)) o.pop = !Number.isFinite(o.pop) ? p : Math.max(o.pop, p);

          if (code) {
            if (!accCode.has(code)) accCode.set(code, { num: 0, pop: NaN });
            const oc = accCode.get(code);
            if (Number.isFinite(n)) oc.num += n;
            if (Number.isFinite(p)) oc.pop = !Number.isFinite(oc.pop) ? p : Math.max(oc.pop, p);
          }
        }

        for (const [name, o] of acc.entries()) {
          const rate = Number.isFinite(o.pop) && o.pop > 0 ? (o.num / o.pop) * 100000 : NaN;
          if (Number.isFinite(rate)) items.push({ name, value: rate });
        }
        items.sort((a, b) => b.value - a.value);

        for (const [code, o] of accCode.entries()) {
          const rate = Number.isFinite(o.pop) && o.pop > 0 ? (o.num / o.pop) * 100000 : NaN;
          if (Number.isFinite(rate)) {
            byCode.set(code, rate);
            vals.push(rate);
          }
        }

        const breaks = smartBreaks(vals, 5);
        renderRankingTable(items.slice(0, 20), { isRate: true, yTitle: "Taxa (100 mil)" });
        renderMap(byCode, breaks, { isRate: true });
      } else {
        const acc = new Map();
        const accCode = new Map();
        for (const r of rankRows) {
          const name = r.municipio_sinesp || r.nome_municipio_pop;
          const code = normIBGE7(r.cod_ibge_7_pop || r.cod_mun_pop || "");
          if (isNil(name) || String(name).toUpperCase() === "NÃO INFORMADO") continue;

          const v = toNumber(r.num_total);
          if (Number.isFinite(v)) {
            acc.set(name, (acc.get(name) || 0) + v);
            if (code) accCode.set(code, (accCode.get(code) || 0) + v);
          }
        }
        for (const [name, v] of acc.entries()) items.push({ name, value: v });
        items.sort((a, b) => b.value - a.value);

        for (const v of accCode.values()) vals.push(v);
        const breaks = smartBreaks(vals, 5);

        renderRankingTable(items.slice(0, 20), { isRate: false, yTitle: "Casos" });
        renderMap(accCode, breaks, { isRate: false });
      }
    } else {
      if (els.rankDiv) els.rankDiv.innerHTML = "<div class='rank-empty'>Disponível apenas para Município</div>";
      clearMap();
    }

    // calculadora (usa o modo de visualização atual: valores ou taxas anuais)
    const a = Number(els.yearA.value), b = Number(els.yearB.value);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
      if (viewModeEl.value === "rates" && hasRates) {
        const popKey2 = popEl.value;
        const numKey = popKey2 === "fem" ? "num_fem" : popKey2 === "masc" ? "num_masc" : "num_total";
        const denKey = popKey2 === "fem" ? "pop_fem" : popKey2 === "masc" ? "pop_masc" : "pop_total";

        const calcRate = (year) => {
          const slice = annualRates.filter((r) => r.ano === year);
          let num = 0, den = NaN;
          for (const r of slice) {
            const n = toNumber(r[numKey]);
            const p = toNumber(r[denKey]);
            if (Number.isFinite(n)) num += n;
            if (Number.isFinite(p)) den = !Number.isFinite(den) ? p : Math.max(den, p);
          }
          return Number.isFinite(den) && den > 0 ? (num / den) * 100000 : NaN;
        };

        const vA = calcRate(a);
        const vB = calcRate(b);
        const dAbs = vB - vA;
        const dPct = vA !== 0 ? (dAbs / vA) * 100 : NaN;
        els.calcAbs.textContent = fmtFloat(dAbs, 2);
        els.calcPct.textContent = Number.isFinite(dPct) ? fmtFloat(dPct, 2) + "%" : "—";
        els.calcTax.textContent = "Taxa anual";
      } else {
        const vA = annualValues.filter((r) => r.ano === a).reduce((s, r) => s + (Number.isFinite(r.num_total) ? r.num_total : 0), 0);
        const vB = annualValues.filter((r) => r.ano === b).reduce((s, r) => s + (Number.isFinite(r.num_total) ? r.num_total : 0), 0);
        const dAbs = vB - vA;
        const dPct = vA !== 0 ? (dAbs / vA) * 100 : NaN;
        els.calcAbs.textContent = fmtInt(dAbs);
        els.calcPct.textContent = Number.isFinite(dPct) ? fmtFloat(dPct, 2) + "%" : "—";
        els.calcTax.textContent = hasRates ? "Taxa disponível" : "—";
      }
    } else {
      els.calcAbs.textContent = "—";
      els.calcPct.textContent = "—";
      els.calcTax.textContent = "—";
    }
  }

  // ---------- init ----------
  function resetFiltersSoft() {
    const viewModeEl = $("viewModeSelect");
    const granEl = $("tsGranularitySelect");
    const popEl = $("popSelect");

    els.scope.value = "Estado";
    els.mun.value = "__ALL__";
    els.extra.value = "__ALL__";
    els.daily.checked = false;

    if (viewModeEl) viewModeEl.value = "values";
    if (granEl) granEl.value = "monthly";
    if (popEl) popEl.value = "total";
    if (els.series) els.series.value = "total";
  }

  function bind() {
    // troca de painel: limpa estado carregado
    els.panel.addEventListener("change", async () => {
      STATE.panelKey = null;
      STATE.monthly = [];
      STATE.annual = [];
      STATE.rates = [];
      await render();
    });

    for (const el of [els.event, els.scope, els.mun, els.series, els.year, els.extra, els.daily, els.yearA, els.yearB]) {
      if (!el) continue;
      el.addEventListener("change", () => render().catch(console.error));
      el.addEventListener("input", () => render().catch(console.error));
    }

    const viewModeEl = $("viewModeSelect");
    const granEl = $("tsGranularitySelect");
    const popEl = $("popSelect");
    if (viewModeEl) viewModeEl.addEventListener("change", () => render().catch(console.error));
    if (granEl) granEl.addEventListener("change", () => render().catch(console.error));
    if (popEl) popEl.addEventListener("change", () => render().catch(console.error));

    els.reset.addEventListener("click", async (e) => {
      e.preventDefault();
      resetFiltersSoft();
      await render();
    });
  }

  async function start() {
    ensureInjectedControls();

    // painel select
    const keys = Object.keys(CFG.panels);
    els.panel.innerHTML = "";
    for (const k of keys) {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = CFG.panels[k].label || k;
      els.panel.appendChild(o);
    }
    if (!els.panel.value && keys.length) els.panel.value = keys[0];

    await ensureGeo();
    bind();
    resetFiltersSoft();
    await render();
  }

  start().catch((err) => {
    console.error(err);
    if (els.tsDiv) els.tsDiv.innerHTML = `<div style="padding:12px;color:#b00"><b>Erro:</b> ${String(err.message || err)}</div>`;
  });
})();