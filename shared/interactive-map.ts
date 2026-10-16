import type { Plan } from "./types.js";
import { DAY_COLORS } from "./types.js";

export type BrowserMapConfig = { key: string; securityCode?: string };
export type MapPoint = {
  day: number;
  index: number;
  name: string;
  time: string;
  description: string;
  address: string;
  location: [number, number];
  color: string;
};
export type InteractiveMapData = BrowserMapConfig & {
  points: MapPoint[];
  day: number;
};

// Use the same verified GCJ-02 coordinates as the generated itinerary and static maps.
export function itineraryMapPoints(plan: Plan, day = 0): MapPoint[] {
  return plan.days
    .filter((d) => !day || d.day === day)
    .flatMap((d) =>
      d.stops.flatMap((s, i) =>
        s.verified &&
        s.location &&
        s.location.length === 2 &&
        s.location.every(Number.isFinite) &&
        Math.abs(s.location[0]) <= 180 &&
        Math.abs(s.location[1]) <= 90
          ? [
              {
                day: d.day,
                index: i + 1,
                name: s.name,
                time: s.time,
                description: s.description,
                address: s.place?.address || s.locationNote || "",
                location: s.location,
                color: DAY_COLORS[(d.day - 1) % DAY_COLORS.length],
              },
            ]
          : [],
      ),
    );
}

// Static browser code shared verbatim by React and standalone HTML. It contains no credentials.
// Itinerary text is only inserted with textContent, including marker information windows.
export const MAP_RUNTIME = String.raw`(() => {
  if (window.RoamMaps) return;
  let sdkPromise, sdkIdentity;
  function loadSdk(config) {
    const identity = config.key + ':' + (config.securityCode || '');
    if (sdkPromise) {
      if (sdkIdentity !== identity) return Promise.reject(new Error('地图配置已更新，请刷新页面后使用'));
      return sdkPromise;
    }
    sdkIdentity = identity;
    sdkPromise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('高德地图连接超时，已保留静态预览')), 15000);
      function start() {
        if (config.securityCode) window._AMapSecurityConfig = { securityJsCode: config.securityCode };
        window.AMapLoader.load({ key: config.key, version: '1.4.15', plugins: ['AMap.Scale'] })
          .then(api => finish(null, api)).catch(() => finish(new Error('高德地图加载失败，请检查网页端 Key 与安全密钥')));
      }
      if (window.AMapLoader) start();
      else {
        const tag = document.createElement('script');
        tag.src = 'https://webapi.amap.com/loader.js';
        tag.onload = start;
        tag.onerror = () => { tag.remove(); finish(new Error('未能连接高德地图，联网后可重试')); };
        document.head.append(tag);
      }
    }).catch(error => { sdkPromise = null; sdkIdentity = null; throw error; });
    return sdkPromise;
  }
  function create(host, data, onState) {
    let disposed = false, map, observer, readyTimer, popup;
    const markers = [];
    const state = (value, message) => {
      if (disposed) return;
      host.dataset.state = value;
      if (onState) onState(value, message || '');
    };
    host.classList.add('roam-map');
    host.setAttribute('aria-label', data.day ? '第 ' + data.day + ' 天交互地图' : '全程交互地图');
    host.replaceChildren();
    const canvas = document.createElement('div'); canvas.className = 'roam-map-canvas';
    const controls = document.createElement('div'); controls.className = 'roam-map-controls';
    host.append(canvas, controls);
    function fit() { if (map && markers.length) { popup && popup.close(); map.setFitView(markers, true, [64, 48, 64, 48], 15); } }
    function button(label, text, action) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
      b.setAttribute('aria-label', label); b.title = label; b.onclick = action; controls.append(b); return b;
    }
    button('放大一级', '+', () => map && map.zoomIn());
    button('缩小一级', '−', () => map && map.zoomOut());
    button('显示全部地点', '全览', fit);
    const expand = button('展开地图', '展开', () => {
      host.classList.toggle('is-expanded');
      expand.textContent = host.classList.contains('is-expanded') ? '收起' : '展开';
      expand.setAttribute('aria-label', host.classList.contains('is-expanded') ? '收起地图' : '展开地图');
      requestAnimationFrame(fit);
    });
    const escape = e => { if (e.key === 'Escape' && host.classList.contains('is-expanded')) expand.click(); };
    document.addEventListener('keydown', escape);
    const controller = {
      fit,
      destroy() {
        disposed = true; clearTimeout(readyTimer); observer && observer.disconnect();
        document.removeEventListener('keydown', escape);
        popup && popup.close(); map && map.destroy();
        host.classList.remove('is-expanded'); host.replaceChildren();
      }
    };
    if (!data.key) { state('unconfigured', '配置高德网页端 JS API Key 后可拖动、缩放地图'); return controller; }
    const points = data.points.filter(p => Array.isArray(p.location) && p.location.length === 2 && p.location.every(Number.isFinite));
    if (!points.length) { state('empty', '当天尚无已核验坐标，暂时显示游览顺序'); return controller; }
    state('loading', '正在连接交互地图…');
    loadSdk(data).then(A => {
      if (disposed) return;
      map = new A.Map(canvas, { viewMode: '2D', zoom: 12, center: points[0].location,
        resizeEnable: true, dragEnable: true, zoomEnable: true, scrollWheel: true,
        doubleClickZoom: true, touchZoom: true, keyboardEnable: true, animateEnable: false });
      map.addControl(new A.Scale());
      popup = new A.InfoWindow({ offset: new A.Pixel(0, -18), autoMove: true });
      const grouped = new Map();
      points.forEach(p => {
        const id = p.location.join(',');
        if (!grouped.has(id)) grouped.set(id, []);
        grouped.get(id).push(p);
      });
      grouped.forEach(group => {
        const first = group[0];
        const label = group.map(p => data.day ? String(p.index) : p.day + '.' + p.index).join('/');
        const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'roam-map-pin';
        pin.style.backgroundColor = first.color;
        pin.textContent = label.length > 13 ? label.slice(0, label.indexOf('/')) + '+' + (group.length - 1) : label;
        pin.setAttribute('aria-label', group.map(p => '第' + p.day + '天第' + p.index + '站 ' + p.name).join('；'));
        pin.title = group.map(p => p.name).join(' / ');
        const marker = new A.Marker({ position: first.location, content: pin, anchor: 'center', offset: new A.Pixel(0, 0), zIndex: 110 });
        pin.addEventListener('click', e => {
          e.stopPropagation();
          const content = document.createElement('div'); content.className = 'roam-map-popup';
          group.forEach(p => {
            const section = document.createElement('section');
            const meta = document.createElement('small'); meta.textContent = 'DAY ' + p.day + ' · 第 ' + p.index + ' 站 · ' + p.time;
            const name = document.createElement('strong'); name.textContent = p.name;
            const description = document.createElement('p'); description.textContent = p.description;
            const address = document.createElement('p'); address.textContent = p.address;
            const link = document.createElement('a'); link.textContent = '在高德地图中打开 ↗';
            link.href = 'https://uri.amap.com/marker?position=' + p.location.join(',') + '&name=' + encodeURIComponent(p.name) + '&coordinate=gaode&callnative=0';
            link.target = '_blank'; link.rel = 'noopener noreferrer';
            section.append(meta, name, description, address, link); content.append(section);
          });
          popup.setContent(content); popup.open(map, first.location);
        });
        map.add(marker); markers.push(marker);
      });
      Array.from(new Set(points.map(p => p.day))).forEach(day => {
        const route = points.filter(p => p.day === day).sort((a, b) => a.index - b.index);
        if (route.length > 1) map.add(new A.Polyline({ path: route.map(p => p.location),
          strokeColor: route[0].color, strokeWeight: 4, strokeOpacity: .8, showDir: true, zIndex: 50 }));
      });
      map.on('complete', () => { clearTimeout(readyTimer); state('ready', '拖动平移 · 滚轮 / 双指缩放 · 点击编号查看详情'); });
      // The SDK updates its viewport asynchronously after a panel/fullscreen resize.
      map.on('resize', () => { if (!disposed && host.clientWidth && host.clientHeight) fit(); });
      map.on('error', () => { clearTimeout(readyTimer); state('error', '交互地图不可用，请检查网络、Key 或域名白名单；静态预览已保留'); });
      readyTimer = setTimeout(() => state('error', '地图底图未能加载，请检查网络、Key 或域名白名单；静态预览已保留'), 15000);
      observer = new ResizeObserver(() => { if (host.clientWidth && host.clientHeight) requestAnimationFrame(() => { if (!disposed) fit(); }); });
      observer.observe(host);
      fit();
    }).catch(error => state('error', error.message));
    return controller;
  }
  window.RoamMaps = { create };
})();`;

export const MAP_CSS = `
.roam-map-frame{position:relative;width:100%;height:340px;min-width:0;overflow:hidden;border-radius:9px;background:#f0f2eb}
.roam-map-frame>.map-fallback{width:100%;height:100%;object-fit:contain;display:block}
.roam-map-frame.has-live-map>.map-fallback{visibility:hidden}
.roam-map{position:absolute;inset:0;visibility:hidden;text-align:left;color:#3d493e;font:13px "Microsoft YaHei",sans-serif}
.roam-map[data-state=ready]{visibility:visible}
.roam-map-canvas{position:absolute;inset:0}
.roam-map.is-expanded{position:fixed;inset:4vh 4vw;width:auto;height:auto;z-index:9999;box-shadow:0 0 0 100vmax #1c302bb3;border-radius:12px;overflow:hidden}
.roam-map-controls{position:absolute;top:12px;right:12px;z-index:150;display:flex;gap:1px;border:1px solid #e1e7db;border-radius:7px;background:white;box-shadow:0 2px 8px #243d2425;overflow:hidden}
.roam-map-controls button{border:0;border-radius:0;background:white;min-width:34px;height:34px;padding:0 9px;color:#365243;cursor:pointer;font:12px "Microsoft YaHei",sans-serif;white-space:nowrap}
.roam-map-controls button:first-child,.roam-map-controls button:nth-child(2){font-size:21px}
.roam-map-controls button:hover{background:#edf2e8}
.roam-map button:focus-visible{outline:2px solid #315b43;outline-offset:-3px}
.roam-map-pin{display:block;border:2px solid white;border-radius:20px;min-width:30px;height:30px;padding:0 7px;color:white;box-shadow:0 2px 6px #18332466;cursor:pointer;font:bold 12px Arial,sans-serif;white-space:nowrap}
.roam-map-popup{max-width:min(245px,65vw);max-height:240px;overflow:auto;font:12px/1.7 "Microsoft YaHei",sans-serif;color:#4d5e50}
.roam-map-popup section+section{border-top:1px solid #e1e7db;margin-top:10px;padding-top:10px}
.roam-map-popup small{color:#85917e;font-size:10px}.roam-map-popup strong{display:block;font-size:16px;margin:5px 0}
.roam-map-popup p{font:12px/1.7 "Microsoft YaHei",sans-serif;margin:6px 0;color:#727b6c}.roam-map-popup a{color:#376149;font-size:11px}
.roam-map-status{display:block;margin-top:9px;color:#87957c;font-size:11px;line-height:1.8}
.roam-map img{max-width:none!important;min-height:0!important;object-fit:fill!important;border-radius:0!important;background:none!important}
@media print{.roam-map{display:none!important}.roam-map-frame>.map-fallback{visibility:visible!important}.roam-map-status{display:none}}
`;

export type MapController = { fit(): void; destroy(): void };
declare global {
  interface Window {
    RoamMaps?: {
      create(
        host: HTMLElement,
        data: InteractiveMapData,
        onState?: (state: string, message: string) => void,
      ): MapController;
    };
  }
}
export function installMapRuntime() {
  if (!window.RoamMaps) {
    const script = document.createElement("script");
    script.textContent = MAP_RUNTIME;
    document.head.append(script);
  }
  if (!document.getElementById("roam-map-styles")) {
    const style = document.createElement("style");
    style.id = "roam-map-styles";
    style.textContent = MAP_CSS;
    document.head.append(style);
  }
  return window.RoamMaps!;
}
