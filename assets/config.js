
// config.js — alinhado com seus nomes e com geojson em /data
window.SINESP_CONFIG = {
  geojson_url: "./data/rs_municipios_simplificado.geojson",
  map_center: [-30.0346, -51.2177],
  map_zoom: 6,
  map_colors: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  panels: {
    vitimas: { label: "1 — Vítimas", monthly: "./data/vitimas_mensal.zip", annual: "./data/vitimas_anual.csv", ratesAnnual: "./data/vitimas_taxas_anuais.csv" },
    ocorrencias: { label: "2 — Ocorrências", monthly: "./data/ocorrencias_mensal.csv", annual: "./data/ocorrencias_anual.csv" },
    drogas_peso: { label: "3 — Drogas (peso)", monthly: "./data/drogas_peso_mensal.csv", annual: "./data/drogas_peso_anual.csv" },
    drogas_trafico: { label: "3 — Drogas (tráfico ocorr.)", monthly: "./data/drogas_trafico_ocorr_mensal.csv", annual: "./data/drogas_trafico_ocorr_anual.csv" },
    armas: { label: "4 — Armas", monthly: "./data/armas_mensal.csv", annual: "./data/armas_anual.csv" },
    bombeiros: { label: "5 — Bombeiros", monthly: "./data/bombeiros_mensal.csv", annual: "./data/bombeiros_anual.csv" },
    desaparecidos: { label: "6 — Desaparecidos/Localizados", monthly: "./data/desaparecidos_mensal.csv", annual: "./data/desaparecidos_anual.csv", ratesAnnual: "./data/desaparecidos_taxas_anuais.csv" },
    seguranca: { label: "7 — Segurança Pública", monthly: "./data/seguranca_mensal.csv", annual: "./data/seguranca_anual.csv" },
    presos: { label: "8 — Presos (Mandados)", monthly: "./data/presos_mensal.csv", annual: "./data/presos_anual.csv" }
  }
};
