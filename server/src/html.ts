import { createHash } from "node:crypto";
import type { Photo, Plan, Stop } from "../../shared/types.js";
import { DAY_COLORS } from "../../shared/types.js";
import type { Config } from "./config.js";
import { getMap, escapeHtml as h, type MapResult } from "./maps.js";
import {
  MAP_RUNTIME,
  MAP_CSS,
  itineraryMapPoints,
  type BrowserMapConfig,
} from "../../shared/interactive-map.js";
import { browserMapConfig } from "./browser-map.js";
import {
  coverPhoto,
  photoImageUrl,
  photoLink,
  photoSource,
} from "../../shared/photos.js";

const money = (v: number | null) =>
  v === null
    ? "待查询"
    : `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
const typeName = {
  attraction: "风景与故事",
  food: "寻味当地",
  hotel: "安心休息",
  transport: "在路上",
};
function picture(photo: Photo | undefined, name: string, hero = false) {
  const src = photo && photoImageUrl(photo.url);
  if (!src)
    return `<div class="photo-empty"><span>沿途的画面，留给亲眼遇见</span><small>${h(name)} · 暂无匹配照片</small></div>`;
  const credit =
    photo!.source === "amap-poi"
      ? ""
      : `摄影 <a href="${h(photoLink(photo!.profileUrl))}" target="_blank" rel="noopener noreferrer">${h(photo!.photographer)}</a> / `;
  return `<figure class="photo ${hero ? "cover-photo" : ""}"><div class="photo-frame"><img src="${h(src)}" data-fallbacks="${h(JSON.stringify((photo!.fallbackUrls || []).map(photoImageUrl).filter(Boolean)))}" alt="${h(photo!.alt)}" loading="${hero ? "eager" : "lazy"}" referrerpolicy="no-referrer"/><span class="photo-failure">图片暂时无法加载 · 可通过下方来源查看</span></div><figcaption><span>${h(photo!.caption || "相关配图")}</span><small>${credit}<a href="${h(photoLink(photo!.photoUrl))}" target="_blank" rel="noopener noreferrer">${h(photoSource(photo!))} ↗</a></small></figcaption></figure>`;
}
function mapFigure(
  map: MapResult,
  title: string,
  day = 0,
  interactive = false,
) {
  const safe =
    /^data:image\/(svg\+xml|png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(
      map.image,
    )
      ? map.image
      : "";
  return `<figure class="route-map"><div class="label">${h(title)}<span>${interactive ? "高德交互地图" : map.kind === "amap" ? "高德地图" : "游览顺序示意"}</span></div><div class="roam-map-frame">${safe ? `<img class="map-fallback" src="${safe}" alt="${h(title)}"/>` : `<p>静态预览暂不可用</p>`}${interactive ? `<div data-interactive-map="${day}"></div>` : ""}</div><small class="roam-map-status" role="status">${interactive ? "联网可拖动、缩放、点击编号；离线显示内嵌预览" : "配置网页端 JS API Key 后重新导出可获得交互地图"}</small><figcaption>${interactive ? "地图连线表示游览顺序，不作为实际道路导航。" : h(map.caption)}${map.missing.length ? `<br/>待核验：${map.missing.map(h).join("、")}` : ""}</figcaption></figure>`;
}
function destinationCard(stop: Stop, day: number, index: number) {
  return `<article class="destination-card">${picture(stop.photo, stop.name)}<div class="destination-body"><div class="eyebrow">DAY ${String(day).padStart(2, "0")} · ${index + 1} / ${typeName[stop.type]}</div><h3>${h(stop.name)}</h3><p>${h(stop.description)}</p><div class="card-meta"><span>${h(stop.duration)}</span><span>${money(stop.cost)} · 参考</span></div><p class="tip">${h(stop.tip)}</p></div></article>`;
}

// Itinerary strings in markup are escaped; map data is serialized separately below.
const script = `(() => {
  document.documentElement.classList.add('enhanced');
  function select(group, value) {
    document.querySelectorAll('[data-' + group + ']').forEach(button => button.setAttribute('aria-pressed', String(button.dataset[group] === value)));
    document.querySelectorAll('[data-' + group + '-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset[group + 'Panel'] === value));
  }
  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => {
    select('section', button.dataset.section);
    document.getElementById('guide').scrollIntoView({behavior: 'smooth', block: 'start'});
  }));
  document.querySelectorAll('[data-day]').forEach(button => button.addEventListener('click', () => select('day', button.dataset.day)));
  document.querySelectorAll('.photo img').forEach(img => {
    const fallbacks = JSON.parse(img.dataset.fallbacks || '[]');
    const fail = () => { if (fallbacks.length) img.src = fallbacks.shift(); else img.closest('.photo').classList.add('failed'); };
    img.addEventListener('error', fail);
    if (img.complete && !img.naturalWidth) fail();
  });
  document.getElementById('print').addEventListener('click', () => window.print());
})();`;

function interactiveScript(plan: Plan, config: BrowserMapConfig): string {
  if (!config.key) return "";
  const data = JSON.stringify({ config, points: itineraryMapPoints(plan) })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `${MAP_RUNTIME}\n(() => {
    const data = ${data};
    const controllers = new Map();
    function activate() {
      document.querySelectorAll('[data-interactive-map]').forEach(host => {
        if (!host.parentElement.getClientRects().length || host.closest('details:not([open])')) return;
        if (controllers.has(host)) return;
        const day = Number(host.dataset.interactiveMap);
        const status = host.closest('figure').querySelector('.roam-map-status');
        const controller = window.RoamMaps.create(host, { ...data.config, day, points: data.points.filter(p => !day || p.day === day) }, (state, message) => {
          host.parentElement.classList.toggle('has-live-map', state === 'ready');
          status.textContent = message;
          if (state === 'error') {
            const retry = document.createElement('button'); retry.textContent = '重试交互地图';
            retry.onclick = () => { const old = controllers.get(host); if (old) old.destroy(); controllers.delete(host); activate(); };
            status.append(retry);
          }
        });
        controllers.set(host, controller);
      });
    }
    document.querySelectorAll('[data-day], [data-section]').forEach(button => button.addEventListener('click', () => requestAnimationFrame(activate)));
    document.querySelectorAll('details.overview').forEach(details => details.addEventListener('toggle', activate));
    window.addEventListener('online', () => {
      controllers.forEach((controller, host) => { if (host.dataset.state === 'error') { controller.destroy(); controllers.delete(host); } });
      activate();
    });
    activate();
  })();`;
}

const css = `
:root{--ink:#3d3b32;--muted:#898477;--gold:#a37b53;--cream:#f7f4ee;--line:#e5dfd4;--green:#526b59}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--cream);color:var(--ink);font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif;font-size:14px;line-height:1.8}button,a{-webkit-tap-highlight-color:transparent}button{font:inherit;cursor:pointer}a{color:inherit;text-underline-offset:3px}img{max-width:100%}button:focus-visible,a:focus-visible{outline:3px solid #a37b53;outline-offset:4px}h1,h2,h3,p,figure{margin:0}h1,h2,h3{font-family:"Noto Serif SC","Songti SC",SimSun,serif;font-weight:500;line-height:1.4}h2{font-size:30px}h3{font-size:22px}button{border:0;background:none;color:inherit}.wrap{width:min(1160px,calc(100% - 64px));margin:auto}.topbar{position:sticky;top:0;z-index:5;background:rgba(247,244,238,.96);border-bottom:1px solid var(--line)}.nav-inner{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:78px}.brand{font-family:Georgia,"Songti SC",serif;font-size:27px;white-space:nowrap}.brand span{font-size:11px;letter-spacing:3px;color:var(--gold);margin-left:12px}.navigation{display:flex;gap:6px;overflow:auto}.navigation button{white-space:nowrap;padding:9px 15px;border-radius:30px;color:#797367;font-size:13px}.navigation button[aria-pressed=true]{background:var(--ink);color:white}.print{white-space:nowrap;border:1px solid var(--line);border-radius:25px;padding:8px 15px;font-size:12px}.hero{padding:62px 0 42px;display:grid;grid-template-columns:1fr 1fr;gap:54px;align-items:center}.eyebrow{font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:var(--gold)}.hero h1{text-wrap:balance;font-size:clamp(32px,4.4vw,58px);margin:18px 0 15px;letter-spacing:2px}.hero .subtitle{font-family:"Songti SC",SimSun,serif;font-size:21px;color:var(--gold)}.summary{color:#817a6d;line-height:2.1;margin-top:24px}.trip-meta{display:flex;flex-wrap:wrap;gap:12px 24px;margin-top:26px;padding-top:20px;border-top:1px solid var(--line);font-size:12px;color:#777466}.trip-meta b{color:var(--ink);font-weight:500}.photo{min-width:0}.photo-frame{position:relative;background:#e8e6de;overflow:hidden;border-radius:10px}.photo img{width:100%;height:218px;display:block;object-fit:cover;transition:transform .4s}.photo:hover img{transform:scale(1.025)}.cover-photo img{height:360px}.cover-photo .photo-frame{border-radius:110px 10px 10px 10px}.photo figcaption{font-size:10px;line-height:1.6;color:var(--muted);padding-top:8px;display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:space-between}.photo figcaption small{font-size:10px}.photo-failure{display:none;font-size:12px;padding:60px 20px;text-align:center;color:var(--muted)}.photo.failed img{display:none}.photo.failed .photo-failure{display:block}.photo-empty{background:linear-gradient(135deg,#eee9df,#e3e9df);border-radius:10px;min-height:140px;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#8d9485;padding:20px;text-align:center;font-family:"Songti SC",SimSun,serif}.photo-empty small{font:11px Arial,sans-serif;margin-top:10px;color:#94998e}.stats{display:grid;grid-template-columns:repeat(4,1fr);padding:24px 0;border-block:1px solid var(--line);margin-bottom:48px}.stats div{padding-left:26px;border-left:1px solid var(--line)}.stats div:first-child{border:0;padding:0}.stats small{color:var(--muted);display:block;font-size:11px}.stats strong{font:26px Georgia,"Songti SC",serif;font-weight:400}.stats strong span{font:12px Arial,sans-serif;margin-left:7px}.section-head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:25px}.section-head h2{margin-top:6px}.section-head p{color:var(--muted);font-size:12px}.day-nav{display:flex;gap:10px;margin-bottom:24px;overflow:auto;padding:3px 0}.day-nav button{padding:11px 22px;border:1px solid var(--line);border-radius:40px;white-space:nowrap;font-size:12px}.day-nav button b{font-size:12px;letter-spacing:1px;margin-right:12px}.day-nav button[aria-pressed=true]{background:var(--gold);border-color:var(--gold);color:#fff}.enhanced [data-section-panel]:not(.active),.enhanced [data-day-panel]:not(.active){display:none}[data-section-panel]{margin-bottom:45px}#guide{scroll-margin-top:105px}.day-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:30px}.day-main{background:#fff;border:1px solid var(--line);border-radius:15px;padding:30px}.day-header{display:flex;gap:20px;align-items:center;padding-bottom:23px;border-bottom:1px solid var(--line)}.day-number{font:52px Georgia,serif;color:var(--gold)}.day-header h3{font-size:24px}.day-header p{font-size:12px;color:var(--muted);margin-top:7px}.stop{position:relative;display:grid;grid-template-columns:55px 1fr;gap:16px;margin-top:27px}.stop-time{font:17px Georgia,serif;color:var(--gold);padding-top:4px}.stop-time small{font:10px "Microsoft YaHei",sans-serif;display:block;margin-top:8px;color:var(--muted)}.stop-body{min-width:0;border-bottom:1px solid var(--line);padding-bottom:24px}.stop:last-child .stop-body{border:0;padding-bottom:0}.stop-label{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--muted);margin-bottom:8px}.number{display:inline-grid;place-items:center;width:22px;height:22px;background:var(--green);border-radius:50%;color:white;font:11px Arial,sans-serif}.stop h4{font-family:"Songti SC",SimSun,serif;font-size:21px;font-weight:500;margin:0 0 14px}.stop .photo{margin-bottom:13px}.stop-body>p{font-size:13px;line-height:1.9;color:#7c786d}.tip{padding:10px 13px;border-radius:7px;background:#f5f6ef;color:#879276!important;font-size:11px!important;line-height:1.8;margin-top:12px}.cost{float:right;font:11px "Microsoft YaHei",sans-serif;color:var(--gold);margin-top:5px;margin-left:8px}.day-aside{display:flex;flex-direction:column;gap:20px}.route-map,.aside-card{background:#fff;border:1px solid var(--line);border-radius:13px;padding:20px}.label{display:flex;justify-content:space-between;font-size:13px;margin-bottom:15px}.label span{font-size:10px;color:var(--muted)}.map-expand{display:block;width:100%;padding:0;cursor:zoom-in}.route-map>small{display:block;color:var(--muted);font-size:10px}.map-dialog{border:0;border-radius:14px;padding:20px;max-width:95vw;max-height:95vh}.map-dialog::backdrop{background:#263b32aa}.map-dialog>button{display:block;margin-left:auto;padding:5px 15px}.map-dialog img{display:block;max-height:80vh;width:auto;max-width:90vw}.route-map .map-fallback{display:block;width:100%;background:#f0f2eb;border-radius:8px;min-height:160px;object-fit:contain}.route-map figcaption{font-size:10px;color:var(--muted);line-height:1.8;margin-top:12px}.route-list{list-style:none;margin:0;padding:0}.route-list li{display:flex;gap:9px;align-items:center;padding:8px 0;font-size:12px;border-bottom:1px solid #f0ede7}.route-list li:last-child{border:0}.weather-card{background:#edece3}.aside-card h3{font-size:19px;margin-bottom:12px}.aside-card p{font-size:12px;color:#7e8171}.day-note{border-left:3px solid var(--gold);margin:24px 0 0;padding:12px 18px;background:#f0eade;font-size:12px;color:#82715c}.overview{margin:26px 0}.overview summary{cursor:pointer;padding:15px 0;font-size:13px;color:var(--gold)}.overview .map-fallback{max-height:400px}.destination-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.destination-card{background:white;border:1px solid var(--line);border-radius:13px;overflow:hidden;min-width:0}.destination-card>.photo .photo-frame{border-radius:0}.destination-card>.photo figcaption{padding:10px 17px 0}.destination-card>.photo-empty{border-radius:0;min-height:218px}.destination-body{padding:20px}.destination-body h3{margin:10px 0}.destination-body>p{font-size:12px;color:var(--muted)}.card-meta{display:flex;justify-content:space-between;font-size:11px;color:var(--gold);border-top:1px solid var(--line);padding-top:12px;margin-top:17px}.food-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.food-grid .photo img{height:300px}.practical-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.panel{background:white;padding:28px;border:1px solid var(--line);border-radius:13px;min-width:0}.panel h3{margin:8px 0 16px}.panel p{font-size:13px;color:#7c786d;margin-top:12px}.budget{margin-top:24px}.budget-total{display:flex;gap:40px;flex-wrap:wrap;padding:25px 0}.budget-total strong{display:block;font:32px Georgia,serif;color:var(--green)}.budget-total small{font-size:11px;color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:12px}td,th{text-align:left;padding:15px 8px;border-bottom:1px solid var(--line)}th{font-weight:400;color:var(--muted)}td:last-child,th:last-child{text-align:right;white-space:nowrap}ul{padding-left:18px}li{padding:6px 0;font-size:12px;color:#7c786d}.notice{padding:15px 20px;background:#eee9de;border:1px solid #e6dece;border-radius:9px;font-size:11px;color:#91816b;margin:20px 0}.sources{overflow-wrap:anywhere}.sources li{border-bottom:1px solid var(--line);padding:12px 0}.sources li small{display:block;font-size:10px;color:var(--muted)}footer{border-top:1px solid var(--line);padding:30px 0 40px;color:var(--muted);font-size:11px;display:flex;justify-content:space-between;gap:20px}footer strong{font:22px Georgia,serif;color:var(--gold)}.empty{padding:35px;background:#fff;border:1px solid var(--line);border-radius:10px;color:var(--muted)}
@media(max-width:1000px){.day-layout{grid-template-columns:1fr 280px}.hero{gap:30px}.destination-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.brand span{display:none}.navigation button{padding:8px 11px}.nav-inner{gap:10px}.wrap{width:calc(100% - 40px)}}
@media(max-width:720px){.wrap{width:calc(100% - 32px)}.nav-inner{flex-wrap:wrap;padding:12px 0;gap:12px}.navigation{order:3;flex-basis:100%;justify-content:space-between}.navigation button{font-size:11px;padding:7px 10px}.hero{grid-template-columns:1fr;padding-top:32px;gap:26px}.hero h1{font-size:38px}.cover-photo img{height:260px}.cover-photo .photo-frame{border-top-left-radius:65px}.summary{font-size:13px}.stats{margin-bottom:30px;padding:20px 0;gap:18px;grid-template-columns:1fr 1fr}.stats div{padding-left:15px}.stats div:nth-child(3){border:0;padding-left:0}.stats strong{font-size:24px}.section-head{display:block}.section-head p{margin-top:12px}h2{font-size:26px}.day-layout{grid-template-columns:1fr}.day-main{padding:20px 15px}.day-header{gap:14px}.day-header h3{font-size:20px}.day-number{font-size:42px}.stop{grid-template-columns:43px 1fr;gap:11px}.stop h4{font-size:20px}.cost{float:none;display:block;margin:4px 0 0}.stop .photo img{height:175px}.photo figcaption{font-size:9px}.photo figcaption small{font-size:9px}.day-aside{display:grid;grid-template-columns:1fr}.destination-grid,.food-grid,.practical-grid{grid-template-columns:1fr}.food-grid .photo img{height:240px}.panel{padding:20px}.budget-total{gap:25px}.budget-total strong{font-size:25px}td,th{padding:12px 4px;font-size:11px}footer{display:block}footer p{margin-top:10px}#guide{scroll-margin-top:145px}}
@media print{@page{size:A4;margin:14mm}body{background:white;font-size:11px}.wrap{width:100%}.topbar,.day-nav{display:none!important}.hero{padding:0 0 25px;grid-template-columns:1fr 1fr}.hero h1{font-size:32px}.cover-photo img{height:230px}.enhanced [data-section-panel],.enhanced [data-day-panel]{display:block!important}[data-section-panel]{break-before:page}.day-layout{display:block;break-before:page}.day-main,.panel{border:0;padding:0}.day-aside{display:block;margin-top:20px}.day-aside>*{margin-bottom:15px}.stop,.destination-card,.panel,.route-map{break-inside:avoid}.stop .photo img{height:180px}.destination-grid{grid-template-columns:1fr 1fr}.photo img{height:170px}.food-grid .photo img{height:200px}.overview{display:none}.stats{margin-bottom:20px}.photo-failure{padding:20px}a{text-decoration:none}}
`;

import { PLANNING_CSS } from "../../shared/planning-styles.js";
import { costsHtml, journeyHtml } from "./planning-html.js";
import { QUALITY_CSS } from "../../shared/quality-styles.js";
import { factHtml, revisionHtml, stopFactsHtml } from "./quality-html.js";
import { refreshFacts, verifyPlan } from "./quality.js";

export function buildTravelHtml(
  plan: Plan,
  maps: MapResult[],
  overview: MapResult,
  trackingFailures = 0,
  mapConfig: BrowserMapConfig = { key: "" },
): string {
  refreshFacts(plan);
  const allStops = plan.days.flatMap((d) =>
    d.stops.map((stop, index) => ({ stop, day: d.day, index })),
  );
  const attractions = allStops.filter((x) => x.stop.type === "attraction");
  const food = allStops.filter((x) => x.stop.type === "food");
  const hero = coverPhoto(plan);
  const navigation = [
    ["itinerary", "行程规划"],
    ["practical", "住宿交通"],
    ["attractions", "景点介绍"],
    ["food", "美食推荐"],
    ["notes", "出行锦囊"],
  ];
  const daily = plan.days
    .map(
      (day, i) =>
        `<div class="day-panel ${i === 0 ? "active" : ""}" data-day-panel="${day.day}"><div class="day-layout"><article class="day-main"><header class="day-header"><span class="day-number" style="color:${DAY_COLORS[i % DAY_COLORS.length]}">${String(day.day).padStart(2, "0")}</span><div><div class="eyebrow">${h(day.date)}</div><h3>${h(day.title)}</h3><p>${h(day.subtitle)}</p></div></header>${day.stops.map((stop, n) => `<article class="stop"><div class="stop-time">${h(stop.time)}<small>${h(stop.duration)}</small></div><div class="stop-body"><div class="stop-label"><span class="number" style="background:${DAY_COLORS[i % DAY_COLORS.length]}">${n + 1}</span>${typeName[stop.type]}</div><h4>${h(stop.name)}<span class="cost">${money(stop.cost)} · 参考</span></h4>${stopFactsHtml(stop)}${["attraction", "food"].includes(stop.type) ? picture(stop.photo, stop.name) : ""}<p>${h(stop.description)}</p>${stop.tip ? `<p class="tip">${h(stop.tip)}</p>` : ""}</div></article>`).join("")}</article><aside class="day-aside">${mapFigure(maps[i], `DAY ${day.day} · 景点分布`, day.day, !!mapConfig.key)}<div class="aside-card"><h3>这一天，顺路走</h3><ol class="route-list">${day.stops.map((s, n) => `<li><span class="number" style="background:${DAY_COLORS[i % DAY_COLORS.length]}">${n + 1}</span>${s.location ? `<a href="https://uri.amap.com/marker?position=${s.location.join(",")}&amp;name=${encodeURIComponent(s.name)}&amp;coordinate=gaode&amp;callnative=0" target="_blank" rel="noopener noreferrer" title="${h(s.locationNote || "高德地点")}">${h(s.name)} ↗</a>` : `${h(s.name)} · 坐标待核验`}</li>`).join("")}</ol></div><div class="aside-card weather-card"><div class="eyebrow">WEATHER / 当日天气</div><p>${h(day.weather)}</p>${factHtml("天气依据", day.weatherFact)}</div></aside></div><div class="day-note">当日提醒 · ${h(day.note)}</div></div>`,
    )
    .join("");
  const cards = (items: typeof allStops) =>
    items.map((x) => destinationCard(x.stop, x.day, x.index)).join("") ||
    '<p class="empty">这份行程暂未安排此类停留点。</p>';
  const estimate = (p: Plan) =>
    p.costs && p.costs.high !== p.costs.low
      ? `${money(p.costs.low)} — ${money(p.costs.high)}`
      : money(p.totalEstimate);
  const practical = `<div class="practical-grid"><article class="panel"><div class="eyebrow">GETTING THERE</div><h3>把出发与归途，安排妥当</h3><p><b>去程</b><br/>${h(plan.transport.outbound)}</p>${factHtml("去程依据", plan.quality?.outbound)}<p><b>返程</b><br/>${h(plan.transport.inbound)}</p>${factHtml("返程依据", plan.quality?.inbound)}<p class="tip">${h(plan.transport.note)}</p>${journeyHtml(plan)}</article><article class="panel"><div class="eyebrow">STAY A LITTLE LONGER</div><h3>${h(plan.hotel.name)}</h3><p>${h(plan.hotel.area)}</p><p>${h(plan.hotel.reason)}</p>${factHtml("住宿依据", plan.quality?.hotel)}<p class="tip">每间每晚参考 ${money(plan.hotel.nightlyEstimate)} · 房价与可订状态请另行核实</p></article></div><article class="panel budget"><div class="eyebrow">A WELL-CONSIDERED BUDGET</div><h3>把花费，也安排得刚刚好</h3><div class="budget-total"><div><small>全体旅客 · 全程参考</small><strong>${estimate(plan)}</strong></div><div><small>你的总预算</small><strong>${money(plan.request.budget)}</strong></div><div><small>${(plan.costs?.high ?? plan.totalEstimate) > plan.request.budget ? "超出预算" : "参考余量"}</small><strong>${money(Math.abs(plan.request.budget - (plan.costs?.high ?? plan.totalEstimate)))}</strong></div></div>${plan.unknownCosts ? `<p class="notice">另有 ${plan.unknownCosts} 项费用未知，当前合计不完整。</p>` : ""}<table><thead><tr><th>项目</th><th>计算口径</th><th>参考费用</th></tr></thead><tbody>${plan.budget.map((b) => `<tr><td>${h(b.category)}</td><td>${h(b.basis)}</td><td>${money(b.amount)}</td></tr>`).join("")}</tbody></table>${costsHtml(plan)}</article>`;
  const executable = script + "\n" + interactiveScript(plan, mapConfig);
  const hash = createHash("sha256").update(executable).digest("base64");
  // SDK scripts, styles, tiles and workers come only from official Amap domains.
  const amapHosts = "https://*.amap.com https://*.autonavi.com";
  const csp = `default-src 'none'; img-src data: https://images.unsplash.com https://store.is.autonavi.com https://aos-comment.amap.com${mapConfig.key ? ` blob: ${amapHosts}` : ""}; style-src 'unsafe-inline'${mapConfig.key ? ` ${amapHosts}` : ""}; script-src 'sha256-${hash}'${mapConfig.key ? ` 'unsafe-eval' ${amapHosts}` : ""}; base-uri 'none'; form-action 'none'; connect-src ${mapConfig.key ? amapHosts : "'none'"}; worker-src ${mapConfig.key ? "blob:" : "'none'"}`;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta http-equiv="Content-Security-Policy" content="${csp}"/><meta name="referrer" content="no-referrer"/><title>${h(plan.destination)} · ${h(plan.title)} | 山行 Roam</title><style>${css}
${MAP_CSS}
${QUALITY_CSS}
${PLANNING_CSS}</style></head><body><header class="topbar"><div class="wrap nav-inner"><div class="brand">山行<span>ROAM JOURNAL</span></div><nav class="navigation" aria-label="手册章节">${navigation.map(([id, label], i) => `<button data-section="${id}" aria-controls="section-${id}" aria-pressed="${i === 0}">${label}</button>`).join("")}</nav><button class="print" id="print">打印手册 ↗</button></div></header><main class="wrap"><section class="hero"><div><div class="eyebrow">YOUR PERSONAL TRAVEL JOURNAL / ${h(plan.destination)}</div><h1>${h(plan.title).replace("，", "，<br/>")}</h1><p class="subtitle">${h(plan.subtitle)}</p><p class="summary">${h(plan.summary)}</p><div class="trip-meta"><span><b>${h(plan.request.origin)} → ${h(plan.destination)}</b></span><span>${h(plan.request.startDate)} — ${h(plan.days.at(-1)?.date)}</span><span>${plan.request.travelers} 人同行</span></div></div>${picture(hero, plan.destination, true)}</section><div class="stats"><div><small>这次旅程</small><strong>${String(plan.days.length).padStart(2, "0")}<span>天，慢慢走</span></strong></div><div><small>沿途相遇</small><strong>${String(attractions.length).padStart(2, "0")}<span>处风景</span></strong></div><div><small>全程参考</small><strong>${estimate(plan)}</strong></div><div><small>旅行节奏</small><strong>${h({ relaxed: "松弛慢游", balanced: "刚刚好", packed: "充实探索" }[plan.request.pace])}</strong></div></div>${revisionHtml(plan)}<div id="guide"><section class="active" id="section-itinerary" data-section-panel="itinerary"><header class="section-head"><div><div class="eyebrow">THE ITINERARY</div><h2>一日一程，慢慢遇见。</h2></div><p>按日期翻阅 · 地图编号对应当天行程</p></header><div class="day-nav" aria-label="选择行程日期">${plan.days.map((d, i) => `<button data-day="${d.day}" aria-pressed="${i === 0}"><b>DAY ${String(d.day).padStart(2, "0")}</b>${h(d.date.slice(5).replace("-", " / "))}</button>`).join("")}</div>${daily}<details class="overview"><summary>展开全程路线总览</summary>${mapFigure(overview, "全程景点分布", 0, !!mapConfig.key)}</details></section><section id="section-practical" data-section-panel="practical"><header class="section-head"><div><div class="eyebrow">THE PRACTICAL DETAILS</div><h2>安心出发的底气。</h2></div><p>住宿、交通与全体旅客的全程预算</p></header>${practical}</section><section id="section-attractions" data-section-panel="attractions"><header class="section-head"><div><div class="eyebrow">PLACES & STORIES</div><h2>每一站，都有它的故事。</h2></div><p>照片取景与来源见图片下方说明</p></header><div class="destination-grid">${cards(attractions)}</div></section><section id="section-food" data-section-panel="food"><header class="section-head"><div><div class="eyebrow">A TASTE OF THE CITY</div><h2>循着香气，认识一座城。</h2></div><p>用餐建议与菜品灵感 · 餐馆营业情况请临行核实</p></header><div class="destination-grid food-grid">${cards(food)}</div></section><section id="section-notes" data-section-panel="notes"><header class="section-head"><div><div class="eyebrow">BEFORE YOU GO</div><h2>带上这些，再出发。</h2></div></header><div class="practical-grid"><article class="panel"><h3>旅途小提醒</h3><ul>${plan.tips.map((t) => `<li>${h(t)}</li>`).join("")}</ul></article><article class="panel"><h3>仍需确认的事</h3><ul>${plan.warnings.map((t) => `<li>${h(t)}</li>`).join("")}</ul></article></div><article class="panel budget sources"><h3>信息与图片来源</h3><ul>${plan.evidence.map((e) => `<li>${h(e.source)} · ${h({ live: "工具已返回", error: "查询失败", demo: "演示", unconfigured: "未配置" }[e.status])}<small>${h(e.tool)} / ${h(e.queriedAt)}</small></li>`).join("")}</ul><p>图片优先使用高德 POI 返回的地点照片，Unsplash 提供补充配图，每张图片保留来源链接。高德地点照片不代表 CC0 授权，转载或商用请确认图片权利。${plan.photoMode === "curated" ? "当前使用内置精选照片；配置 Unsplash Access Key 后可按每个停留点搜索。" : "按停留点关键词搜索，未匹配时使用有来源的相关精选照片或留空。"}图库取景与实际季节、餐馆可能不同，请以图片说明为准。</p><p>行程、标记数据和静态地图预览包含在此 HTML 文件中。交互地图与照片需要联网；联网时地图可拖动、缩放并点击标记，离线或高德服务不可用时仍可查看内嵌静态地图。</p>${trackingFailures ? "<p>部分 Unsplash 图片使用记录未送达，图片来源链接已保留。</p>" : ""}</article></section></div><div class="notice">${plan.mode === "demo" ? "演示手册 · 行程、价格与天气未作实时查询；图库照片来源单独署名。" : "AI 辅助规划 · 费用为参考估算，请在出发前核实开放、预约、票价和天气。"} 地图连线表示游览顺序，不作为实际道路导航。</div><footer><strong>Roam. 慢一点，风景会等你。</strong><p>${h(plan.destination)} · ${h(plan.createdAt.slice(0, 10))} / 山行旅行手册<br/>愿每一次出发，都有值得记住的故事。</p></footer></main><script>${executable}</script></body></html>`;
}

export async function renderHtml(
  plan: Plan,
  config: Config,
  trackingFailures = 0,
): Promise<string> {
  if (plan.days.some((day) => !day.check))
    await verifyPlan(plan, config, { signal: AbortSignal.timeout(180000) });
  refreshFacts(plan);
  const maps: MapResult[] = [];
  for (const day of plan.days) maps.push(await getMap(plan, config, day.day));
  return buildTravelHtml(
    plan,
    maps,
    await getMap(plan, config),
    trackingFailures,
    browserMapConfig(config),
  );
}
