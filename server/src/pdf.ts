import fs from "node:fs";
import { chromium } from "playwright-core";
import type { Plan } from "../../shared/types.js";
import { DAY_COLORS } from "../../shared/types.js";
import type { Config } from "./config.js";
import { getMap, escapeHtml as h, type MapResult } from "./maps.js";
export function browserExecutable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const executable = candidates.find((p) => p && fs.existsSync(p));
  if (!executable)
    throw new Error(
      "PDF 导出需要 Chromium、Chrome 或 Edge，请在 .env 中设置 BROWSER_EXECUTABLE_PATH。",
    );
  return executable;
}
export async function renderPdf(plan: Plan, config: Config): Promise<Buffer> {
  const maps: MapResult[] = [];
  for (const day of plan.days) maps.push(await getMap(plan, config, day.day));
  const overview = await getMap(plan, config);
  const money = (v: number | null) =>
    v === null ? "待查询" : `¥${Math.round(v).toLocaleString("zh-CN")}`;
  const brand =
    '<div class="brand"><b>山行</b><span>ROAM / A JOURNEY, WELL CONSIDERED</span></div>';
  const cover = `<section class="cover">${brand}<div class="eyebrow">YOUR PERSONAL TRAVEL JOURNAL</div><h1>${h(plan.title)}</h1><p class="subtitle">${h(plan.subtitle)}</p><div class="meta">${h(plan.request.origin)} → ${h(plan.destination)}<span>${h(plan.request.startDate)} 起 · ${plan.days.length} 天 · ${plan.request.travelers} 人</span></div><p class="summary">${h(plan.summary)}</p><div class="mapheading"><h2>一眼看见，这趟旅程</h2><span>${overview.kind === "amap" ? "高德景点分布图" : "路线示意"}</span></div><img class="overview" src="${overview.image}"/><p class="caption">${h(overview.caption)}</p><div class="daylegend">${plan.days.map((d) => `<div><i style="background:${DAY_COLORS[(d.day - 1) % DAY_COLORS.length]}"></i><b>DAY ${d.day}</b><span>${h(d.title)}</span></div>`).join("")}</div><div class="disclosure">${plan.mode === "demo" ? "演示方案 · 本文未使用实时查询结果。" : "AI 辅助规划 · 价格为参考估算，预订前请核实。"}<br/>${h(plan.warnings.slice(0, 2).join(" "))}</div></section>`;
  const daily = plan.days
    .map(
      (day, i) =>
        `<section class="daily">${brand}<div class="dayheading"><div class="daynumber" style="color:${DAY_COLORS[i % DAY_COLORS.length]}">0${day.day}</div><div><div class="eyebrow">${h(day.date)} / DAY ${day.day}</div><h2>${h(day.title)}</h2><p>${h(day.subtitle)}</p></div></div><div class="weather">${h(day.weather)}</div><img class="daymap" src="${maps[i].image}"/><p class="caption">${h(maps[i].caption)}</p><div class="stops">${day.stops.map((s, n) => `<article class="stop"><div class="time">${h(s.time)}<span>${h(s.duration)}</span></div><div class="stopnumber" style="background:${DAY_COLORS[i % DAY_COLORS.length]}">${n + 1}</div><div class="stopbody"><h3>${h(s.name)}<small>${money(s.cost)}${s.cost !== null ? " · 参考" : ""}</small></h3><p>${h(s.description)}</p><p class="tip">${h(s.tip)}</p></div></article>`).join("")}</div><div class="note">当日提醒 · ${h(day.note)}</div></section>`,
    )
    .join("");
  const expenses = `<section class="expenses">${brand}<div class="eyebrow">THE PRACTICAL DETAILS</div><h1>安心出发的底气</h1><p class="subtitle">预算、交通与住宿，一页看清。</p><div class="totals"><div><label>全体旅客 · 全程参考费用</label><strong>${money(plan.totalEstimate)}</strong></div><div><label>你的总预算</label><strong>${money(plan.request.budget)}</strong></div><div><label>${plan.totalEstimate > plan.request.budget ? "超出预算" : "参考余量"}</label><strong>${money(Math.abs(plan.request.budget - plan.totalEstimate))}</strong></div></div>${plan.unknownCosts ? `<p class="warning">另有 ${plan.unknownCosts} 项金额待查，合计不完整。</p>` : ""}<table><thead><tr><th>项目</th><th>计算口径</th><th>全程费用</th></tr></thead><tbody>${plan.budget.map((b) => `<tr><td>${h(b.category)}</td><td>${h(b.basis)}</td><td>${money(b.amount)}</td></tr>`).join("")}</tbody></table><div class="practical"><div><h2>如何抵达</h2><p>${h(plan.transport.outbound)}</p><p>${h(plan.transport.inbound)}</p><p class="caption">${h(plan.transport.note)}</p></div><div><h2>在哪里休息</h2><h3>${h(plan.hotel.name)}</h3><p>${h(plan.hotel.area)} · 每间每晚参考 ${money(plan.hotel.nightlyEstimate)}</p><p>${h(plan.hotel.reason)}</p></div></div><h2>出发前的几件小事</h2><ul>${plan.tips.map((t) => `<li>${h(t)}</li>`).join("")}</ul></section>`;
  const sources = `<section class="sources">${brand}<div class="eyebrow">NOTES & SOURCES</div><h1>让每个建议，有据可查</h1><h2>待确认事项</h2><ul>${plan.warnings.map((w) => `<li>${h(w)}</li>`).join("")}</ul><h2>信息来源记录</h2>${plan.evidence.length ? plan.evidence.map((e, i) => `<div class="source"><b>${i + 1}. ${h(e.source)}</b> · ${h({ live: "工具已返回", demo: "演示", error: "查询失败", unconfigured: "未配置" }[e.status])}<span>${h(e.queriedAt)} · ${h(e.tool)}</span></div>`).join("") : "<p>没有外部查询记录。</p>"}<p class="caption">生成时间 ${h(plan.createdAt)}。地图坐标使用高德 GCJ-02；连线仅代表游览顺序。未知费用未计入已知项合计。行程内容不构成票务或酒店预订。</p></section>`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><title>${h(plan.destination)} · 山行旅行计划</title><style>@page{size:A4;margin:14mm 15mm 17mm}*{box-sizing:border-box}body{margin:0;color:#293e32;font-family:"Microsoft YaHei","Noto Sans CJK SC",Arial,sans-serif;font-size:11px;line-height:1.65}section{break-after:page}section:last-child{break-after:auto}.brand{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dbe1d8;padding-bottom:14px;margin-bottom:30px}.brand b{font-size:25px;letter-spacing:4px}.brand span{font-size:8px;letter-spacing:2px;color:#8a9487}.eyebrow{font-size:10px;letter-spacing:2.5px;color:#9c865d;margin-top:30px}h1{font-size:31px;font-weight:500;margin:16px 0 8px}h2{font-size:18px;font-weight:500;margin:14px 0}h3{font-size:13px;margin:0}.subtitle{font-size:15px;color:#7a8576;margin:0 0 24px}.meta{display:flex;gap:22px;padding:13px 0;border-block:1px solid #e5e8e1}.meta span{color:#7d867b}.summary{font-size:13px;line-height:2;margin:22px 0}.mapheading{display:flex;align-items:center;justify-content:space-between}.mapheading span,.caption{color:#828b7d;font-size:9px}.overview{width:100%;border-radius:10px;height:244px;object-fit:contain;background:#eef1e7}.caption{margin:6px 0 12px;line-height:1.6}.daylegend{display:grid;grid-template-columns:1fr;gap:9px;margin:20px 0}.daylegend div{display:flex;gap:12px;align-items:center}.daylegend i{width:8px;height:8px;border-radius:50%}.daylegend b{font-size:9px;letter-spacing:1px}.disclosure{padding:15px;background:#f6f4ed;border-radius:8px;font-size:10px;color:#877654;margin-top:24px}.dayheading{display:flex;align-items:center;gap:20px}.daynumber{font-family:Georgia,serif;font-size:62px;line-height:1.1}.dayheading .eyebrow{margin:0}.dayheading h2{font-size:23px;margin:4px 0}.dayheading p{margin:0;color:#7c8677}.weather{font-size:10px;color:#7b8877;margin:16px 0}.daymap{width:100%;height:210px;object-fit:contain;background:#eef1e7;border-radius:8px}.stop{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid #edf0e9;break-inside:avoid}.time{width:67px;flex-shrink:0;font-size:12px;font-weight:bold}.time span{display:block;font-size:9px;color:#8d9688;font-weight:normal}.stopnumber{flex-shrink:0;color:white;border-radius:50%;width:21px;height:21px;line-height:21px;text-align:center;font-size:10px}.stopbody{flex:1;min-width:0}.stopbody h3{display:flex;justify-content:space-between;gap:8px}.stopbody small{font-size:9px;font-weight:normal;color:#8a927e;white-space:nowrap}.stopbody p{margin:4px 0 0;font-size:10px}.stopbody .tip{font-size:9px;color:#8c8d75}.note{padding:12px;background:#f2f5ee;border-radius:7px;margin-top:15px;font-size:10px}.totals{display:flex;justify-content:space-between;background:#eef2e9;padding:20px;margin:24px 0;border-radius:10px}.totals label{display:block;color:#7a8770;font-size:9px}.totals strong{display:block;font-family:Georgia,serif;font-size:26px;font-weight:normal}table{width:100%;border-collapse:collapse;font-size:10px}th{text-align:left;color:#89917f;font-weight:normal}td,th{padding:12px 8px;border-bottom:1px solid #e4e7dd}td:last-child,th:last-child{text-align:right;white-space:nowrap}td:first-child{white-space:nowrap}.practical{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:20px}.practical p{font-size:10px}ul{padding-left:18px}li{padding:5px 0;break-inside:avoid}.warning{color:#a26437}.source{padding:9px 0;border-bottom:1px solid #e5e9df;break-inside:avoid;font-size:10px}.source span{display:block;font-size:9px;color:#87917c}img{max-width:100%}</style></head><body>${cover}${daily}${expenses}${sources}</body></html>`;
  const browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
    args: process.env.PDF_NO_SANDBOX === "1" ? ["--no-sandbox"] : [],
  });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort()); // Self-contained HTML: no requests from untrusted itinerary content.
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="width:100%;font-family:Arial;font-size:8px;color:#8c9583;padding:0 55px;display:flex;justify-content:space-between"><span>ROAM · YOUR PERSONAL TRAVEL JOURNAL</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
      margin: { top: "14mm", bottom: "17mm", left: "15mm", right: "15mm" },
    });
  } finally {
    await browser.close();
  }
}
